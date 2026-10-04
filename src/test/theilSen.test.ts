import test from "node:test";
import assert from "node:assert/strict";
import { fitTheilSen, medianOfSorted, slopeEstimate } from "../theilSen";
import { Point } from "../types";

function pts(rows: Array<[string, number, number]>): Point[] {
  return rows.map(([id, x, y], order) => ({ id, x, y, order }));
}

test("中位数：奇数取中间，偶数取中间两项平均", () => {
  assert.deepEqual(medianOfSorted([3, 1, 2].sort((a, b) => a - b)), {
    median: 2,
    indexes: [1],
  });
  assert.deepEqual(medianOfSorted([1, 2, 3, 4]), {
    median: 2.5,
    indexes: [1, 2],
  });
});

test("演示 A：完美直线四点 + 异常 y=100 -> a=1 b=0，异常点残差最大", () => {
  const result = fitTheilSen(
    pts([
      ["p0", 0, 0],
      ["p1", 1, 1],
      ["p2", 2, 2],
      ["p3", 3, 3],
      ["p4", 4, 100],
    ])
  );
  assert.equal(result.ok, true);
  assert.equal(result.slope, 1);
  assert.equal(result.intercept, 0);
  assert.equal(result.pairCount, 10);
  assert.equal(result.skippedSameX, 0);
  assert.equal(result.residuals[0].id, "p4");
  assert.equal(result.residuals[0].residual, 96);
  for (const id of ["p0", "p1", "p2", "p3"]) {
    const row = result.residuals.find((r) => r.id === id)!;
    assert.equal(row.residual, 0);
  }
  assert.equal(result.maxAbsResidual, 96);
});

test("完美直线：任意点都在直线上时残差全 0", () => {
  const result = fitTheilSen(
    pts([
      ["a", -2, -4],
      ["b", 0, 0],
      ["c", 5, 10],
    ])
  );
  assert.equal(result.slope, 2);
  assert.equal(result.intercept, 0);
  assert.ok(result.residuals.every((r) => r.residual === 0));
  assert.equal(result.medianAbsResidual, 0);
});

test("只有两个点：斜率即两点斜率，截距由两点 yi-a*xi 决定", () => {
  const result = fitTheilSen(
    pts([
      ["a", 0, 1],
      ["b", 2, 5],
    ])
  );
  assert.equal(result.ok, true);
  assert.equal(result.pairCount, 1);
  assert.equal(result.slope, 2);
  assert.equal(result.intercept, 1);
});

test("不足两个有效观测：报告无法识别", () => {
  const zero = fitTheilSen(pts([]));
  assert.equal(zero.ok, false);
  assert.equal(zero.errorCode, "INSUFFICIENT_POINTS");
  const one = fitTheilSen(pts([["a", 1, 1]]));
  assert.equal(one.errorCode, "INSUFFICIENT_POINTS");
});

test("全部 x 相同：点对全部跳过，无法识别直线", () => {
  const result = fitTheilSen(
    pts([
      ["a", 3, 0],
      ["b", 3, 1],
      ["c", 3, 9],
    ])
  );
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "ALL_X_EQUAL");
  assert.equal(result.skippedSameX, 3);
});

test("重复观测（同坐标不同编号）按实际条数参与，不去重", () => {
  const result = fitTheilSen(
    pts([
      ["a", 1, 1],
      ["b", 1, 1],
      ["c", 2, 3],
    ])
  );
  assert.equal(result.pointCount, 3);
  // (a,c) 与 (b,c) 斜率都是 2，(a,b) 同 x 跳过
  assert.equal(result.pairCount, 2);
  assert.equal(result.skippedSameX, 1);
  assert.equal(result.slope, 2);
});

test("输入重排不改变估计结果", () => {
  const r1 = fitTheilSen(
    pts([
      ["a", 0, 0],
      ["b", 1, 2],
      ["c", 2, 1],
      ["d", 3, 5],
    ])
  );
  const r2 = fitTheilSen(
    pts([
      ["d", 3, 5],
      ["a", 0, 0],
      ["c", 2, 1],
      ["b", 1, 2],
    ])
  );
  assert.equal(r1.slope, r2.slope);
  assert.equal(r1.intercept, r2.intercept);
});

test("y 整体平移 c：斜率不变，截距增加 c", () => {
  const base = pts([
    ["a", 0, 1],
    ["b", 1, 3],
    ["c", 2, 2],
    ["d", 3, 6],
  ]);
  const shifted: Point[] = base.map((p) => ({ ...p, y: p.y + 7 }));
  const r1 = fitTheilSen(base);
  const r2 = fitTheilSen(shifted);
  assert.ok(Math.abs((r1.slope ?? NaN) - (r2.slope ?? NaN)) < 1e-12);
  assert.ok(Math.abs((r2.intercept ?? NaN) - ((r1.intercept ?? NaN) + 7)) < 1e-12);
});

test("偶数个斜率：中位数为中间两项算术平均", () => {
  // 构造 4 点共 6 个有效点对，手工核对。
  const result = fitTheilSen(
    pts([
      ["a", 0, 0],
      ["b", 1, 1],
      ["c", 2, 3],
      ["d", 3, 2],
    ])
  );
  assert.equal(result.pairCount, 6);
  assert.equal(result.slopeMedianSources.length, 2);
  const mid =
    (result.slopeMedianSources[0].value + result.slopeMedianSources[1].value) / 2;
  assert.ok(Math.abs(result.slope! - mid) < 1e-12);
});

test("中位数上下至少各有一半样本（点对排序位置核对）", () => {
  const points = pts([
    ["a", 0, 0],
    ["b", 1, 10],
    ["c", 2, 2],
    ["d", 3, 3],
    ["e", 4, 4],
  ]);
  const se = slopeEstimate(points);
  assert.equal(se.result.status, "ok");
  if (se.result.status !== "ok") return;
  const n = se.result.pairs.length;
  for (const src of se.result.medianSources) {
    // 中间位置：左侧（更小或相等）与右侧（更大或相等）都不少于 floor(n/2)
    assert.ok(src.index >= Math.floor((n - 1) / 2));
    assert.ok(src.index <= Math.floor(n / 2));
  }

  const result = fitTheilSen(points);
  for (const r of result.residuals) {
    assert.ok(
      Math.abs(r.y - (result.slope! * r.x + result.intercept!) - r.residual) < 1e-9
    );
  }
});

test("排除点后点数不足时明确失败而非给出直线", () => {
  const all = pts([
      ["a", 0, 0],
      ["b", 0, 2],
      ["c", 1, 1],
    ]);
  const result = fitTheilSen(
    all.filter((p) => p.id !== "c"),
    ["c"]
  );
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "ALL_X_EQUAL");
  assert.equal(result.skippedSameX, 1);
  assert.deepEqual(result.excludedIds, ["c"]);
});
