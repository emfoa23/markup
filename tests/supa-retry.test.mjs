// Supabase 호출 재시도 규칙 — scripts/lib/retry-policy.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { isIdempotent, shouldRetry } from "../scripts/lib/retry-policy.mjs";

test("멱등 요청의 5xx·네트워크 오류만 재시도한다", () => {
  assert.equal(shouldRetry({ method: "GET", pathAndQuery: "draws?select=draw_no&limit=1", status: 504 }), true);
  assert.equal(shouldRetry({ method: "HEAD", pathAndQuery: "store_wins?draw_no=eq.1241&select=*", status: 503 }), true);
  assert.equal(shouldRetry({ method: "PATCH", pathAndQuery: "stores?store_id=in.(1,2)", status: 500 }), true);
  assert.equal(shouldRetry({ method: "DELETE", pathAndQuery: "store_wins?draw_no=eq.1241", status: 502 }), true);
  assert.equal(shouldRetry({ method: "POST", pathAndQuery: "stores?on_conflict=store_id", status: 504 }), true);
  assert.equal(shouldRetry({ method: "POST", pathAndQuery: "rpc/check_generated_sets", status: null }), true);
});

test("plain insert 는 재시도하지 않는다(중복 삽입 위험), 4xx 도 즉시 실패", () => {
  assert.equal(isIdempotent("POST", "store_wins"), false);
  assert.equal(shouldRetry({ method: "POST", pathAndQuery: "store_wins", status: 504 }), false);
  assert.equal(shouldRetry({ method: "POST", pathAndQuery: "store_wins", status: null }), false);
  assert.equal(shouldRetry({ method: "GET", pathAndQuery: "draws?select=nope", status: 400 }), false);
  assert.equal(shouldRetry({ method: "GET", pathAndQuery: "draws", status: 429 }), false);
  assert.equal(shouldRetry({ method: "PATCH", pathAndQuery: "stores?store_id=eq.x", status: 404 }), false);
});
