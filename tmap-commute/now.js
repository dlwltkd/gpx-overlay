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
 * 설정 (config.json을 직접 열 필요 없음):
 *   node now.js set key  <ODsay키>
 *   node now.js set home 37.5647128, 126.9321536     지도에서 복사한 좌표 그대로
 *   node now.js set work 37.4979, 127.0276
 *   node now.js show                                  현재 설정 확인
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(ROOT, "config.json");
const BASE = "https://api.odsay.com/v1/api";

const DEBUG = process.argv.includes("--debug");
const args = process.argv.slice(2).filter((a) => a !== "--debug");

// ---------------------------------------------------------------- 설정

const readConfig = () =>
  existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, "utf8")) : {};

const writeConfig = (cfg) =>
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    console.error(
      "설정이 아직 없습니다. 아래 세 줄만 실행하면 됩니다:\n\n" +
        "  node now.js set key  <ODsay키>\n" +
        "  node now.js set home <집 좌표>\n" +
        "  node now.js set work <회사 좌표>\n\n" +
        "좌표는 구글맵에서 해당 위치를 우클릭하면 나오는 숫자를 그대로 붙여넣으면 됩니다.\n" +
        "ODsay 키 발급: https://lab.odsay.com (무료, 하루 1,000회)",
    );
    process.exit(1);
  }
  const cfg = readConfig();
  cfg.odsayKey = process.env.ODSAY_KEY || cfg.odsayKey;
  if (!cfg.odsayKey || cfg.odsayKey.startsWith("여기에")) {
    console.error(
      "ODsay API 키가 없습니다:  node now.js set key <ODsay키>\n" +
        "발급: https://lab.odsay.com (무료, 하루 1,000회)",
    );
    process.exit(1);
  }
  return cfg;
}

// ---------------------------------------------------------------- 좌표

// 대한민국 대략 범위 — lat/lon 뒤바뀜을 잡아내는 용도
const KR = { lat: [33, 39], lon: [124, 132] };

/** "37.5647128, 126.9321536" 같은 문자열에서 좌표를 뽑는다. 순서가 뒤바뀌면 바로잡음. */
function parseCoord(text) {
  const nums = String(text).match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return { error: "좌표를 읽지 못했습니다. 예: 37.5647128, 126.9321536" };
  let [a, b] = nums.slice(0, 2).map(Number);
  let swapped = false;
  const inKR = (lat, lon) =>
    lat >= KR.lat[0] && lat <= KR.lat[1] && lon >= KR.lon[0] && lon <= KR.lon[1];
  if (!inKR(a, b) && inKR(b, a)) {
    [a, b] = [b, a];
    swapped = true;
  }
  if (!inKR(a, b))
    return { error: `한국 범위를 벗어난 좌표입니다 (위도 ${a}, 경도 ${b}). 지도에서 다시 복사해 주세요.` };
  return { lat: a, lon: b, swapped };
}

function haversine(la1, lo1, la2, lo2) {
  const R = 6371000, r = Math.PI / 180;
  const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const h =
    Math.sin(dLa / 2) ** 2 +
    Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const mapLink = (p) => `https://maps.google.com/?q=${p.lat},${p.lon}`;

// ---------------------------------------------------------------- set / show

function cmdSet(rest) {
  const what = rest[0];
  const value = rest.slice(1).join(" ").trim().replace(/^["']|["']$/g, "");
  const cfg = readConfig();

  if (!["key", "home", "work"].includes(what) || !value) {
    console.error(
      "사용법:\n" +
        "  node now.js set key  <ODsay키>\n" +
        "  node now.js set home 37.5647128, 126.9321536\n" +
        "  node now.js set work 37.4979, 127.0276",
    );
    process.exit(1);
  }

  if (what === "key") {
    cfg.odsayKey = value;
    writeConfig(cfg);
    console.log(`✅ ODsay 키 저장 완료 (${value.slice(0, 6)}…${value.slice(-4)})`);
    return;
  }

  const c = parseCoord(value);
  if (c.error) {
    console.error(`❌ ${c.error}`);
    process.exit(1);
  }
  const label = what === "home" ? "집" : "회사";
  cfg[what] = { name: cfg[what]?.name || label, lat: c.lat, lon: c.lon };
  writeConfig(cfg);
  console.log(
    `✅ ${label} 좌표 저장: ${c.lat}, ${c.lon}` +
      (c.swapped ? "  (위도/경도 순서가 뒤바뀌어 있어 바로잡았습니다)" : ""),
  );
  console.log(`   확인: ${mapLink(cfg[what])}`);

  const other = what === "home" ? cfg.work : cfg.home;
  if (other?.lat) {
    const d = haversine(c.lat, c.lon, other.lat, other.lon);
    console.log(`   집 ↔ 회사 직선거리 ${(d / 1000).toFixed(1)}km`);
    if (d < 700)
      console.log("   ⚠️ 700m 이내라 ODsay가 경로를 주지 않습니다. 좌표를 다시 확인하세요.");
  } else {
    console.log(`   다음: node now.js set ${what === "home" ? "work" : "home"} <좌표>`);
  }
}

function cmdShow() {
  const cfg = readConfig();
  const mark = (v) => (v ? "✅" : "❌");
  console.log(`\n현재 설정 (${CONFIG_PATH})`);
  console.log(`  ${mark(cfg.odsayKey)} ODsay 키  ${cfg.odsayKey ? `${cfg.odsayKey.slice(0, 6)}…${cfg.odsayKey.slice(-4)}` : "미설정 → node now.js set key <키>"}`);
  for (const [k, label] of [["home", "집  "], ["work", "회사"]]) {
    const p = cfg[k];
    console.log(
      `  ${mark(p?.lat)} ${label}      ` +
        (p?.lat ? `${p.lat}, ${p.lon}   ${mapLink(p)}` : `미설정 → node now.js set ${k} <좌표>`),
    );
  }
  if (cfg.home?.lat && cfg.work?.lat) {
    const d = haversine(cfg.home.lat, cfg.home.lon, cfg.work.lat, cfg.work.lon);
    console.log(`\n  집 ↔ 회사 직선거리 ${(d / 1000).toFixed(1)}km`);
    if (d < 700) console.log("  ⚠️ 700m 이내 — ODsay가 경로를 주지 않습니다.");
  }
  console.log();
}

// ---------------------------------------------------------------- ODsay 호출

// 자주 만나는 오류 코드에 대한 대처법 (코드 의미는 ODsay 응답 메시지를 그대로 신뢰하고,
// 여기서는 "그래서 뭘 하면 되는지"만 덧붙인다)
const ERR_HINT = {
  "-98":
    "집/회사 좌표가 서로 너무 가깝습니다. 현재 값 확인은  node now.js show ,\n" +
    "   수정은  node now.js set home <좌표>  /  node now.js set work <좌표>",
  "-99": "출발지 또는 도착지가 대중교통 서비스 범위를 벗어났을 수 있습니다. 좌표를 확인하세요.",
  "500": "요청 파라미터 문제일 가능성이 큽니다.  node now.js show  로 좌표를 확인하세요.",
};

async function odsay(path, params, key) {
  const url = `${BASE}/${path}?${new URLSearchParams({ ...params, apiKey: key, lang: "0", output: "json" })}`;
  let res, text;
  try {
    res = await fetch(url);
    text = await res.text();
  } catch (e) {
    throw new Error(`ODsay 서버에 연결하지 못했습니다 (${e.message}). 인터넷 연결을 확인하세요.`);
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      `ODsay 응답을 해석할 수 없습니다 (HTTP ${res.status}).\n` +
        `응답: ${text.slice(0, 200)}\n\n` +
        "👉 회사/학교 방화벽이나 프록시가 api.odsay.com을 막고 있을 수 있습니다.",
    );
  }
  if (DEBUG) {
    console.error(`\n--- DEBUG ${path} ---`);
    console.error(JSON.stringify(body, null, 2).slice(0, 4000));
  }
  const err = Array.isArray(body.error) ? body.error[0] : body.error;
  if (err) {
    const hint = ERR_HINT[String(err.code)];
    throw new Error(
      `ODsay 오류 (${path}): [${err.code}] ${err.message || err.msg}` +
        (hint ? `\n\n👉 ${hint}` : ""),
    );
  }
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
  if (args[0] === "set") return cmdSet(args.slice(1));
  if (args[0] === "show") return cmdShow();

  const cfg = loadConfig();
  const dir = pickDirection(args[0]);
  if (!dir) {
    console.error(
      "사용법:\n" +
        "  node now.js [출근|퇴근] [--debug]\n" +
        "  node now.js set key|home|work <값>\n" +
        "  node now.js show",
    );
    process.exit(1);
  }
  const from = dir === "go" ? cfg.home : cfg.work;
  const to = dir === "go" ? cfg.work : cfg.home;
  for (const [k, p] of [["home", cfg.home], ["work", cfg.work]])
    if (!p?.lat || !p?.lon) {
      console.error(
        `${k === "home" ? "집" : "회사"} 좌표가 없습니다:  node now.js set ${k} <좌표>\n` +
          "좌표는 구글맵에서 위치를 우클릭하면 나오는 숫자를 그대로 붙여넣으면 됩니다.",
      );
      process.exit(1);
    }

  // ODsay는 출발/도착이 700m 이내면 경로를 주지 않는다 — 호출 전에 미리 잡아준다
  const gap = haversine(from.lat, from.lon, to.lat, to.lon);
  if (gap < 700) {
    console.error(
      `집과 회사 좌표가 ${Math.round(gap)}m 밖에 떨어져 있지 않습니다 (ODsay는 700m 이내 경로를 주지 않음).\n` +
        "좌표가 잘못 들어간 것 같습니다:  node now.js show  로 확인 후 다시 설정하세요.",
    );
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
