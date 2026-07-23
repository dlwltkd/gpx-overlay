# tmap-commute

출퇴근 최단 시간 경로를 찾아주는 CLI. 두 가지 도구가 들어 있습니다:

| 파일 | 방식 | 특징 |
|---|---|---|
| `planner.js` | **자체 알고리즘 (RAPTOR)** — 시각표(GTFS)를 직접 읽고 계산 | 출발 시각 지정, 차편별 출발·도착 시각, 아슬아슬한 환승도 옵션으로 제시 |
| `commute.js` | 티맵 대중교통 API 호출 | 설정만 하면 바로 사용, 실시간 기준 |

## planner.js — 시각표 기반 경로 탐색 알고리즘

핵심은 이쪽입니다. 실제 대중교통 앱들이 쓰는 **RAPTOR**(Round-bAsed
Public Transit Routing) 알고리즘을 의존성 없이 구현했습니다.

동작 방식:

1. GTFS 시각표에서 해당 날짜에 운행하는 모든 버스/지하철 차편을 읽는다.
2. 출발 시각부터 라운드를 돌며 "k번 탑승으로 각 정류장에 도착할 수 있는
   가장 이른 시각"을 계산한다. 이때 각 차편의 **실제 출발·도착 시각**을 보고
   탈 수 있는 차인지 판정한다.
3. 환승 여유가 `minTransferSec`(기본 60초)만 넘으면 **일단 옵션에 포함**하고,
   `safeTransferSec`(기본 180초) 미만이면 ⚠️ **아슬아슬** 표시를 붙인다.
4. 환승 횟수별 파레토 최적 경로를 뽑고, 첫 차를 놓친 경우까지 가정해
   출발 시각을 늦춰가며 여러 옵션을 모아 도착 시각 순으로 보여준다.

```bash
node planner.js demo                                  # 샘플 시각표로 바로 확인
node planner.js --gtfs ./gtfs --from "역삼" --to "시청" --at 08:00
node planner.js --gtfs ./gtfs --from "37.49,127.01" --to "회사" --at 08:00 --date 20260724
```

옵션:

- `--at HH:MM` 출발 시각 (생략 시 현재 시각)
- `--date YYYYMMDD` 날짜 (요일별 운행 계획 반영, 생략 시 오늘)
- `--minTransferSec 60` 이 여유보다 짧으면 그 차는 못 탄다고 판단
- `--safeTransferSec 180` 이 여유 미만이면 ⚠️ 표시
- `--options 4` 제시할 옵션 개수

출력 예시 (`node planner.js demo`):

```
🧭 행복아파트 → 회사  |  2026-07-23 08:00 출발 기준

⭐ 옵션 1  08:00 승차 → 08:18 도착  (총 18분, 환승 1회)  ⚠️ 환승 아슬아슬
     🚌 401  행복아파트 08:00 → 환승센터 08:08  (2개 정거장)
     🚶 환승센터 → 환승역  도보 1분 11초
     🚇 2호선  환승역 08:12 → 회사앞역 08:18  (2개 정거장)  [환승 여유 2분 49초 ⚠️]

   옵션 2  08:05 승차 → 08:24 도착  (총 24분, 환승 1회)
     🚌 9000  행복아파트 08:05 → 환승센터 08:11  (1개 정거장)
     🚇 2호선  환승역 08:18 → 회사앞역 08:24  [환승 여유 5분 49초]
```

### 시각표 데이터 (GTFS) 구하기

`planner.js`는 표준 GTFS 형식(`stops.txt`, `routes.txt`, `trips.txt`,
`stop_times.txt`, `calendar.txt`)을 읽습니다. 한국 데이터는
[공공데이터포털(data.go.kr)](https://www.data.go.kr)과
국가대중교통정보센터(TAGO), 서울열린데이터광장의 노선/시각표 데이터를
GTFS로 변환해 쓰거나, 공개된 GTFS 배포본을 받아 압축을 풀고
`--gtfs 폴더경로`로 지정하면 됩니다. 형식만 맞으면 세계 어느 도시든 동작합니다.

## commute.js — 티맵 API 버전

티맵(TMap) 대중교통 API로 **출퇴근 최단 시간 경로**를 찾아주는 CLI.

- 출발지/도착지는 `config.json`에 한 번만 설정 (집 ↔ 회사 고정)
- 환승 횟수는 신경 쓰지 않고 **총 소요 시간이 가장 짧은 순**으로 정렬
- 지하철 + 버스 모두 포함 (티맵 대중교통 통합 경로)
- 의존성 0개 — Node.js 18+만 있으면 어디서든 실행 (갤럭시 Termux 포함)

## 1. API 키 발급

1. [SK open API (openapi.sk.com)](https://openapi.sk.com) 가입
2. 앱 생성 후 **대중교통(Transit) API** 사용 신청
3. 발급된 `appKey` 복사

무료 쿼터가 있어서 개인 출퇴근 용도로는 충분합니다.

## 2. 설정

```bash
cp config.example.json config.json
```

`config.json`에 appKey와 집/회사 좌표를 넣습니다. 좌표는 검색으로 찾을 수 있어요:

```bash
node commute.js search "우리집 아파트"
node commute.js search "회사 건물 이름"
```

출력된 `"lat": ..., "lon": ...`을 그대로 복사해 넣으면 됩니다.

키를 파일에 두기 싫으면 환경변수로도 가능합니다: `export TMAP_APP_KEY=발급받은키`

> `config.json`은 집/회사 위치가 들어가므로 git에 올라가지 않습니다 (.gitignore 처리됨).

## 3. 사용

```bash
node commute.js          # 오전이면 출근(집→회사), 오후면 퇴근(회사→집) 자동
node commute.js 출근     # 집 → 회사
node commute.js 퇴근     # 회사 → 집
node commute.js demo     # API 키 없이 출력 형태 미리보기
```

출력 예시:

```
📍 집 → 회사   (기준 시각 08:12)
   대중교통 경로 10개 중 빠른 순 상위 3개

⭐ 최단 경로  총 42분  (지금 출발 시 08:54 도착 예상)  |  환승 1회  |  도보 8분  |  1,550원
   🚶 도보 280m · 4분
   🚌 버스 간선:401 · 행복아파트 → 역삼역 (5개 정거장) · 10분
   🚇 지하철 수도권2호선 · 역삼 → 시청 (8개 정거장) · 24분
   🚶 도보 250m · 4분
...
```

## 갤럭시에서 실행 (Termux)

1. [F-Droid](https://f-droid.org)에서 Termux 설치
2. Termux에서:
   ```bash
   pkg install nodejs git
   git clone <이 저장소>
   cd tmap-commute
   cp config.example.json config.json && nano config.json
   ```
3. 한 글자 명령으로 쓰고 싶으면 `~/.bashrc`에:
   ```bash
   alias ㅊ='node ~/tmap-commute/commute.js'
   ```
4. **Termux:Widget** 앱을 설치하면 홈 화면 버튼 하나로 실행할 수도 있습니다
   (`~/.shortcuts/출근` 파일에 실행 명령을 넣으면 됨).

## 참고

- 티맵 대중교통 API는 요청 시점 기준 실시간 경로를 반환합니다.
- `config.json`의 `show` 값으로 표시할 경로 개수를 조절할 수 있습니다 (기본 3).
