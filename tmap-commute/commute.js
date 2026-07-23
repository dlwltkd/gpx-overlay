#!/usr/bin/env node
/**
 * tmap-commute — 티맵 대중교통 API로 출퇴근 최단 시간 경로 찾기
 *
 * 출발지/도착지는 config.json에 고정해 두고,
 * 환승 횟수와 상관없이 "총 소요 시간"이 가장 짧은 경로를 보여준다.
 * 지하철 + 버스 모두 포함.
 *
 * 사용법:
 *   node commute.js            시간대에 따라 출근/퇴근 자동 선택
 *   node commute.js 출근       집 → 회사
 *   node commute.js 퇴근       회사 → 집
 *   node commute.js search <검색어>   장소 좌표 검색 (config 설정용)
 *   node commute.js demo       API 키 없이 출력 예시 보기
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(ROOT, "config.json");

const TRANSIT_URL = "https://apis.openapi.sk.com/transit/routes";
const POI_URL = "https://apis.openapi.sk.com/tmap/pois";

const MODE_LABEL = {
  WALK: "🚶 도보",
  BUS: "🚌 버스",
  SUBWAY: "🚇 지하철",
  EXPRESSBUS: "🚍 고속/시외버스",
  TRAIN: "🚆 기차",
  AIRPLANE: "✈️ 항공",
  FERRY: "⛴️ 배",
};

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    console.error(
      [
        "config.json 파일이 없습니다.",
        "",
        "1) config.example.json을 config.json으로 복사하세요:",
        "   cp config.example.json config.json",
        "2) 집/회사 좌표를 채워 넣으세요. 좌표는 이렇게 찾을 수 있습니다:",
        '   node commute.js search "우리집 아파트 이름"',
        '   node commute.js search "회사 건물 이름"',
        "3) https://openapi.sk.com 에서 발급받은 appKey를 넣거나",
        "   TMAP_APP_KEY 환경변수로 설정하세요.",
      ].join("\n"),
    );
    process.exit(1);
  }
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  cfg.appKey = process.env.TMAP_APP_KEY || cfg.appKey;
  return cfg;
}

function requireKey(cfg) {
  if (!cfg.appKey || cfg.appKey === "여기에-티맵-appKey") {
    console.error(
      "티맵 appKey가 설정되지 않았습니다.\n" +
        "https://openapi.sk.com 에서 앱을 만들고 발급받은 키를\n" +
        "config.json의 appKey 항목 또는 TMAP_APP_KEY 환경변수에 넣어주세요.",
    );
    process.exit(1);
  }
}

async function api(url, options, appKey) {
  const res = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      appKey,
      ...(options?.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`API 응답을 해석할 수 없습니다 (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || body.error) {
    const msg =
      body.error?.message || body.result?.message || `HTTP ${res.status}`;
    throw new Error(`티맵 API 오류: ${msg}`);
  }
  return body;
}

function fmtMin(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}분`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

function fmtClock(date) {
  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
}

function legLine(leg) {
  const label = MODE_LABEL[leg.mode] || leg.mode;
  const time = fmtMin(leg.sectionTime);
  if (leg.mode === "WALK") {
    const dist = leg.distance != null ? ` ${leg.distance}m` : "";
    return `${label}${dist} · ${time}`;
  }
  const route = leg.route ? ` ${leg.route}` : "";
  const stops = leg.passStopList?.stationList?.length
    ? ` (${leg.passStopList.stationList.length - 1}개 정거장)`
    : "";
  return `${label}${route} · ${leg.start.name} → ${leg.end.name}${stops} · ${time}`;
}

function printItinerary(it, rank, departAt) {
  const fare = it.fare?.regular?.totalFare;
  const arrive = departAt
    ? new Date(departAt.getTime() + it.totalTime * 1000)
    : null;
  console.log(
    `\n${rank === 1 ? "⭐ 최단 경로" : `${rank}위`}  총 ${fmtMin(it.totalTime)}` +
      (arrive ? `  (지금 출발 시 ${fmtClock(arrive)} 도착 예상)` : "") +
      `  |  환승 ${it.transferCount ?? 0}회` +
      `  |  도보 ${fmtMin(it.totalWalkTime ?? 0)}` +
      (fare != null ? `  |  ${fare.toLocaleString("ko-KR")}원` : ""),
  );
  for (const leg of it.legs || []) {
    console.log(`   ${legLine(leg)}`);
  }
}

function printPlan(body, from, to, topN) {
  const itineraries = body.metaData?.plan?.itineraries;
  if (!itineraries?.length) {
    console.error("경로를 찾지 못했습니다. 좌표를 확인해 주세요.");
    process.exit(1);
  }
  // 핵심: 환승 수는 완전히 무시하고 순수하게 총 소요 시간으로만 정렬
  const sorted = [...itineraries].sort((a, b) => a.totalTime - b.totalTime);

  const now = new Date();
  console.log(`\n📍 ${from.name} → ${to.name}   (기준 시각 ${fmtClock(now)})`);
  console.log(`   대중교통 경로 ${sorted.length}개 중 빠른 순 상위 ${Math.min(topN, sorted.length)}개`);

  sorted.slice(0, topN).forEach((it, i) => printItinerary(it, i + 1, now));
  console.log();
}

async function route(cfg, from, to) {
  requireKey(cfg);
  const body = await api(
    TRANSIT_URL,
    {
      method: "POST",
      body: JSON.stringify({
        startX: String(from.lon),
        startY: String(from.lat),
        endX: String(to.lon),
        endY: String(to.lat),
        count: 10,
        lang: 0,
        format: "json",
      }),
    },
    cfg.appKey,
  );
  printPlan(body, from, to, cfg.show ?? 3);
}

async function searchPoi(cfg, keyword) {
  requireKey(cfg);
  const params = new URLSearchParams({
    version: "1",
    searchKeyword: keyword,
    searchType: "all",
    page: "1",
    count: "10",
    resCoordType: "WGS84GEO",
    reqCoordType: "WGS84GEO",
  });
  const body = await api(`${POI_URL}?${params}`, { method: "GET" }, cfg.appKey);
  const pois = body.searchPoiInfo?.pois?.poi || [];
  if (!pois.length) {
    console.log("검색 결과가 없습니다.");
    return;
  }
  console.log(`\n"${keyword}" 검색 결과 — config.json에 lat/lon을 복사하세요:\n`);
  for (const p of pois) {
    const addr = [p.upperAddrName, p.middleAddrName, p.roadName, p.firstBuildNo]
      .filter(Boolean)
      .join(" ");
    console.log(`  ${p.name}  (${addr})`);
    console.log(`    "lat": ${p.frontLat}, "lon": ${p.frontLon}`);
  }
  console.log();
}

function demo() {
  const sample = JSON.parse(
    readFileSync(join(ROOT, "sample-response.json"), "utf8"),
  );
  printPlan(
    sample,
    { name: "집(예시)" },
    { name: "회사(예시)" },
    3,
  );
}

function pickDirection(arg) {
  if (["출근", "go", "work"].includes(arg)) return "go";
  if (["퇴근", "home", "back"].includes(arg)) return "back";
  if (arg) return null;
  // 인자가 없으면 시간으로 판단: 정오 이전이면 출근, 이후면 퇴근
  const hourKST = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Seoul",
    }).format(new Date()),
  );
  return hourKST < 12 ? "go" : "back";
}

async function main() {
  const [arg, ...rest] = process.argv.slice(2);

  if (arg === "demo") return demo();

  const cfg = loadConfig();

  if (arg === "search") {
    const keyword = rest.join(" ").trim();
    if (!keyword) {
      console.error('사용법: node commute.js search "장소 이름"');
      process.exit(1);
    }
    return searchPoi(cfg, keyword);
  }

  const dir = pickDirection(arg);
  if (!dir) {
    console.error(
      "알 수 없는 명령입니다. 사용법:\n" +
        "  node commute.js [출근|퇴근]\n" +
        '  node commute.js search "장소 이름"\n' +
        "  node commute.js demo",
    );
    process.exit(1);
  }

  const from = dir === "go" ? cfg.home : cfg.work;
  const to = dir === "go" ? cfg.work : cfg.home;
  for (const [label, place] of [["출발지", from], ["도착지", to]]) {
    if (!place?.lat || !place?.lon) {
      console.error(
        `${label} 좌표가 config.json에 없습니다. node commute.js search 로 좌표를 찾아 넣어주세요.`,
      );
      process.exit(1);
    }
  }
  console.log(dir === "go" ? "🌅 출근 경로를 찾는 중..." : "🌆 퇴근 경로를 찾는 중...");
  await route(cfg, from, to);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
