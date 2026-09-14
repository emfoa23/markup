// 판매점 마스터 완료 판정 규칙 — scripts/lib/completion.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { remainingQueries, verifiableQueries } from "../scripts/lib/completion.mjs";

const c = (stale, fresh) => ({ stale, fresh });
const all = verifiableQueries();

test("verifiableQueries: marks 없는 '전남' 보조 질의는 판정 대상이 아니고, 부분 집합은 그 안에서만", () => {
  assert.equal(all.length, 16);
  assert.ok(!all.some((q) => q.query === "전남"));
  assert.deepEqual(verifiableQueries(["부산", "전북", "전남"]).map((q) => q.query), ["부산", "전북"]);
});

test("remainingQueries: stale 0 이고 fresh 1+ 이면 완료", () => {
  const bySido = Object.fromEntries(all.flatMap((q) => q.marks).map((s) => [s, c(0, 5)]));
  assert.deepEqual(remainingQueries(all, bySido), []);
});

test("remainingQueries: 미갱신 open 이 남으면 미완료(부분 upsert·폐점 누락), 한 번도 안 돌았으면(fresh 0) 미완료", () => {
  const bySido = Object.fromEntries(all.flatMap((q) => q.marks).map((s) => [s, c(0, 5)]));
  bySido["부산"] = c(1007, 0);
  bySido["전북"] = c(3, 436);
  assert.deepEqual(remainingQueries(all, bySido), ["부산", "전북"]);
});

test("remainingQueries: 통합 질의 '전남광주' 는 광주·전남 둘 다 완료여야 한다", () => {
  const bySido = Object.fromEntries(all.flatMap((q) => q.marks).map((s) => [s, c(0, 5)]));
  bySido["전남"] = c(2, 458);
  assert.deepEqual(remainingQueries(all, bySido), ["전남광주"]);
  assert.deepEqual(remainingQueries(verifiableQueries(["서울"]), bySido), []);
});

test("remainingQueries: 집계가 없는 시도는 미완료로 본다", () => {
  assert.deepEqual(remainingQueries(verifiableQueries(["세종"]), {}), ["세종"]);
});
