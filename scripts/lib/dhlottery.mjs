// 동행복권 신규 API 클라이언트 (2026-08 개편 후 사이트 기준).
// 전부 GET + UTF-8 JSON. KR IP 기준 헤더 없이 호출 가능.
import https from "node:https";
import { sleep } from "./util.mjs";
import { log, warn } from "./log.mjs";
import { WEEK_MS, drawMoment } from "../../lib/draw-time.mjs";

const BASE = "https://www.dhlottery.co.kr";

// 표준 17개 시도 (배출점 데이터·UI 필터 기준 어휘).
export const SIDO = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
];

// 판매점 마스터(selectLtShp.do)의 질의 어휘. 짧은 시도명만 인식하며("서울특별시"는 total=0),
// 광주·전남은 '전남광주' 통합 권역으로 관리된다 ('광주' 질의 0건, '전남' 질의 1건 — 2026-08-17 실측).
// marks = 이 질의를 완주하면 폐점 마킹을 수행해도 되는 시도 목록 (질의가 그 시도 전체를 커버한다는 보장).
export const MASTER_QUERIES = [
  ...["서울", "부산", "대구", "인천", "대전", "울산", "세종",
      "경기", "강원", "충북", "충남", "전북", "경북", "경남", "제주"].map((s) => ({ query: s, marks: [s] })),
  { query: "전남광주", marks: ["광주", "전남"] },
  // 개별 '전남' 태깅 잔재(순천 1건 실측) refresh 용 보조 질의 — 커버리지 보장이 없어 마킹 없음.
  { query: "전남", marks: [] },
];

// 광주광역시의 5개 구 — '전남광주' 통합 표기를 개별 시도로 분리할 때 사용.
const GWANGJU_GU = new Set(["동구", "서구", "남구", "북구", "광산구"]);

export function normalizeSido(sido, sigungu) {
  if (sido === "전남광주") return GWANGJU_GU.has(sigungu || "") ? "광주" : "전남";
  return sido || null;
}

// 배출점 데이터가 존재하는 최초 회차 (이전 회차는 API total=0).
export const FIRST_WIN_SHOP_DRAW = 262;

// 온라인 판매 채널(동행복권 사이트)의 판매점 ID. 배출점 행에 지점처럼 섞여 들어온다.
export const ONLINE_STORE_ID = "51100000";

// 최신 회차 추정용 기준점 (매주 토 20:35 KST 추첨).
const BASE_DRAW = { no: 1237, date: "2026-08-15" };

export function expectedLatestDraw(now = new Date()) {
  const weeks = Math.floor((now.getTime() - drawMoment(BASE_DRAW.date)) / WEEK_MS);
  return BASE_DRAW.no + Math.max(0, weeks);
}

// 전송: 연결 하나를 재사용(keep-alive, 소켓 1개)한다.
// 2026-09-05 러너 실측 — 스로틀의 실체는 요청이 아니라 **새 TCP 연결(SYN)에 대한 제한**으로 보인다:
// 요청마다 새 연결(agent:false)을 열면 5~6페이지 뒤부터 SYN 이 버려져 connect ETIMEDOUT(~136s) / 15s 타임아웃이
// 연속됐고(세종·울산 런), 그 사이 성공한 요청은 0.5s 안에 끝났다. 유휴 중 서버가 끊은 소켓을 재사용해 실패하는
// 문제(이전에 agent:false 로 간 이유)는 (1) 유휴 8초면 소켓을 닫고 (2) 실패 시 재시도가 새 연결을 열게 해서 흡수한다.
// 유휴 30s — 질의 사이 DB upsert 등 짧은 멈춤에 소켓이 닫혀 새 연결(=스로틀 대상)을 열지 않게. 서버가 먼저 끊은
// 소켓은 agent 가 풀에서 제거하고, 경합으로 실패하면 재시도가 새 연결을 연다(15s 타임아웃이 아니라 즉시 실패).
const IDLE_MS = 30_000;
const agent = new https.Agent({ keepAlive: true, maxSockets: 1, timeout: IDLE_MS });

function httpGetText(url) {
  return new Promise((resolve, reject) => {
    // 소켓 timeout 과 별개의 하드 데드라인 — 재사용 소켓에서 소켓 timeout 이 안 걸린 채 커널 재전송 한도(~2분)까지
    // 매달리는 케이스가 실측됐다(2026-09-06 세종 로컬 런: read ECONNRESET 113s). 어떤 경우에도 한 시도가
    // TIMEOUT_MS + 5s 를 넘기지 않게 한다.
    const deadline = setTimeout(() => req.destroy(new Error(`request deadline (${TIMEOUT_MS + 5000}ms)`)), TIMEOUT_MS + 5000);
    // timeout 옵션은 소켓 생성 시점에 걸려 TCP 연결 단계(SYN 무응답)까지 덮는다. req.setTimeout 만으로는
    // 연결이 된 뒤에야 적용돼, 스로틀이 SYN 을 버리면 OS connect 한도(~130초)까지 매달렸다
    // (2026-09-05 세종 런 실측: connect ETIMEDOUT 136s ×2).
    const req = https.get(url, { agent, timeout: TIMEOUT_MS, headers: { accept: "application/json" } }, (res) => {
      // 구 endpoint 는 전부 302 로 죽었다 — 200 외 전부(리다이렉트 포함) 실패로 취급.
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        clearTimeout(deadline);
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
      res.on("error", (e) => {
        clearTimeout(deadline);
        reject(e);
      });
    });
    req.on("timeout", () => req.destroy(new Error(`request timeout (${TIMEOUT_MS}ms)`)));
    req.on("error", (e) => {
      clearTimeout(deadline);
      reject(e);
    });
  });
}

// 재시도 예산 — 다음 슬롯이 5분 뒤에 오므로 한 호출이 오래 매달리지 않게 한다.
// (2026-09-05 실측: 8회·45s 백오프·20s 타임아웃 조합은 콜당 최악 5.7분 → 실행이 5~15분씩 늘어져 잡 timeout.)
// 4회·15s 타임아웃·백오프 1/4/9s(상한 10s) = 콜당 최악 약 75초. IP 스로틀은 다음 슬롯이 흡수한다.
const TRIES = 4;
const TIMEOUT_MS = 15_000;
const BACKOFF_CAP_MS = 10_000;

// 모든 호출의 결과를 한 줄씩 남긴다(성공도) — 소요·시도 횟수·오류 종류가 로그에 남아야
// 다음 주 슬롯 로그만으로 어느 호출이 얼마나 막혔는지 보고 최적화·트러블슈팅할 수 있다.
async function getData(path, params, { tries = TRIES, backoffCapMs = BACKOFF_CAP_MS } = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}${path}?${qs}`;
  const label = `${path.slice(path.lastIndexOf("/") + 1).replace(/\.do$/, "")}?${qs}`;
  const started = Date.now();
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    const t = Date.now();
    try {
      const json = JSON.parse(await httpGetText(url));
      if (!json || typeof json !== "object" || !("data" in json)) {
        throw new Error("unexpected payload shape");
      }
      log(`dhlottery ok ${label} ${Date.now() - t}ms (try ${i}/${tries}, total ${Date.now() - started}ms)`);
      return json.data;
    } catch (e) {
      lastErr = e;
      warn(`dhlottery fail ${label} try ${i}/${tries} ${Date.now() - t}ms: ${e?.message ?? e}`);
      if (i < tries) await sleep(Math.min(1000 * i * i, backoffCapMs) + Math.floor(Math.random() * 1000));
    }
  }
  throw new Error(`dhlottery request failed after ${tries} tries (${Date.now() - started}ms): ${label} — ${lastErr}`);
}

// 회차별 당첨결과. 요청 회차를 상단으로 최대 10개(요청 회차부터 아래로)를 돌려준다.
// 존재하지 않는(미래) 회차를 주면 빈 배열.
export async function fetchDrawWindow(epsd) {
  const data = await getData("/lt645/selectPstLt645InfoNew.do", {
    srchDir: "center",
    srchLtEpsd: epsd,
  });
  return data.list ?? [];
}

// 회차별 1·2등 배출점. 페이징 없이 전건 { total, list }.
export function fetchWins(epsd) {
  return getData("/wnprchsplcsrch/selectLtWnShp.do", {
    srchWnShpRnk: "all",
    srchLtEpsd: epsd,
    srchShpLctn: "",
  });
}

// 전국 판매점 마스터. perPage 는 10 고정으로 동작한다.
// 첫 페이지 = 러너 IP 차단 감지용 프리플라이트: 2회(약 30초)만 시도하고 실패시킨다. 차단은 SYN 단계라 같은 러너의
// 재시도는 전부 무응답이고(2026-09-06·09-13 실측: 8회 240초), 워크플로가 새 러너에서 그 질의만 다시 돈다(sync-stores.yml).
// 2페이지부터는 연결이 살아 있는 상태의 일시 장애라 넉넉히 참는다 — 8회·백오프 상한 30s = 페이지당 최악 약 4분.
export function fetchMasterPage(sido, pageNum) {
  return getData("/prchsplcsrch/selectLtShp.do", {
    srchCtpvNm: sido,
    srchSggNm: "",
    pageNum,
    recordCountPerPage: 10,
  }, pageNum === 1 ? { tries: 2, backoffCapMs: 10_000 } : { tries: 8, backoffCapMs: 30_000 });
}

const ymd = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

export function mapDraw(it) {
  // 원본 값을 그대로 저장한다 — 0 을 null 로 바꾸지 않는다. 추첨 직후 미공개 값(당첨자수·당첨금·판매액·
  // 1등 구매유형)은 전부 0 으로 오고, 공개 여부는 lib/draw-state.mjs 의 묶음 단위 판정이 담당한다
  // (2026-09-05: 개별 필드 0 은 이월 회차의 1등 0명, 반자동 0 등 실제 값이라 null 로 바꾸면 정보가 깨진다).
  return {
    draw_no: it.ltEpsd,
    draw_date: ymd(String(it.ltRflYmd)),
    n1: it.tm1WnNo, n2: it.tm2WnNo, n3: it.tm3WnNo,
    n4: it.tm4WnNo, n5: it.tm5WnNo, n6: it.tm6WnNo,
    bonus: it.bnsWnNo,
    r1_winners: it.rnk1WnNope, r1_prize_each: it.rnk1WnAmt, r1_prize_total: it.rnk1SumWnAmt,
    r2_winners: it.rnk2WnNope, r2_prize_each: it.rnk2WnAmt, r2_prize_total: it.rnk2SumWnAmt,
    r3_winners: it.rnk3WnNope, r3_prize_each: it.rnk3WnAmt, r3_prize_total: it.rnk3SumWnAmt,
    r4_winners: it.rnk4WnNope, r4_prize_each: it.rnk4WnAmt, r4_prize_total: it.rnk4SumWnAmt,
    r5_winners: it.rnk5WnNope, r5_prize_each: it.rnk5WnAmt, r5_prize_total: it.rnk5SumWnAmt,
    // API 는 세 유형을 항상 0 이상 정수로 준다. 키가 빠지는 경우만 0 으로 본다(열을 한 표현으로 유지).
    first_auto: it.winType1 ?? 0,
    first_manual: it.winType2 ?? 0,
    first_semi: it.winType3 ?? 0,
    sales_total: it.wholEpsdSumNtslAmt,
    prize_pool: it.rlvtEpsdSumNtslAmt,
  };
}

// 배출점 행 → stores 신규 행. 마스터가 더 정확하므로 insert-only 용도로만 쓴다.
export function mapWinStore(w) {
  return {
    store_id: String(w.ltShpId),
    // 과거 회차 일부 지점은 상호가 null 로 온다 — 마스터 동기화가 만나면 실명으로 덮어쓴다.
    name: w.shpNm || "(상호 미상)",
    sido: normalizeSido(w.tm1ShpLctnAddr || w.region, w.tm2ShpLctnAddr),
    sigungu: w.tm2ShpLctnAddr || null,
    address: (w.shpAddr || "").trim() || null,
    phone: w.shpTelno || null,
    lat: w.shpLat ?? null,
    lng: w.shpLot ?? null,
    status: w.slrOperSttsCd === "1" ? "open" : "closed",
    sells_l645: w.l645LtNtslYn === "Y",
  };
}

// 배출점 행 → store_wins 행. 행 하나 = 당첨 게임 1건.
// atmtPsvYn: Q=자동, M=수동, 과거 회차는 N(미상).
export function mapWinRow(w, draw) {
  return {
    draw_no: draw.draw_no,
    store_id: String(w.ltShpId),
    rank: w.wnShpRnk,
    method: w.atmtPsvYn && w.atmtPsvYn !== "N" ? w.atmtPsvYn : null,
    draw_date: draw.draw_date,
  };
}

export function mapMasterStore(m, seenAtIso) {
  return {
    store_id: String(m.ltShpId),
    name: m.conmNm || "(상호 미상)",
    sido: normalizeSido(m.tm1BplcLctnAddr, m.tm2BplcLctnAddr),
    sigungu: m.tm2BplcLctnAddr || null,
    address: m.bplcRdnmDaddr || m.bplcLctnDaddr || null,
    phone: m.shpTelno || null,
    lat: m.shpLat ?? null,
    lng: m.shpLot ?? null,
    status: m.slrOperSttsCd === "1" ? "open" : "closed",
    sells_l645: m.l645LtNtslYn === "Y",
    master_seen_at: seenAtIso,
    // updated_at 은 여기서 올리지 않는다 — 매주 전 지점을 upsert 하므로 매번 올리면 "내용이 바뀐 시각"이 아니라
    // "마지막 동기화 시각"이 돼 사이트맵 변경일이 매주 전 지점에서 새로워진다(2026-09-06 실측). 상호·주소·상태가
    // 실제로 바뀐 지점만 master.mjs 가 따로 올린다.
  };
}
