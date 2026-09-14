// sync-stores 단계 사이의 미완료 질의 산출 + 최종 판정(scripts/lib/completion.mjs 규칙).
//   RUN_STARTED_AT=<ISO>  실행 시작 시각(이 시각 이후 master_seen_at 이 찍혀야 갱신으로 본다)
//   TARGET_QUERIES=<JSON 배열|빈값>  판정 범위(부분 dispatch 의 queries 입력, 비우면 전국)
//   --assert-empty  미완료가 남으면 exit 1 (verdict 잡). 없으면 미완료 목록을 GITHUB_OUTPUT 의 remaining= 에 쓴다.
// 로컬 감사에도 쓴다: RUN_STARTED_AT=2026-09-12T19:30:00Z node scripts/stores-remaining.mjs → 그 주에 안 돈 질의.
import { appendFileSync } from "node:fs";
import { remainingQueries, verifiableQueries } from "./lib/completion.mjs";
import { countRows } from "./lib/supa.mjs";
import { log } from "./lib/log.mjs";

const startIso = process.env.RUN_STARTED_AT;
if (!startIso || Number.isNaN(new Date(startIso).getTime())) {
  console.error("RUN_STARTED_AT=<ISO> is required");
  process.exit(2);
}
const targets = (() => {
  const raw = (process.env.TARGET_QUERIES || "").trim();
  return raw ? JSON.parse(raw) : [];
})();
const assertEmpty = process.argv.includes("--assert-empty");

const queries = verifiableQueries(targets);
const sidos = [...new Set(queries.flatMap((q) => q.marks))];
const start = encodeURIComponent(startIso);
const bySido = {};
for (const sido of sidos) {
  const s = encodeURIComponent(sido);
  const stale = await countRows(`stores?sido=eq.${s}&status=eq.open&master_seen_at=not.is.null&master_seen_at=lt.${start}`);
  const fresh = await countRows(`stores?sido=eq.${s}&master_seen_at=gte.${start}`);
  const closed = await countRows(`stores?sido=eq.${s}&status=eq.closed&updated_at=gte.${start}`);
  bySido[sido] = { stale: stale ?? 0, fresh: fresh ?? 0, closed: closed ?? 0 };
}
const remaining = remainingQueries(queries, bySido);

const rows = queries.map((q) => {
  const done = !remaining.includes(q.query);
  const sum = (k) => q.marks.reduce((n, s) => n + bySido[s][k], 0);
  return `| ${q.query} | ${done ? "완료" : "**미완료**"} | ${sum("fresh")} | ${sum("stale")} | ${sum("closed")} |`;
});
const table = ["| 질의 | 상태 | 갱신 지점 | 미갱신 open | 이번 폐점 |", "|---|---|---:|---:|---:|", ...rows].join("\n");
log(`stores completion since ${startIso}: ${queries.length - remaining.length}/${queries.length} done, remaining=${JSON.stringify(remaining)}`);
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### 판매점 마스터 완료 판정 (${startIso} 이후)\n\n${table}\n\n미완료: ${remaining.length ? remaining.join(", ") : "없음"}\n\n`);
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `remaining=${JSON.stringify(remaining)}\n`);
if (assertEmpty && remaining.length) {
  console.error(`::error::판매점 마스터 미완료 질의: ${remaining.join(", ")}`);
  process.exit(1);
}
