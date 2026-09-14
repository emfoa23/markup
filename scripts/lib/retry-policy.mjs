// Supabase(PostgREST) 호출 재시도 규칙 — 순수 함수(tests/supa-retry.test.mjs).
// 배경(2026-09-12~13): Nano 인스턴스가 스왑에서 돌아오는 수 초 동안 Envoy 게이트웨이가 504 {"message":"Gateway Timeout"}
// 를 냈다(DB 문장은 ≤98ms, PostgREST 풀 timeout 0). 같은 요청을 몇 초 뒤에 보내면 성공하므로 멱등 요청만 재시도한다.

/** 같은 요청을 다시 보내도 상태가 같은가 — plain insert(POST, on_conflict 없음)만 아니다. RPC 는 멱등한 것만 부른다(check_generated_sets). */
export function isIdempotent(method, pathAndQuery) {
  if (method === "GET" || method === "HEAD" || method === "PATCH" || method === "DELETE") return true;
  if (method === "POST") return pathAndQuery.startsWith("rpc/") || /[?&]on_conflict=/.test(pathAndQuery);
  return false;
}

/** 이 실패를 재시도하는가 — 멱등 요청의 5xx 또는 네트워크 오류(status null)만. 4xx 는 우리 잘못이라 즉시 실패. */
export function shouldRetry({ method, pathAndQuery, status }) {
  if (!isIdempotent(method, pathAndQuery)) return false;
  return status === null || status >= 500;
}
