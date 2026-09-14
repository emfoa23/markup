// 판매점 마스터 동기화의 "완료" 판정 — CI 잡 상태가 아니라 DB 로 판단한다(순수 함수, tests/completion.test.mjs).
// 완주한 질의는 그 marks 시도의 모든 open 지점에 master_seen_at 을 찍고 미출현 지점을 closed 로 바꾸므로,
// 실행 시작 이후 갱신되지 않은 open 지점(stale)이 0 이고 갱신된 지점(fresh)이 1 이상이면 완료다.
// 부분 upsert·폐점 마킹 누락은 stale > 0 으로, 한 번도 안 돈 질의는 fresh = 0 으로 잡힌다.
import { MASTER_QUERIES } from "./dhlottery.mjs";

/** 판정 대상 질의 — marks 가 있는 것만(DB 로 확인 가능). marks 없는 '전남' 보조 질의는 best-effort 로 재실행하지 않는다. */
export function verifiableQueries(targetNames) {
  const targets = targetNames?.length ? new Set(targetNames) : null;
  return MASTER_QUERIES.filter((q) => q.marks.length && (!targets || targets.has(q.query)));
}

/**
 * 미완료 질의 이름 목록.
 * @param {{query: string, marks: string[]}[]} queries
 * @param {Record<string, {stale: number, fresh: number}>} bySido 시도별 집계
 */
export function remainingQueries(queries, bySido) {
  const incomplete = (sido) => {
    const c = bySido[sido] ?? { stale: 0, fresh: 0 };
    return c.stale > 0 || c.fresh === 0;
  };
  return queries.filter((q) => q.marks.some(incomplete)).map((q) => q.query);
}
