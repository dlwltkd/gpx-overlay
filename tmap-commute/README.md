# tmap-commute

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
