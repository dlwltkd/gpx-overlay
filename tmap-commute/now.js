#!/usr/bin/env node
/**
 * now.js — "지금 뭘 타야 제일 빨리 도착?" 딱 하나만 알려주는 도구 (ODsay 기반)
 *
 * 네이버/티맵처럼 옵션을 잔뜩 보여주는 게 아니라:
 *   1. ODsay 길찾기로 경로 후보를 받고
 *   2. 첫 탑승 정류장의 "실시간 버스 도착 시각"을 조회해서
 *   3. 지금 시각 기준 실제 도착 예상 시각으로 다시 줄 세운 뒤
 *   4. 가장 빠른 것 하나(⭐) + 놓쳤을 때 예비 1개만 보여준다.
 *
 * 사용법:
 *   node now.js 출근            집 → 회사
 *   node now.js 퇴근            회사 → 집
 *   node now.js                 시간대로 자동 (정오 전 출근, 후 퇴근)
 *   node now.js 출근 --debug    ODsay 원본 응답 확인 (필드 확인용)
 *
 * 설정: config.json 에 odsayKey 추가 (lab.odsay.com 에서 발급)
 *   { "odsayKey": "...", "home": {...}, "work": {...} }
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(ROOT, "config.json");
const BASE = "https://api.odsay.com/v1/api";

const DEBUG = process.argv.includes("--debug");
const args = process.argv.slice(2).filter((a) => a !== "--debug");

// ---------------------------------------------------------------- 설정

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    console.error(
      "config.json이 없습니다. config.example.json을 복사해서 만들어 주세요.\n" +
        "ODsay 키는 https://lab.odsay.com 가입 후 발급받아 odsayKey 항목에 넣습니다.",
    );
    process.exit(1);
  }
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  cfg.odsayKey = process.env.ODSAY_KEY || cfg.odsayKey;
  if (!cfg.odsayKey) {
    console.error(
      "ODsay API 키가 없습니다. config.json의 odsayKey 또는 ODSAY_KEY 환경변수로 설정하세요.\n" +
        "발급: https://lab.odsay.com (무료, 하루 1,000회)",
    );
    process.exit(1);
  }
  return cfg;
}

// ---------------------------------------------------------------- ODsay 호출

async function odsay(path, params, key) {
  const url = `${BASE}/${path}?${new URLSearchParams({ ...params, apiKey: key, lang: "0", output: "json" })}`;
  const res = await fetch(url);
  const body = await res.json();
  if (DEBUG) {
    console.error(`\n--- DEBUG ${path} ---`);
    console.error(JSON.stringify(body, null, 2).slice(0, 4000));
  }
  const err = Array.isArray(body.error) ? body.error[0] : body.error;
  if (err) throw new Error(`ODsay 오류 (${path}): [${err.code}] ${err.message || err.msg}`);
  return body.result ?? body;
}

// 경로검색: SX/SY=출발 경도/위도, EX/EY=도착
const searchPaths = (cfg, from, to) =>
  odsay("searchPubTransPathT", {
    SX: from.lon, SY: from.lat, EX: to.lon, EY: to.lat,
  }, cfg.odsayKey);

// 정류장 실시간 버스 도착정보
const realtimeStation = (cfg, stationID) =>
  odsay("realtimeStation", { stationID, stationBase: "0" }, cfg.odsayKey)
    .catch((e) => {
      if (DEBUG) console.error(`실시간 조회 실패 (station ${stationID}): ${e.message}`);
      return null;
    });

// ---------------------------------------------------------------- 실시간 도착 해석

// ODsay 실시간 응답에서 특정 버스 번호의 도착 정보를 최대한 방어적으로 찾는다.
// (응답 스키마가 지역에 따라 조금씩 달라서 후보 필드를 넓게 본다)
function findArrival(realtime, busNo) {
  const list =
    realtime?.real || realtime?.lane || realtime?.station?.[0]?.arrival || [];
  const norm = (s) => String(s ?? "").replace(/[^0-9가-힣A-Za-z-]/g, "");
  const want = norm(busNo);
  for (const item of list) {
    const no = norm(item.routeNm ?? item.busNo ?? item.no ?? item.routeName);
    if (no !== want) continue;
    const outs = [];
    for (const a of [item.arrival1, item.arrival2]) {
      if (!a) continue;
      const sec =
        a.arrivalSec ?? a.arrivalTime ?? a.traTime ?? a.sec ?? null;
      if (sec != null && sec >= 0)
        outs.push({
          sec: +sec,
          left: a.leftStation ?? a.locationNo ?? a.leftStop ?? null,
          lowBus: a.busType === 1 || a.lowBusYn === "Y",
        });
    }
    if (outs.length) return outs;
  }
  return null;
}

// ---------------------------------------------------------------- 후보 평가

const T_ICON = { 1: "🚇", 2: "🚌", 3: "🚶" };

function laneName(sub) {
  const l = sub.lane?.[0];
  return l?.busNo || l?.name || "?";
}

/**
 * 각 경로 후보의 "지금 기준 실제 도착 시각"을 계산한다.
 * - 첫 탑승이 버스면: 실시간 도착 초를 대기시간으로 사용 (핵심!)
 * - 실시간이 없으면: 배차간격의 절반을 대기 추정치로 사용
 * - 지하철 첫 탑승: 배차간격 절반 추정 (수도권 지하철은 짧아서 오차 작음)
 */
async function evaluate(cfg, path) {
  const info = path.info;
  const subs = path.subPath.filter((s) => s.sectionTime > 0 || s.trafficType !== 3);
  const firstRide = subs.find((s) => s.trafficType === 1 || s.trafficType === 2);
  if (!firstRide) return null;

  let waitSec = null;
  let waitSrc = "추정";
  let nextWaitSec = null;

  if (firstRide.trafficType === 2 && firstRide.startID) {
    const rt = await realtimeStation(cfg, firstRide.startID);
    const arr = rt && findArrival(rt, laneName(firstRide));
    if (arr) {
      waitSec = arr[0].sec;
      waitSrc = "실시간";
      nextWaitSec = arr[1]?.sec ?? null;
      firstRide.leftStation = arr[0].left;
    }
  }
  if (waitSec == null) {
    const interval = firstRide.lane?.[0]?.busInterval ?? firstRide.intervalTime;
    waitSec = interval ? Math.round((+interval * 60) / 2) : 300;
  }

  // 첫 탑승 지점까지 걸어가는 시간: 그보다 버스가 빨리 오면 그 차는 못 탄다
  let walkToFirst = 0;
  for (const s of path.subPath) {
    if (s === firstRide) break;
    if (s.trafficType === 3) walkToFirst += (s.sectionTime || 0) * 60;
  }
  if (waitSrc === "실시간" && waitSec < walkToFirst) {
    if (nextWaitSec != null && nextWaitSec >= walkToFirst) {
      waitSec = nextWaitSec; // 첫 차는 걸어가는 사이에 가버림 → 다음 차 기준
      firstRide.missedFirst = true;
    } else {
      waitSec = Math.max(waitSec, walkToFirst); // 정보 부족: 최소한 도보시간
    }
  }

  const rideAndWalkSec = info.totalTime * 60; // ODsay totalTime = 도보+탑승 합
  const effectiveWait = Math.max(waitSec - walkToFirst, 0); // 정류장에서 실제로 기다리는 시간
  return {
    path,
    waitSec,
    effectiveWait,
    waitSrc,
    nextWaitSec,
    totalSec: effectiveWait + rideAndWalkSec,
    transfers: (info.busTransitCount || 0) + (info.subwayTransitCount || 0) - 1,
    fare: info.payment,
  };
}

// ---------------------------------------------------------------- 출력

const fmtClock = (d) =>
  d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });

const fmtDur = (sec) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
};

const fmtWait = (sec) =>
  sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분 ${sec % 60 ? `${sec % 60}초` : ""}`.trim();

function printOption(o, now, star) {
  const eta = new Date(now.getTime() + o.totalSec * 1000);
  console.log(
    `\n${star ? "⭐ 지금 이거 타세요" : "   놓치면 이걸로"} — ${fmtClock(eta)} 도착 예상` +
      `  (총 ${fmtDur(o.totalSec)}, 환승 ${Math.max(o.transfers, 0)}회` +
      (o.fare ? `, ${o.fare.toLocaleString("ko-KR")}원` : "") + ")",
  );
  for (const s of o.path.subPath) {
    if (s.trafficType === 3) {
      if (s.sectionTime > 0) console.log(`     🚶 도보 ${s.sectionTime}분`);
      continue;
    }
    const icon = T_ICON[s.trafficType];
    const name = laneName(s);
    let line = `     ${icon} ${name}  ${s.startName} → ${s.endName}  (${s.stationCount}개 정거장, ${s.sectionTime}분)`;
    if (s === o.path.subPath.find((x) => x.trafficType !== 3)) {
      if (o.waitSrc === "실시간") {
        line += `\n        └ ${s.missedFirst ? "⚠️ 첫 차는 못 잡음, 다음 차 " : "실시간: "}${fmtWait(o.waitSec)} 후 도착` +
          (s.leftStation != null ? ` (${s.leftStation}정거장 전)` : "") +
          (o.nextWaitSec != null && !s.missedFirst ? `, 그 다음 ${fmtWait(o.nextWaitSec)} 후` : "");
      } else {
        line += `\n        └ 실시간 정보 없음 → 대기 ${fmtDur(o.effectiveWait)} 추정`;
      }
    }
    console.log(line);
  }
}

// ---------------------------------------------------------------- 메인

function pickDirection(arg) {
  if (["출근", "go", "work"].includes(arg)) return "go";
  if (["퇴근", "home", "back"].includes(arg)) return "back";
  if (arg) return null;
  const h = +new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Seoul" }).format(new Date());
  return h < 12 ? "go" : "back";
}

async function main() {
  const cfg = loadConfig();
  const dir = pickDirection(args[0]);
  if (!dir) {
    console.error("사용법: node now.js [출근|퇴근] [--debug]");
    process.exit(1);
  }
  const from = dir === "go" ? cfg.home : cfg.work;
  const to = dir === "go" ? cfg.work : cfg.home;
  for (const p of [from, to])
    if (!p?.lat || !p?.lon) {
      console.error("config.json에 home/work 좌표를 설정해 주세요.");
      process.exit(1);
    }

  const now = new Date();
  console.log(`\n🏃 ${from.name} → ${to.name}  |  지금 ${fmtClock(now)} 기준 가장 빠른 방법`);

  const result = await searchPaths(cfg, from, to);
  const paths = result.path;
  if (!paths?.length) {
    console.error("경로를 찾지 못했습니다.");
    process.exit(1);
  }

  // ODsay가 준 후보 중 소요시간 짧은 상위 5개만 실시간 평가 (쿼터 절약)
  const top = [...paths]
    .sort((a, b) => a.info.totalTime - b.info.totalTime)
    .slice(0, 5);

  const evaluated = [];
  for (const p of top) {
    const e = await evaluate(cfg, p);
    if (e) evaluated.push(e);
  }
  if (!evaluated.length) {
    console.error("평가 가능한 경로가 없습니다.");
    process.exit(1);
  }

  // 핵심: 실시간 대기까지 포함한 실제 도착 시각으로 정렬
  evaluated.sort((a, b) => a.totalSec - b.totalSec);

  printOption(evaluated[0], now, true);
  if (evaluated[1]) printOption(evaluated[1], now, false);
  console.log();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
