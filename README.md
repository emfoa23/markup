# tyler — lottogen.click

로또 6/45 번호 생성 + 회차별 당첨 결과 + 명당(1·2등 배출점) 순위 서비스.

- **번호 생성** — 서버 무작위 생성, 기기별(localStorage 익명 id) 이력 저장
- **당첨 대조** — 생성 시점의 대상 회차(추첨 시각 토 20:35 KST 기준)로 귀속, 추첨 후 자동 대조
- **회차 히스토리** — 1회차(2002)부터 전 회차 당첨번호·등위별 당첨금
- **명당 순위 / 지점별 배출 이력** — 262회차(2007-12)부터의 1·2등 배출점 데이터 기반.
  온라인 채널(동행복권 사이트, `51100000`)도 순위에 포함하되 "온라인" 배지로 구분. **폐점 제외** 체크박스(`open=1`, 2026-09-07)는
  마스터에서 사라져 closed 로 마킹된 지점을 빼고 남은 집합 안에서 순위를 다시 매긴다(판매점 검색도 같은 파라미터·체크박스)
- **판매점 검색**(`/stores/search`, 2026-09-07) — 명당 섹션의 2차 메뉴. 마스터 전체 지점(배출 이력 없는 지점 포함, 온라인 채널 제외)을 상호·주소 토큰(공백 분리, 모두 포함)으로 찾고 1·2등 배출 수를 붙인다(SQL `store_search`: 상호 완전일치 → 1등 → 2등 → 상호 순). 지역 필터는 없다(주소에 지역명을 치면 된다). 결과 페이지(`?q=`)는 noindex·canonical 은 검색 루트, 보조줄은 동명 지점 구분을 위해 주소.
- **번호 통계** — 자주 나오는 번호(출현 횟수)·안나온 번호(마지막 출현 뒤 미출현 회차수)·**같이 나온 번호**(`/numbers/together?with=1,18`, 2026-09-07 — 고른 번호를 모두 포함한 회차 안에서 나머지 번호의 출현 횟수, 조건 번호 자신의 행 값이 곧 함께 나온 회차 수 — 전 기간 고정·집계 대상만 선택, 함께 나온 적 없는 0회 번호는 목록 제외) 순위. 세 화면 모두 행(공)을 눌러 번호를 고르면 고정 줄에 모이고 **'이 번호로 뽑기'**로 `/generate?picked=…` 에 넘어가 그 번호가 선택된 채 시작한다(자주·안나온은 화면 안 상태, 같이 나온은 `with` 파라미터가 곧 조건). 단일 번호 변형 `?with=N` 45개는 시도별 명당 순위처럼 자기 canonical + "N번과 같이 나온 번호" 제목으로 사이트맵·IndexNow 대상.
- **기간 필터는 회차 하나**(2026-09-07, 명당 순위·자주 나오는 번호 — 안나온·같이 나온 번호는 기간 없음) — 셀렉트는 전체·최근 10·30·50회·직접 입력(최근 N회). 달력(개월) 단위는 복잡도만 올려 두지 않는다. URL 은 `draws=N` 하나(`lib/lotto` Period = 최근 N회 | null), DB 함수 `p_draws` 하나. 회차는 결번 없이 매주 이어져 draw_no 뺄셈이 정확하므로 이전의 최신 추첨일 앵커(`p_anchor`)는 폐기. 최신 회차 이상의 값은 전체 기간과 같다. 구 링크 `months=`·`years=` 는 회차로 환산해 받기만 한다(1개월 ≈ 4.35회).
- **회차 완성 시각** `draws.completed_at` — 당첨금 묶음·판매액·구매유형·배출점이 모두 채워진 첫 sync-draw 실행에서 기록. RSS 항목 날짜와 사이트맵 최신 회차 변경일의 정본(이전 회차는 추첨일 21:05 KST 근사값 백필).
- **순위 표기는 표준 경쟁 순위(1,1,1,4)** — 정렬 키가 같으면 같은 순번, 다음 순번은 동률 인원만큼 건너뛴다(2026-09-05).
  명당은 SQL `store_ranking.rnk`(전체 모드는 1등·2등 수가 모두 같을 때만 동률, 등수 필터 모드는 그 등수 인원), 번호 통계·홈은 `withCompetitionRank`

## 스택

| 역할 | 서비스 |
|---|---|
| 웹 (서빙 + 생성 로그) | Next.js App Router → Vercel (함수 리전 `icn1`) |
| 저장소 | Supabase Postgres (RLS deny-all, 서버는 service role 만 사용) |
| 크롤·적재·대조 | GitHub Actions (`workflow_dispatch` 전용) |
| 스케줄러 | cron-job.org → GitHub API dispatch 호출 |

레포 워크플로에 `on: schedule` 이 없는 것은 의도된 구조다. GitHub 은 60일간 커밋이 없으면
스케줄 워크플로를 자동 비활성화하므로(v1 크롤이 죽은 원인), 스케줄은 전부 cron-job.org 가
외부에서 dispatch 한다. 이 구조는 레포가 1년 조용해도 죽지 않는다.

```
cron-job.org (유일한 스케줄러)
  │  POST /repos/emfoa23/tyler/actions/workflows/{yml}/dispatches
  ├─ sync-draw    토 20:40~21:05 5분 간격 + 22:00/23:00 백스톱 + 일 10:00 KST (멱등 재시도)
  │    당첨결과(기대 회차 1회 조회로 신규 적재 + 지연 필드 재보정) → 생성번호 대조
  │    → 배출점(최신 회차 미적재 시 1회, 추첨 후 12시간 지난 실행은 최근 3회차 재대조) → ISR revalidate → IndexNow 핑
  ├─ sync-stores  일요일 04:30 주 1회 — 전국 판매점 마스터 upsert + 미출현 지점 closed 마킹
  │    질의(시도)마다 별도 잡·별도 러너 IP(matrix, 동시 2) — 한 러너 순차 긁기는 IP 스로틀로 timeout
  │    한 run 안 3단계: 전체 → DB 기준 미완료 질의만 새 러너에서 재실행(×2) → verdict 가 성패를 정한다
  │    (러너 IP 차단은 첫 페이지 2회 프리플라이트로 약 30초 만에 감지, 같은 러너 재시도는 무효라 새 러너로)
  │    갱신 전후 비교로 상호·주소·상태가 바뀐 지점·새 지점·폐점 지점만 골라 지점·회차 페이지 무효화 + IndexNow
  └─ keepalive    매일 — GET /api/ops/keepalive (Supabase 무료 pause 방지)
```

## 검색 노출(SEO)

- 페이지 메타는 `lib/seo.ts` `pageMeta()` 단일 진입점 — title(`lottogen` 제외 15자, 단 지점 상세는 "지점명 — 로또 명당"으로 지점명을 자르지 않음)·description(30자 이내 행동 유도문, title 과 내용 중복 없음)·canonical·OG·Twitter 를 한 쌍의 값으로 채우고 og:image 는 전 페이지 공통 1장. 회차 상세 title/description 엔 당첨번호를 넣지 않는다(페이지에 들어와야 보이게, JSON-LD 에만). 명당은 `?sido=` 변형이 지역명 title + 자기 canonical.
- **사이트맵 인덱스**(2026-09-06, `lib/sitemap.ts`): `/sitemap.xml`(인덱스, 검색엔진에 등록하는 유일한 주소) → `/sitemaps/core.xml`(공개 페이지 10 + 시도 17 + 번호별 같이 나온 번호 45) · `/sitemaps/history.xml`(전 회차, 변경일 = 추첨일·최신 회차만 완성 시각) · `/sitemaps/stores-N.xml`(**배출 이력이 있는 지점만** 5,000개씩, 변경일 = 마지막 배출일·마스터 변경일 중 늦은 쪽, SQL `sitemap_store_entries()`). 배출 이력 없는 지점은 페이지는 열리지만 목록엔 없다(내용이 없어 색인 예산만 쓴다). 7일 캐시, 동기화가 경로로 지운다. `public/robots.txt` 전체 허용 + sitemap.
- **RSS**(`/rss.xml`, `app/rss.xml/route.ts`): 완성된 최근 8회차 + 최근 2회차의 1·2등 배출 지점 항목(지점당 회차별 1건). 날짜는 `completed_at`. 네이버 RSS 제출과 구글 사이트맵(피드 형식) 양쪽에 등록. 새 페이지를 만드는 게 아니라 기존 페이지를 가리키는 목차.
- IndexNow(`scripts/lib/indexnow.mjs`, 키 파일 `public/<key>.txt`): sync-draw 가 변경을 반영하면 홈·목록·명당·번호·최신 회차 URL 을 핑(네이버·Bing 등 참여 엔진). Google 은 sitemap + Search Console.
- `public/llms.txt`: 페이지 패턴·데이터·갱신 주기(생성형 검색 인용용).

## 데이터 소스

동행복권 공개 JSON API (2026-08 개편 후, 전부 GET·UTF-8):

- 회차별 당첨결과 `/lt645/selectPstLt645InfoNew.do?srchDir=center&srchLtEpsd={회차}` — 요청 회차부터 아래로 10개.
  추첨 직후엔 당첨자수·당첨금·판매액·1등 구매유형이 null 이 아니라 0 으로 온다(번호 ~20:42 → 당첨금·판매액 ~20:49 → 구매유형·배출점 ~21:00, 2026-09-05 실측). **DB 에는 원본 0 을 그대로 저장**하고 공개 여부는 `lib/draw-state.mjs` 가 묶음 단위로 판정한다 — 당첨금 묶음 = 5등 당첨자 > 0, 판매액 > 0, 구매유형 = 1등이 있는데 세 유형 합이 0 이면 미공개. 화면은 미공개 묶음을 아예 그리지 않고(홈 1·2등 상자, 목록의 1등 줄, 상세의 등위별 표·판매액 줄), sync-draw 는 같은 판정으로 최신 회차를 재조회한다. 개별 0(이월 회차의 1등 0명, 반자동 0 등)은 실제 값이라 그대로 보인다
- 회차별 1·2등 배출점 `/wnprchsplcsrch/selectLtWnShp.do?srchWnShpRnk=all&srchLtEpsd={회차}` — 262회차부터, 행=당첨 게임 1건
- 전국 판매점 마스터 `/prchsplcsrch/selectLtShp.do?srchCtpvNm={시도}` — 시도는 짧은 이름("서울"), 페이지당 10건 고정
- **캐시·무효화 정책**(2026-09-06, `lib/cache-policy.ts`): 데이터는 주 3회(토 sync-draw, 일 04:30 sync-stores, 일 10:00 재대조)만 바뀌므로 페이지 캐시(홈·회차·지점·공유·사이트맵·RSS)와 데이터 캐시(회차 목록·명당 순위·번호 통계 — 검색 파라미터를 읽어 페이지 캐시가 꺼지는 화면, `unstable_cache` 태그 draws/ranking/numbers)를 **7일**로 두고, 동기화가 **바뀐 것만** 지운다(`POST /api/ops/revalidate` body `{paths, tags}` — 경로·태그 허용 목록). 모든 회차·지점을 통째로 지우던 방식은 폐기. 변경 URL 집합은 `scripts/lib/changes.mjs` 가 만들고 무효화와 IndexNow 가 같은 목록을 쓴다(핵심 6 + 시도 17 + 번호별 같이 나온 번호 45 + 회차 + 그 주 배출 지점 전부). 비용 상한 = 페이지당 7일 1회 재생성.
- **호출 정책·관측**(2026-09-05): 러너 IP 는 짧은 버스트에도 스로틀되므로 sync-draw 는 슬롯당 호출을 1~2회로 유지한다(기대 회차 1회 조회로 신규+지연 필드, 배출점은 최신 회차 미적재 시만). 전송은 **소켓 1개 keep-alive 재사용**(유휴 8s 닫힘) — 러너 스로틀은 요청 수가 아니라 **새 TCP 연결**에 걸린다(요청마다 새 연결이면 4~6개 뒤부터 SYN 이 버려져 15s 타임아웃 연속, 재사용하면 울산 40페이지 70초·실패 0, 2026-09-05 실측). 재시도는 4회·15s 타임아웃(TCP 연결 단계 포함)·백오프 1/4/9s(콜당 최악 ~75초), 마스터 크롤은 2페이지부터 8회·상한 30s, **첫 페이지만 2회**(러너 IP 가 SYN 단계에서 차단된 경우 같은 러너의 재시도는 전부 무응답이라 약 30초 만에 물러나고 워크플로가 새 러너에서 그 질의만 다시 돈다 — 2026-09-14, `scripts/lib/dhlottery.mjs`). **모든 호출은 성공·실패를 불문하고 `dhlottery ok|fail <endpoint?query> <ms> (try i/n)` 한 줄**을 남기고 스크립트 단계 로그엔 `[+경과초]` 가 붙는다(`scripts/lib/log.mjs`) — Actions 로그만으로 어느 호출이 얼마나 막혔는지 복원할 수 있다. 검증 훅 `SYNC_NOW=<ISO>` 로 기대 회차·12시간 규칙을 임의 시점으로 시험한다.
- **DB 호출 재시도**(2026-09-14, `scripts/lib/supa.mjs`·`retry-policy.mjs`): 멱등 요청(GET/HEAD/PATCH/DELETE/upsert/RPC)의 5xx·네트워크 오류는 2·5·10s 백오프로 최대 4시도, 요청 타임아웃 30s. plain insert(store_wins 삽입)는 중복 위험이라 제외. 배경: 컴퓨트 애드온 없는 Nano 인스턴스(RAM 0.5GB)가 스왑에서 돌아오는 수 초 동안 Supabase Envoy 게이트웨이가 `504 {"message":"Gateway Timeout"}` 을 단발로 낸다(9/12~13 3건, DB 문장은 ≤98ms) — 몇 초 뒤 같은 요청은 성공한다.
- **판매점 마스터 완료 판정**(2026-09-14, `scripts/stores-remaining.mjs`·`scripts/lib/completion.mjs`): 잡 상태가 아니라 DB 로 판단한다 — 실행 시작 이후 `master_seen_at` 이 갱신되지 않은 open 지점이 남은 시도(marks)가 있으면 그 질의는 미완료. 완주한 질의는 그 시도의 open 지점 전부에 시각을 찍고 미출현 지점을 closed 로 바꾸므로 부분 upsert·폐점 누락도 미완료로 잡힌다. marks 없는 '전남' 보조 질의는 best-effort. 로컬 감사: `RUN_STARTED_AT=<ISO> node scripts/stores-remaining.mjs`.

## 개발

```sh
npm install
npm run dev        # .env.local 필요: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPS_SECRET, ADMIN_SECRET
```

같은 와이파이의 폰으로 볼 때는 `next dev -H 0.0.0.0` 로 띄우고 `http://<LAN IP>:3000` 으로 연다. Next 16 은 localhost 밖
출처의 `/_next/*` 청크·HMR 을 막으므로 `next.config.ts` 의 `allowedDevOrigins`(192.168.*.*)가 필요하고(없으면 HTML 만 뜨고
hydration 이 안 돼 셀렉트·버튼이 반응하지 않는다), http 라 `crypto.randomUUID` 가 없어 기기 식별자는 `lib/client-id.ts` 의
폴백으로 만들어진다. 로컬 dev 는 프로드 DB 를 그대로 쓰므로 뽑기·방문은 실통계에 남는다(다른 출처라 새 기기로 집계).

스키마는 `supabase/schema.sql` (Supabase Management API 로 적용).

## 자랑하기·바이럴 루프 (2026-08-29)

당첨만 보기에서 당첨 회차마다 **자랑하기** — 클릭하면 `POST /api/share` 가 토큰과 함께 **그 기기의 해당 회차
당첨 세트 전건을 착지 페이지와 같은 순서(등수 오름차순 → id 오름차순, `lib/queries` `getWinningSets` 단일 소스)** 로
돌려주고, 그 세트로 캔버스 카드를 그려(회차·당첨번호·당첨 세트 최대 5개=가장 좋은 세트·맞춘 번호 하이라이트·
`lottogen.click` 워터마크, `lib/brag-image.ts` — 등수 요약 줄과 "외 N세트" 줄은 2026-09-05 제거) **Web Share 시트**를
연다(`files` + `text`=링크만 — url 필드는 안드로이드에서 text 와 동일 슬롯이라 중복 방지 차원에서
미사용, 저장/공유 선택은 OS 시트 몫). 사용자 취소(AbortError)는 무집계, 그 외 실패·미지원은
이미지 다운로드+링크 클립보드 폴백. 링크 착지 `/share/{token}`(noindex, title "N회 당첨 인증")은 **그 기기의 해당 회차 당첨 내역**
(당첨번호·맞춘 번호 하이라이트·등수)을 보여준다 — 토큰은 자랑 시점 `POST /api/share` 가 발급
((기기,회차) 당 1행 upsert, client_id 는 URL 비노출·당첨 실존 검증). 회차 일반 착지는 없음. 수집: `share`(공유 시트 완료 또는 미지원 폴백 이미지 저장 — 한 종류, 시트 안 행동은 관측 불가)
이벤트(+`draw_no`, 어드민 표기 '자랑 실행'. 구 `share_download` 는 2026-09-09 폐기·share 로 통일)·`/share` 랜딩=viral 소스(레퍼러 아닌 경로 판정 — 인앱 레퍼러 소실 무관)·기기
`first_share_day`. 어드민 "바이럴 루프" 섹션이 당첨 확인→자랑 실행→공유 유입 신규 기기→생성 도달을
윈도우별로 보여주고 성적표에 회차별 공유 수를 병기한다(이미지-only 유입은 direct 로 잡히는 한계 각주).

## 시간 기준 — 하루 = KST 달력일 (2026-09-10)

- **정의**: 하루는 Asia/Seoul 달력일 00:00~24:00 이다. 순간은 `timestamptz`(ISO 문자열), 날짜(`day_kst`·`*_day`)는 KST
  달력일 `YYYY-MM-DD` 로만 저장·비교한다. "최근 24시간" 같은 롤링 창은 '하루'라 부르지 않는다. DB TimeZone 은 UTC 그대로
  둔다(설정에 기대면 로컬·새 환경에서 조용히 어긋난다) — bare `::date`·`current_date` 는 UTC 날짜가 되므로 쓰지 않는다.
- **헬퍼 하나씩**: 앱·스크립트는 [`lib/kst.mjs`](lib/kst.mjs)(`kstDay`·`kstDayStart`·`kstDayAdd`·`kstDateTime`; 추첨 시각은
  `lib/draw-time.mjs`), SQL 은 `kst_today()`·`kst_day(timestamptz)`·`kst_day_start(date)`. 다른 곳에서 `timeZone`·
  `toLocaleDateString`·`getDay()`류·+9시간 산술·인라인 `at time zone` 을 쓰지 않는다.
- **생성 한도**: 기기당 **KST 달력일 200세트**, 자정에 초기화(`app/api/generate/route.ts` `DAILY_LIMIT`). 2026-09-10 까지는
  "지금-24시간" 롤링 창이어서 429 문구("오늘·내일")·개인정보처리방침("일일 한도")과 뜻이 달랐다 — 달력일로 통일.
- **가드**: `npm run check` = `scripts/check-kst.mjs`(금지 관용구 검사: 앱·스크립트·schema.sql·워크플로 `schedule:`·vercel
  `crons`) + `node --test tests/`(자정·UTC 날짜 경계). `prebuild` 로 걸려 있어 Vercel 배포(`npm run build`)가 위반 시 실패한다.
  schema.sql 말미의 자가 검사 `do` 블록과 `kst_lint_functions()` 가 **프로드 함수 본문**에 헬퍼를 우회한 관용구가 남았는지
  잡는다(파일과 프로드가 어긋나는 드리프트 대비). 스케줄은 cron-job.org(전 잡 Asia/Seoul)만 쓴다.

## 운영 통계·어드민 (2026-08-29)

`/admin`(운영자 전용, noindex) — **퍼널·유저 구성·유입·바이럴 루프·생성분석** 5섹션 + [오늘|7일|30일|전체](KST 달력일) 기간 탭.

- **인증**: 가입 기능이 없으므로 `ADMIN_SECRET`(Vercel env) 시크릿 로그인 — 상수시간 비교 후
  sha256 파생 토큰을 HttpOnly 쿠키(30일)로 발급(`lib/admin-auth.ts`, `/api/admin/login`).
- **수집**: 방문(탭 세션당 1회, 랜딩 그룹+current/first-touch 소스)·생성기 진입은 전역 비콘
  (`components/analytics-beacon.tsx` → `POST /api/track`, 기기당 500행/일 캡, **봇 게이트**: ①렌더링 크롤러 UA·navigator.webdriver 클라·서버 양쪽 드롭(UA 는 판별 뒤 원문을 raw 행에 저장 — 2026-09-09) ②**상호작용 게이트** — 첫 터치/스크롤/키 입력 후에만 전송(무신분 렌더러 원천 차단, 방문='상호작용한 방문')), '당첨 확인'은
  `GET /api/generate?wins=1`('당첨만 보기') 첫 페이지 조회 중 **이미 추첨이 끝난 참여 회차가
  있는 기기**만 서버가 적재(위조 방지 — 2026-08-29 재정의, 단순 목록 조회는 세지 않음). 퍼널은
  방문→번호 생성→당첨 확인→2회차+ 생성 4단계(생성기 진입은 방문과 변별력이 낮아 표시 제외,
  수집은 유지). 기기 식별자는 제품과 같은
  `tyler_client_id`(localStorage, `lib/client-id.ts`)를 쓰며 IP·서비스 내 원본 URL 은 저장하지 않는다.
  **UA 원문·외부 레퍼러 전체 URL 은 raw 행(`ua`·`referrer_url`, 2026-09-09)에 90일 보존** — '직접' 유입의
  실체를 특정하기 위한 것으로, 파싱·분류는 저장 시점이 아니라 분석 시점에 한다(개인정보처리방침 1항 문구
  동시 교체·시행일 유지).
  기기 행은 방문 비콘 또는 `/api/generate` 서버 적재 중 먼저 온 쪽이 만들며, 서버 적재가 앞서면
  first-touch 가 NULL(미상)로 시작하고 **첫 방문 비콘이 1회 채운다**(이후 동결; 어드민은 빈 값을 '미상'으로 표시)
  (개인정보처리방침 2026-08-29 개정 고지). 번호 선택 사용은 `generated_sets.picked_count`(과거
  null=미상 — 0 자동·1~5 반자동·6 수동·7+ '내 번호만 뽑기', 2026-09-02 `fixed_count` 에서 개명).
- **원본 이벤트 뷰어(`/admin/events`, 2026-09-09)**: `analytics_events` raw 를 그대로 본다 — 필터는 **종류 셀렉트**(명당 순위·번호 통계와 같은
  `FilterSelect` 즉시 적용)와 **기기 ID(UUID 전체, Enter/포커스 아웃 적용)**, 카드의 기기 ID(앞 8자)를 누르면 그 기기의 행동만(종류 필터는 풀림).
  페이지 50건, 최신순 `created_at desc, id desc`. 행 카드 = 1줄 시각·종류(·회차) / 2줄 판정 칩(랜딩·소스·최초유입) / 기기·**UA 원문·레퍼러 원문**.
  표가 아니라 카드라 375px 에서 가로 스크롤 없이 `break-all` 로 접힌다. 파싱·분류 없음(통제할 수 없는 값이라 미리 쪼갤 기준이 없다 — 사람이 읽고
  분류는 뒤에). 라벨은 `lib/admin-labels.ts`, 링크 빌더는 `lib/admin-events-url.ts` 단일 소스. `/admin` 헤더(h1 행 우측)의 '원본 이벤트 →' 로 진입,
  뷰어 헤더 같은 자리의 '← 운영 통계' 로 복귀. 어드민 쿠키 게이트 동일.
- **하이브리드 규약(boss-paegi v1.06 이식)**: 카운트류 = `analytics_rollups(day_kst<오늘)` +
  오늘 라이브 `analytics_rollup_rows_for_day(오늘)` — 하루치 집계 SQL 함수가 cron(INSERT)과
  어드민 라이브(SELECT)의 단일 소스. 윈도우 distinct 기기·회차 리텐션·성적표는 raw 직조회 RPC
  (`admin_funnel_window`·`gen_draw_retention`·`gen_draw_report` 등 — 일단위 분해가 안 되는 지표의
  예외). raw 이벤트 90일 보존(`prune_analytics_events`), 롤업·기기 레지스트리(`analytics_devices`,
  first-touch 동결)는 영구. 방문 계열 수집 시작(2026-08-29) 전 과거는 소급 불가, 생성 계열은
  `generated_sets` 영구라 전 기간 정확(도입 시 91일 롤업 백필 완료).
- **단위 규약(2026-08-29 v4)**: 표 안 "개수+비율"은 개수가 주·비율은 작은 보조 텍스트(단일 `Ratio`
  표기). 성적표 '공유'는 확인과 같은 **기기 단위·전 기간**(`gen_draw_report.share_devices` — 이벤트
  90일 관측 의존은 확인과 동일). 리텐션은 참여 회차 수 기준 2회차+/5회차+ 두 컬럼. 소비처가 없어진
  롤업 지표(share_by_draw·gen_fixed_sets·limit_hit_devices)와 생성 번호 균등성 RPC 는 제거
  (전부 `generated_sets` 영구 원본에서 재계산 가능 — 데이터 손실 없음).
- **유저 구성(2026-09-02 v6, GA식·일 단위)**: '유저활용'을 **유저 구성**으로 재편(퍼널 바로 뒤). 방문·생성
  각 층을 **처음/다시**로 분해(카드: 방문 기기·처음 방문·다시 방문 / 생성 기기·처음 생성·다시 생성 — 4자
  라벨은 375px 3열에서 한 줄 유지용) — 처음 = 첫 관측일(방문·생성 중 먼저 보인 날)이 기간 안(롤업
  `visit_new_devices`·`gen_new_devices`), 다시 = 기간 안에 첫날보다 뒤의 방문일/생성일이 있음(raw RPC
  `admin_engagement_window`: `returning_visit_devices`·`returning_gen_devices`). 기간 안에서 처음 오고 또 온
  기기는 둘 다에 세므로 합이 전체보다 클 수 있다(오늘 탭만 겹침 없음, 전체 탭은 처음=전체·다시=첫날 이후
  돌아온 기기). 구 '재방문 기기(창 안 2일 이상 방문)'는 오늘 탭이 구조적으로 0이고 과거 이력을 무시해 폐기.
  첫 관측일은 `analytics_devices` BEFORE INSERT 트리거가 `generated_sets` 최초 생성일과 비교해 이른 쪽을
  심는다(방문 수집 전에 생성만 했던 기기가 돌아올 때 '처음'으로 오판 방지) — 도입 시 이미 돌아와 있던 7대를
  백필하고 롤업 91일을 재계산. 생성 기기·처음 생성 카드는 생성분석에서 유저 구성으로 이동(한 숫자 한 자리).
- **메뉴 노출**: 어드민 로그인 성공(또는 인증된 /admin 렌더) 시 localStorage UI 힌트
  (`tyler_admin_ui`)를 심어 사이트 메뉴 **맨위**에 '운영 통계'를 노출한다 — 힌트는 노출용일 뿐
  권한이 아니며(실게이트=HttpOnly 쿠키), 일반 방문자에겐 보이지 않는다. `/admin` 방문은 방문
  통계에서 제외(운영 트래픽 오염 방지).
- **cron**: cron-job.org(emfoa23)가 `POST /api/ops/analytics-maintain`(x-cron-secret)을
  **KST 00:05 일 1회** 호출 — 자정 직후 앵커(하이브리드에서 '어제'가 롤업 관할로 넘어가는 경계 봉인).
  maintain(3일 delete-재계산, 멱등·advisory lock) → 성공 시 prune(90일).

## 운영 명령

```sh
node scripts/backfill.mjs all      # 전체 백필 — Actions 의 backfill 워크플로로도 dispatch 가능
node scripts/sync-draw.mjs         # 주간 동기화 (Actions 가 실행하는 것과 동일)
node scripts/sync-stores.mjs "서울,경기"   # 마스터 동기화(질의 부분집합, 비우면 전국) — Actions 는 질의별 matrix 잡 3단계, 입력 queries=["서울","경기"]·검증용 simulate_fail=["세종"]
node scripts/indexnow-bulk.mjs [--dry]  # 1회성: 사이트맵의 URL 전부를 IndexNow 로 알림(네이버·Bing). 주간 변경분은 동기화가 보낸다
```

배포는 **Vercel GitHub 연동**(2026-08-23 연결, production branch `main`) — PR 머지(= main push)마다 자동 프로덕션 배포,
PR 브랜치는 preview 배포. 수동이 필요하면 `vercel deploy --prod`(배포 권한이 있는 Vercel 계정으로 로그인 또는 `--token`).

## GitHub Secrets

`SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `OPS_SECRET` (revalidate/keepalive 게이트)
