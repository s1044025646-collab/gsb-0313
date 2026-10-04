import {
  ALGORITHM_VERSION,
  FitResult,
  MedianSource,
  PairSlope,
  Point,
  ResidualRow,
} from "./types";

/**
 * 中位数（偶数个值取中间两项算术平均）。
 * 同时返回中间项在“已排序数组”中的位置，用于解释来源。
 * 调用方必须保证 values 已按 value 升序稳定排序。
 */
export function medianOfSorted(values: number[]): {
  median: number;
  indexes: number[];
} {
  const n = values.length;
  if (n === 0) {
    return { median: NaN, indexes: [] };
  }
  if (n % 2 === 1) {
    const idx = (n - 1) / 2;
    return { median: values[idx], indexes: [idx] };
  }
  const hi = n / 2;
  const lo = hi - 1;
  return { median: (values[lo] + values[hi]) / 2, indexes: [lo, hi] };
}

/**
 * 枚举所有 x 不相同的无序点对，计算斜率中位数。
 * 点对 (i,j) 中 i < j（输入顺序）；相同 x 的点对跳过并计数。
 */
export function slopeEstimate(points: Point[]): {
  result:
    | ({ status: "ok" } & {
        slope: number;
        pairCount: number;
        skippedSameX: number;
        medianSources: MedianSource[];
        pairs: PairSlope[];
      })
    | { status: "error"; errorCode: string; message: string; skippedSameX: number };
} {
  const pairs: PairSlope[] = [];
  let skippedSameX = 0;

  for (let a = 0; a < points.length; a++) {
    for (let b = a + 1; b < points.length; b++) {
      const pi = points[a];
      const pj = points[b];
      if (pi.x === pj.x) {
        skippedSameX++;
        continue;
      }
      const slope = (pj.y - pi.y) / (pj.x - pi.x);
      if (!Number.isFinite(slope)) {
        // 有限输入相除得到非有限结果，属于数值尺度问题，不能当作合法斜率。
        return {
          result: {
            status: "error",
            errorCode: "NON_FINITE_SLOPE",
            message: `点对 (${pi.id}, ${pj.id}) 计算出非有限斜率，输入数值尺度可能超出可表示范围`,
            skippedSameX,
          },
        };
      }
      pairs.push({
        idI: pi.id,
        idJ: pj.id,
        i: a,
        j: b,
        xi: pi.x,
        yi: pi.y,
        xj: pj.x,
        yj: pj.y,
        slope,
      });
    }
  }

  if (pairs.length === 0) {
    return {
      result: {
        status: "error",
        errorCode: "ALL_X_EQUAL",
        message: "没有任何 x 互不相同的有效点对，无法识别直线（斜率不可定义）",
        skippedSameX,
      },
    };
  }

  // 稳定排序：斜率升序，相同斜率按 i、再按 j（输入编号顺序）。
  const sorted = pairs.slice().sort((u, v) => {
    if (u.slope < v.slope) return -1;
    if (u.slope > v.slope) return 1;
    if (u.i !== v.i) return u.i - v.i;
    return u.j - v.j;
  });

  const { median, indexes } = medianOfSorted(sorted.map((p) => p.slope));
  if (!Number.isFinite(median)) {
    return {
      result: {
        status: "error",
        errorCode: "NON_FINITE_SLOPE",
        message: "成对斜率的中位数非有限，输入数值尺度可能超出可表示范围",
        skippedSameX,
      },
    };
  }

  const medianSources: MedianSource[] = indexes.map((idx) => ({
    index: idx,
    value: sorted[idx].slope,
    idI: sorted[idx].idI,
    idJ: sorted[idx].idJ,
  }));

  return {
    result: {
      status: "ok",
      slope: median,
      pairCount: pairs.length,
      skippedSameX,
      medianSources,
      pairs: sorted,
    },
  };
}

/**
 * Theil-Sen 完整估计：
 * 1) 有效点对斜率取中位数 -> a
 * 2) 每个观测 yi - a*xi 的中位数 -> b
 * points 必须已经按输入顺序排列。
 */
export function fitTheilSen(
  points: Point[],
  excludedIds: string[] = []
): FitResult {
  const base: FitResult = {
    ok: false,
    algorithmVersion: ALGORITHM_VERSION,
    pointCount: points.length,
    excludedIds: excludedIds.slice(),
    slope: null,
    intercept: null,
    pairCount: 0,
    skippedSameX: 0,
    slopeMedianSources: [],
    interceptMedianSources: [],
    residuals: [],
    medianAbsResidual: null,
    maxAbsResidual: null,
  };

  if (points.length < 2) {
    return {
      ...base,
      errorCode: "INSUFFICIENT_POINTS",
      message:
        points.length === 0
          ? "没有任何参与分析的观测点，至少需要 2 个有效观测"
          : "仅有 1 个参与分析的观测点，至少需要 2 个有效观测才能确定成对斜率",
    };
  }

  const slopeOut = slopeEstimate(points);
  if (slopeOut.result.status === "error") {
    const err = slopeOut.result;
    return {
      ...base,
      skippedSameX: err.skippedSameX,
      errorCode: err.errorCode,
      message: err.message,
    };
  }

  const slope = slopeOut.result.slope;

  // 截距候选：yi - a*xi，按值稳定排序（同值保持输入顺序）。
  const interceptCandidates = points.map((p, idx) => ({
    order: idx,
    id: p.id,
    value: p.y - slope * p.x,
  }));

  for (const c of interceptCandidates) {
    if (!Number.isFinite(c.value)) {
      return {
        ...base,
        pairCount: slopeOut.result.pairCount,
        skippedSameX: slopeOut.result.skippedSameX,
        slope,
        slopeMedianSources: slopeOut.result.medianSources,
        errorCode: "NON_FINITE_INTERCEPT",
        message: `观测 ${c.id} 的截距候选值 y-a*x 非有限，输入数值尺度可能超出可表示范围`,
      };
    }
  }

  const sortedCandidates = interceptCandidates.slice().sort((u, v) => {
    if (u.value < v.value) return -1;
    if (u.value > v.value) return 1;
    return u.order - v.order;
  });
  const { median: intercept, indexes } = medianOfSorted(
    sortedCandidates.map((c) => c.value)
  );
  if (!Number.isFinite(intercept)) {
    return {
      ...base,
      pairCount: slopeOut.result.pairCount,
      skippedSameX: slopeOut.result.skippedSameX,
      slope,
      slopeMedianSources: slopeOut.result.medianSources,
      errorCode: "NON_FINITE_INTERCEPT",
      message: "截距中位数非有限，输入数值尺度可能超出可表示范围",
    };
  }

  const interceptMedianSources: MedianSource[] = indexes.map((idx) => ({
    index: idx,
    value: sortedCandidates[idx].value,
    idI: sortedCandidates[idx].id,
    idJ: sortedCandidates[idx].id,
  }));

  // 残差：y - (a*x + b)，保留输入顺序计算，输出按绝对残差降序。
  const residuals: ResidualRow[] = points.map((p) => {
    const predicted = slope * p.x + intercept;
    const residual = p.y - predicted;
    return {
      id: p.id,
      x: p.x,
      y: p.y,
      predicted,
      residual,
      absResidual: Math.abs(residual),
    };
  });

  const byAbsDesc = residuals.slice().sort((u, v) => {
    if (u.absResidual > v.absResidual) return -1;
    if (u.absResidual < v.absResidual) return 1;
    // 绝对值相同：稳定，按输入顺序（points 中同位置查找代价小，n<=200）。
    const oi = points.findIndex((p) => p.id === u.id);
    const oj = points.findIndex((p) => p.id === v.id);
    return oi - oj;
  });

  const absValues = residuals.map((r) => r.absResidual).sort((u, v) => u - v);
  const medianAbs = medianOfSorted(absValues).median;
  const maxAbs = absValues.length > 0 ? absValues[absValues.length - 1] : null;

  return {
    ok: true,
    algorithmVersion: ALGORITHM_VERSION,
    pointCount: points.length,
    excludedIds: excludedIds.slice(),
    slope,
    intercept,
    pairCount: slopeOut.result.pairCount,
    skippedSameX: slopeOut.result.skippedSameX,
    slopeMedianSources: slopeOut.result.medianSources,
    interceptMedianSources,
    residuals: byAbsDesc,
    medianAbsResidual: medianAbs,
    maxAbsResidual: maxAbs,
  };
}
