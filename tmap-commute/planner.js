#!/usr/bin/env node
/**
 * planner.js — 시각표 기반 대중교통 경로 탐색 (RAPTOR 알고리즘)
 *
 * 출발 시각 + 출발지 + 도착지를 받아서, GTFS 시각표에 있는
 * 각 버스/지하철의 실제 출발·도착 시각을 전부 보고 경로를 계산한다.
 *
 * - 환승 여유가 minTransferSec(기본 60초)만 넘으면 일단 옵션에 포함
 * - 여유가 safeTransferSec(기본 180초) 미만이면 ⚠️ 아슬아슬 표시
 * - 환승 횟수별 파레토 최적 경로 + 다음 출발편까지 여러 옵션 제시
 *
 * 사용법:
 *   node planner.js --gtfs ./gtfs --from "역삼" --to "시청" --at 08:00
 *   node planner.js --from "37.49,127.01" --to "회사" --at 08:00 --date 20260724
 *   node planner.js demo        번들된 샘플 시각표로 동작 확인
 *
 * GTFS 데이터: 국가대중교통정보(TAGO)·공공데이터포털(data.go.kr) 등에서
 * 받아 압축을 푼 폴더를 --gtfs 로 지정한다. (stops.txt, routes.txt,
 * trips.txt, stop_times.txt, calendar.txt 필요 / transfers.txt 선택)
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- 설정

const DEFAULTS = {
  maxRounds: 6, // 최대 탑승 횟수 (환승 5회)
  minTransferSec: 60, // 이보다 여유가 적으면 그 차편은 못 탄다고 판단
  safeTransferSec: 180, // 이보다 여유가 적으면 "아슬아슬" 경고
  walkSpeed: 1.1, // m/s
  maxOriginWalk: 800, // 출발/도착지에서 정류장까지 최대 도보 (m)
  maxTransferWalk: 300, // 환승 도보 최대 거리 (m)
  transferPenaltySec: 20, // 도보 환승에 붙는 고정 시간 (계단 등)
  options: 4, // 제시할 옵션 개수 (출발 시각을 늦춰가며 탐색)
};

// ---------------------------------------------------------------- 유틸

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  const push = () => { row.push(field); field = ""; };
  const pushRow = () => { push(); if (row.length > 1 || row[0] !== "") rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") push();
    else if (c === "\n") pushRow();
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) pushRow();
  const header = rows[0].map((h) => h.replace(/^﻿/, "").trim());
  return rows.slice(1).map((r) => {
    const o = {};
    header.forEach((h, i) => (o[h] = r[i] ?? ""));
    return o;
  });
}

function readTable(dir, name, optional = false) {
  const p = join(dir, name);
  if (!existsSync(p)) {
    if (optional) return [];
    console.error(`GTFS 파일이 없습니다: ${p}`);
    process.exit(1);
  }
  return parseCSV(readFileSync(p, "utf8"));
}

// "08:03:00" -> 초 (GTFS는 24시 넘는 시각도 허용: 25:10:00)
function hms(s) {
  const [h, m, sec] = s.split(":").map(Number);
  return h * 3600 + m * 60 + (sec || 0);
}

function fmtT(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return `${String(h % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function fmtDur(sec) {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
}

function fmtSlack(sec) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return s ? `${m}분 ${s}초` : `${m}분`;
}

function haversine(la1, lo1, la2, lo2) {
  const R = 6371000, r = Math.PI / 180;
  const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a =
    Math.sin(dLa / 2) ** 2 +
    Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------------------------------------------------------------- GTFS 로딩

function loadGTFS(dir, dateStr, opt) {
  const stopsRaw = readTable(dir, "stops.txt");
  const routesRaw = readTable(dir, "routes.txt");
  const tripsRaw = readTable(dir, "trips.txt");
  const stRaw = readTable(dir, "stop_times.txt");
  const cal = readTable(dir, "calendar.txt", true);
  const calDates = readTable(dir, "calendar_dates.txt", true);
  const transfersRaw = readTable(dir, "transfers.txt", true);

  // 해당 날짜에 운행하는 service_id 집합
  const dow = new Date(
    Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(4, 6) - 1, +dateStr.slice(6, 8)),
  ).getUTCDay();
  const dayCol = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][dow];
  const active = new Set();
  for (const c of cal) {
    if (c[dayCol] === "1" && c.start_date <= dateStr && dateStr <= c.end_date)
      active.add(c.service_id);
  }
  for (const d of calDates) {
    if (d.date !== dateStr) continue;
    if (d.exception_type === "1") active.add(d.service_id);
    else active.delete(d.service_id);
  }

  const stops = new Map(); // id -> {name, lat, lon, idx}
  for (const s of stopsRaw)
    stops.set(s.stop_id, {
      id: s.stop_id,
      name: s.stop_name,
      lat: +s.stop_lat,
      lon: +s.stop_lon,
    });

  const routes = new Map();
  for (const r of routesRaw)
    routes.set(r.route_id, {
      name: r.route_short_name || r.route_long_name,
      type: +r.route_type, // 1=지하철, 3=버스 ...
    });

  // trip별 정차 시각
  const byTrip = new Map();
  for (const st of stRaw) {
    if (!byTrip.has(st.trip_id)) byTrip.set(st.trip_id, []);
    byTrip.get(st.trip_id).push(st);
  }

  // 같은 정차 패턴끼리 묶기 (RAPTOR의 "route")
  const patterns = new Map();
  for (const t of tripsRaw) {
    if (!active.has(t.service_id)) continue;
    const sts = byTrip.get(t.trip_id);
    if (!sts || sts.length < 2) continue;
    sts.sort((a, b) => +a.stop_sequence - +b.stop_sequence);
    const key = t.route_id + "|" + sts.map((s) => s.stop_id).join("|");
    if (!patterns.has(key))
      patterns.set(key, {
        routeId: t.route_id,
        stops: sts.map((s) => s.stop_id),
        trips: [],
      });
    patterns.get(key).trips.push({
      id: t.trip_id,
      headsign: t.trip_headsign || "",
      arr: sts.map((s) => hms(s.arrival_time || s.departure_time)),
      dep: sts.map((s) => hms(s.departure_time || s.arrival_time)),
    });
  }
  const patternList = [...patterns.values()];
  for (const p of patternList) p.trips.sort((a, b) => a.dep[0] - b.dep[0]);

  // 각 정류장에 서는 패턴 목록
  const patternsAtStop = new Map();
  patternList.forEach((p, pi) =>
    p.stops.forEach((sid, si) => {
      if (!patternsAtStop.has(sid)) patternsAtStop.set(sid, []);
      patternsAtStop.get(sid).push([pi, si]);
    }),
  );

  // 도보 환승 경로: transfers.txt 우선, 없으면 좌표 기반 자동 생성
  const footpaths = new Map(); // stop_id -> [{to, sec}]
  const addFoot = (a, b, sec) => {
    if (a === b) return;
    if (!footpaths.has(a)) footpaths.set(a, []);
    footpaths.get(a).push({ to: b, sec });
  };
  if (transfersRaw.length) {
    for (const tr of transfersRaw) {
      if (tr.transfer_type === "3") continue; // 환승 불가
      const sec = +tr.min_transfer_time || opt.transferPenaltySec;
      addFoot(tr.from_stop_id, tr.to_stop_id, sec);
      addFoot(tr.to_stop_id, tr.from_stop_id, sec);
    }
  } else {
    // 격자 해시로 근처 정류장만 비교 (전국 데이터에서도 O(n²) 회피)
    const cell = 0.004; // ≈ 400m
    const grid = new Map();
    const keyOf = (la, lo) => `${Math.floor(la / cell)},${Math.floor(lo / cell)}`;
    for (const s of stops.values()) {
      const k = keyOf(s.lat, s.lon);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(s);
    }
    for (const s of stops.values()) {
      const cla = Math.floor(s.lat / cell), clo = Math.floor(s.lon / cell);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          for (const t of grid.get(`${cla + dy},${clo + dx}`) || []) {
            if (t.id === s.id) continue;
            const d = haversine(s.lat, s.lon, t.lat, t.lon);
            if (d <= opt.maxTransferWalk)
              addFoot(s.id, t.id, Math.round(d / opt.walkSpeed) + opt.transferPenaltySec);
          }
    }
  }

  return { stops, routes, patternList, patternsAtStop, footpaths };
}

// ---------------------------------------------------------------- RAPTOR

/**
 * @param sources Map(stop_id -> 출발지에서 그 정류장까지 도보 초)
 * @param targets Map(stop_id -> 그 정류장에서 도착지까지 도보 초)
 * @returns 파레토 최적 여정 목록 (탑승 횟수별)
 */
function raptor(net, sources, targets, depTime, opt) {
  const INF = Infinity;
  const best = new Map(); // stop -> 지금까지의 최소 도착 시각
  const tau = []; // tau[k] = Map(stop -> k회 탑승 이내 도착 시각)
  const parents = []; // parents[k] = Map(stop -> 도착 방법)

  tau[0] = new Map();
  parents[0] = new Map();
  let marked = new Set();
  for (const [sid, walkSec] of sources) {
    const t = depTime + walkSec;
    tau[0].set(sid, t);
    best.set(sid, t);
    parents[0].set(sid, { t: "origin", walkSec });
    marked.add(sid);
  }

  for (let k = 1; k <= opt.maxRounds; k++) {
    tau[k] = new Map(tau[k - 1]);
    parents[k] = new Map();
    const newMarked = new Set();

    // 이번 라운드에 훑어야 할 패턴과 시작 위치
    const queue = new Map(); // patternIdx -> 가장 이른 정차 인덱스
    for (const sid of marked)
      for (const [pi, si] of net.patternsAtStop.get(sid) || []) {
        const cur = queue.get(pi);
        if (cur === undefined || si < cur) queue.set(pi, si);
      }

    for (const [pi, startIdx] of queue) {
      const pat = net.patternList[pi];
      let trip = null, tripIdx = -1, boardIdx = -1;

      for (let i = startIdx; i < pat.stops.length; i++) {
        const sid = pat.stops[i];

        // 타고 있는 차로 이 정류장에 내렸을 때 개선되는가
        if (trip) {
          const arr = trip.arr[i];
          if (arr < (best.get(sid) ?? INF)) {
            tau[k].set(sid, arr);
            best.set(sid, arr);
            parents[k].set(sid, { t: "ride", pi, tripIdx, boardIdx, alightIdx: i });
            newMarked.add(sid);
          }
        }

        // 이 정류장에서 더 이른 차를 잡을 수 있는가
        const reach = tau[k - 1].get(sid);
        if (reach !== undefined) {
          const buffer = k === 1 ? 0 : opt.minTransferSec;
          const catchable = reach + buffer;
          // dep 시각이 catchable 이후인 가장 이른 trip (추월 대비 선형 탐색)
          let bi = -1;
          for (let j = 0; j < pat.trips.length; j++) {
            if (pat.trips[j].dep[i] >= catchable) { bi = j; break; }
          }
          if (bi >= 0 && (!trip || pat.trips[bi].dep[i] < trip.dep[i])) {
            trip = pat.trips[bi];
            tripIdx = bi;
            boardIdx = i;
          }
        }
      }
    }

    // 도보 환승 전파
    for (const sid of [...newMarked]) {
      const base = tau[k].get(sid);
      for (const { to, sec } of net.footpaths.get(sid) || []) {
        const t = base + sec;
        if (t < (best.get(to) ?? INF)) {
          tau[k].set(to, t);
          best.set(to, t);
          parents[k].set(to, { t: "foot", from: sid, sec });
          newMarked.add(to);
        }
      }
    }

    marked = newMarked;
    if (!marked.size) break;
  }

  // 라운드(=탑승 횟수)별 파레토 최적 도착 옵션 추출
  const journeys = [];
  let bestArrSoFar = INF;
  for (let k = 1; k < tau.length; k++) {
    let bestStop = null, bestArr = INF, bestWalkOut = 0;
    for (const [sid, walkOut] of targets) {
      const t = tau[k].get(sid);
      if (t !== undefined && t + walkOut < bestArr) {
        bestArr = t + walkOut;
        bestStop = sid;
        bestWalkOut = walkOut;
      }
    }
    if (bestStop && bestArr < bestArrSoFar) {
      const j = backtrack(net, tau, parents, k, bestStop, opt);
      if (j) {
        j.arrival = bestArr;
        j.walkOut = bestWalkOut;
        journeys.push(j);
        bestArrSoFar = bestArr;
      }
    }
  }
  return journeys;
}

function findParent(parents, k, stop) {
  for (let r = k; r >= 0; r--) {
    const p = parents[r].get(stop);
    if (p) return [r, p];
  }
  return [null, null];
}

function backtrack(net, tau, parents, k, destStop, opt) {
  const legs = [];
  let stop = destStop, round = k;
  let guard = 200;
  while (guard-- > 0) {
    const [r, p] = findParent(parents, round, stop);
    if (!p) return null;
    if (p.t === "origin") {
      legs.push({ kind: "walk-in", walkSec: p.walkSec, to: stop });
      break;
    }
    if (p.t === "foot") {
      legs.push({ kind: "foot", from: p.from, to: stop, sec: p.sec });
      stop = p.from;
      round = r; // 도보는 같은 라운드의 하차 정류장에서 이어짐
      continue;
    }
    // ride
    const pat = net.patternList[p.pi];
    const trip = pat.trips[p.tripIdx];
    legs.push({
      kind: "ride",
      routeId: pat.routeId,
      headsign: trip.headsign,
      from: pat.stops[p.boardIdx],
      to: pat.stops[p.alightIdx],
      dep: trip.dep[p.boardIdx],
      arr: trip.arr[p.alightIdx],
      nStops: p.alightIdx - p.boardIdx,
    });
    stop = pat.stops[p.boardIdx];
    round = r - 1;
  }
  legs.reverse();

  // 환승 여유 계산: 각 탑승 직전, 승강장 도착 시각과 차 출발 시각의 차
  let clock = null; // 승강장 도착 시각
  let rides = 0;
  let risky = false;
  for (const leg of legs) {
    if (leg.kind === "walk-in") clock = null; // 출발 시각 기준은 호출부에서
    else if (leg.kind === "foot") { if (clock !== null) clock += leg.sec; }
    else {
      rides++;
      if (clock !== null) {
        leg.slack = leg.dep - clock;
        leg.tight = leg.slack < opt.safeTransferSec;
        if (leg.tight) risky = true;
      }
      clock = leg.arr;
    }
  }
  return { legs, transfers: rides - 1, risky };
}

// ---------------------------------------------------------------- 출발지/도착지 해석

function resolvePlace(net, spec, opt) {
  // "37.49,127.01" 좌표 또는 정류장 이름 부분일치
  const m = spec.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  const out = new Map();
  if (m) {
    const lat = +m[1], lon = +m[2];
    for (const s of net.stops.values()) {
      const d = haversine(lat, lon, s.lat, s.lon);
      if (d <= opt.maxOriginWalk) out.set(s.id, Math.round(d / opt.walkSpeed));
    }
    return { label: spec, stops: out };
  }
  for (const s of net.stops.values())
    if (s.name.includes(spec)) out.set(s.id, 0);
  return { label: spec, stops: out };
}

// ---------------------------------------------------------------- 출력

const ROUTE_ICON = { 0: "🚊", 1: "🚇", 2: "🚆", 3: "🚌", 4: "⛴️", 7: "🚡" };

function printJourney(net, j, idx, depTime, isBest) {
  const first = j.legs.find((l) => l.kind === "ride");
  const head =
    `${isBest ? "⭐" : "  "} 옵션 ${idx}  ` +
    `${fmtT(first.dep)} 승차 → ${fmtT(j.arrival)} 도착` +
    `  (총 ${fmtDur(j.arrival - depTime)}, 환승 ${j.transfers}회)` +
    (j.risky ? "  ⚠️ 환승 아슬아슬" : "");
  console.log("\n" + head);

  for (const leg of j.legs) {
    if (leg.kind === "walk-in") {
      if (leg.walkSec > 0)
        console.log(`     🚶 출발지 → ${net.stops.get(leg.to).name}  도보 ${fmtDur(leg.walkSec)}`);
    } else if (leg.kind === "foot") {
      console.log(
        `     🚶 ${net.stops.get(leg.from).name} → ${net.stops.get(leg.to).name}  도보 ${fmtSlack(leg.sec)}`,
      );
    } else {
      const route = net.routes.get(leg.routeId);
      const icon = ROUTE_ICON[route?.type] || "🚌";
      const slackNote =
        leg.slack !== undefined
          ? `  [환승 여유 ${fmtSlack(leg.slack)}${leg.tight ? " ⚠️" : ""}]`
          : "";
      console.log(
        `     ${icon} ${route?.name || leg.routeId}  ` +
          `${net.stops.get(leg.from).name} ${fmtT(leg.dep)} → ` +
          `${net.stops.get(leg.to).name} ${fmtT(leg.arr)}` +
          `  (${leg.nStops}개 정거장)${slackNote}`,
      );
    }
  }
  if (j.walkOut > 0) console.log(`     🚶 도착지까지 도보 ${fmtDur(j.walkOut)}`);
}

// ---------------------------------------------------------------- 메인

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) a[argv[i].slice(2)] = argv[++i];
    else a._.push(argv[i]);
  }
  return a;
}

function todayKST() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" })
    .format(new Date())
    .replaceAll("-", "");
}

function nowKSTsec() {
  const [h, m] = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul",
  }).format(new Date()).split(":");
  return +h * 3600 + +m * 60;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const demo = args._[0] === "demo";

  const opt = { ...DEFAULTS };
  for (const k of ["minTransferSec", "safeTransferSec", "maxRounds", "options"])
    if (args[k] !== undefined) opt[k] = +args[k];

  const gtfsDir = demo ? join(ROOT, "sample-gtfs") : args.gtfs;
  const from = demo ? (args.from || "행복아파트") : args.from;
  const to = demo ? (args.to || "회사") : args.to;
  const date = args.date || todayKST();
  const depTime = args.at ? hms(args.at) : demo ? hms("08:00") : nowKSTsec();

  if (!gtfsDir || !from || !to) {
    console.error(
      "사용법: node planner.js --gtfs <GTFS폴더> --from <정류장이름|위도,경도> --to <...> [--at HH:MM] [--date YYYYMMDD]\n" +
        "        node planner.js demo",
    );
    process.exit(1);
  }

  const net = loadGTFS(gtfsDir, date, opt);
  const src = resolvePlace(net, from, opt);
  const dst = resolvePlace(net, to, opt);
  if (!src.stops.size || !dst.stops.size) {
    console.error(
      `${!src.stops.size ? `출발지 "${from}"` : `도착지 "${to}"`} 에 해당하는 정류장을 찾지 못했습니다.`,
    );
    process.exit(1);
  }

  console.log(
    `\n🧭 ${src.label} → ${dst.label}  |  ${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)} ${fmtT(depTime)} 출발 기준`,
  );
  console.log(
    `   환승 최소 여유 ${fmtSlack(opt.minTransferSec)} (그 이상이면 일단 옵션에 포함, ${fmtSlack(opt.safeTransferSec)} 미만이면 ⚠️ 표시)`,
  );

  // 출발 시각을 조금씩 늦춰가며 여러 출발편 옵션을 모은다
  const all = [];
  const seen = new Set();
  let t = depTime;
  for (let iter = 0; iter < opt.options * 2 && all.length < opt.options * 2; iter++) {
    const js = raptor(net, src.stops, dst.stops, t, opt);
    if (!js.length) break;
    let earliestDep = Infinity;
    for (const j of js) {
      const rides = j.legs.filter((l) => l.kind === "ride");
      const sig = rides.map((r) => `${r.routeId}@${r.dep}`).join(">");
      earliestDep = Math.min(earliestDep, rides[0].dep);
      if (!seen.has(sig)) {
        seen.add(sig);
        j.queryTime = t;
        all.push(j);
      }
    }
    if (!isFinite(earliestDep)) break;
    t = earliestDep + 60; // 첫 차를 놓쳤다고 가정하고 다음 출발편 탐색
  }

  if (!all.length) {
    console.log("\n   해당 시각 이후 운행 중인 경로를 찾지 못했습니다 (시각표/날짜 확인).");
    process.exit(0);
  }

  all.sort((a, b) => a.arrival - b.arrival || a.transfers - b.transfers);
  const show = all.slice(0, opt.options);
  show.forEach((j, i) => printJourney(net, j, i + 1, depTime, i === 0));
  console.log();
}

main();
