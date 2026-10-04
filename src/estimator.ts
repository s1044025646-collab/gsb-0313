import {
  LIMITS,
  MedianExplanation,
  PairSlope,
  PairSource,
  Point,
  RawPoint,
  ResidualRow,
  FitResult,
  ServiceError
} from './types.js';

/**
 * 校验原始观测：编号唯一且为非空字符串，x/y 必须为有限数值，
 * 并拒绝 |x|、|y| 超过 1e150 的极端尺度（防止中位数/斜率产生非有限值）。
 * 不删除任何点，也不做平滑或去重。
 */
export function validatePoints(raw: unknown): RawPoint[] {
  if (!Array.isArray(raw)) {
    throw new ServiceError('VALIDATION_ERROR', 'points 必须是数组');
  }
  if (raw.length === 0) {
    throw new ServiceError('VALIDATION_ERROR', 'points 不能为空');
  }
  if (raw.length > LIMITS.maxPoints) {
    throw new ServiceError(
      'TOO_MANY_POINTS',
      `点数超过上限：${raw.length} > ${LIMITS.maxPoints}`
    );
  }

  const seen = new Set<string>();
  const out: RawPoint[] = [];

  raw.forEach((item, idx) => {
    if (typeof item !== 'object' || item === null) {
      throw new ServiceError('VALIDATION_ERROR', `第 ${idx} 项不是对象`);
    }
    const p = item as Record<string, unknown>;
    if (typeof p.id !== 'string' || p.id.trim() === '') {
      throw new ServiceError('VALIDATION_ERROR', `第 ${idx} 项缺少非空字符串 id`);
    }
    if (seen.has(p.id)) {
      throw new ServiceError('DUPLICATE_ID', `编号重复：${p.id}`, { id: p.id });
    }
    if (typeof p.x !== 'number' || typeof p.y !== 'number') {
      throw new ServiceError(
        'VALIDATION_ERROR',
        `点 ${p.id} 的 x、y 必须是数字（收到 ${typeof p.x}/${typeof p.y}）`
      );
    }
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      throw new ServiceError(
        'VALIDATION_ERROR',
        `点 ${p.id} 含非有限值（NaN/Infinity/-Infinity）`
      );
    }
    if (Math.abs(p.x) > LIMITS.maxFiniteAbs || Math.abs(p.y) > LIMITS.maxFiniteAbs) {
      throw new ServiceError(
        'VALIDATION_ERROR',
        `点 ${p.id} 数值尺度超过 |v| <= ${LIMITS.maxFiniteAbs} 的限制`
      );
    }
    seen.add(p.id);
    out.push({ id: p.id, x: p.x, y: p.y });
  });

  return out;
}

function toPoints(raw: RawPoint[]): Point[] {
  return raw.map((p, seq) => ({ ...p, seq }));
}

interface SortedSlope {
  slope: number;
  i: Point;
  j: Point;
  dx: number;
  dy: number;
}

/**
 * 枚举所有 x 不相同的无序点对。
 * 同坐标不同编号视为不同观测，按实际条数参与统计，不去重。
 */
export function enumeratePairSlopes(points: Point[]): {
  sorted: SortedSlope[];
  skippedSameX: number;
} {
  const pairs: SortedSlope[] = [];
  let skippedSameX = 0;

  for (let a = 0; a < points.length; a++) {
    for (let b = a + 1; b < points.length; b++) {
      const pi = points[a]!;
      const pj = points[b]!;
      const dx = pj.x - pi.x;
      if (dx === 0) {
        skippedSameX += 1;
        continue;
      }
      const dy = pj.y - pi.y;
      const slope = dy / dx;
      if (!Number.isFinite(slope)) {
        throw new ServiceError(
          'NON_FINITE_RESULT',
          `点对 (${pi.id}, ${pj.id}) 产生非有限斜率，无法完成估计（不删除点后继续）`
        );
      }
      pairs.push({ slope, i: pi, j: pj, dx, dy });
    }
  }

  // 稳定排序：先按斜率，再按两端输入顺序，保证输入顺序不改变结果。
  pairs.sort((u, v) => {
    if (u.slope < v.slope) return -1;
    if (u.slope > v.slope) return 1;
    if (u.i.seq !== v.i.seq) return u.i.seq - v.i.seq;
    return u.j.seq - v.j.seq;
  });

  return { sorted: pairs, skippedSameX };
}

function medianOfSorted(values: number[]): {
  median: number;
  count: number;
  lowerIndex: number;
  upperIndex: number;
} {
  const n = values.length;
  if (n === 0) {
    throw new ServiceError('NOT_ENOUGH_OBSERVATIONS', '没有可用于计算中位数的值');
  }
  if (n % 2 === 1) {
    const idx = (n - 1) / 2;
    return { median: values[idx]!, count: n, lowerIndex: idx, upperIndex: idx };
  }
  const lo = n / 2 - 1;
  const hi = n / 2;
  const median = (values[lo]! + values[hi]!) / 2;
  return { median, count: n, lowerIndex: lo, upperIndex: hi };
}

function pairSource(pair: SortedSlope, rank: number): PairSource {
  return { iId: pair.i.id, jId: pair.j.id, slope: pair.slope, rank };
}

function explainSlopeMedian(sorted: SortedSlope[]): {
  slope: number;
  explanation: MedianExplanation;
} {
  const slopes = sorted.map((p) => p.slope);
  const m = medianOfSorted(slopes);
  if (!Number.isFinite(m.median)) {
    throw new ServiceError('NON_FINITE_RESULT', '斜率中位数为非有限值，无法完成估计');
  }
  if (m.count % 2 === 1) {
    return {
      slope: m.median,
      explanation: { count: m.count, source: pairSource(sorted[m.lowerIndex]!, m.lowerIndex) }
    };
  }
  return {
    slope: m.median,
    explanation: {
      count: m.count,
      lower: pairSource(sorted[m.lowerIndex]!, m.lowerIndex),
      upper: pairSource(sorted[m.upperIndex]!, m.upperIndex)
    }
  };
}

/**
 * Theil–Sen 拟合。
 * 斜率 = 所有有效成对斜率的中位数；
 * 截距 = 各观测 y_i - a*x_i 的中位数（偶数个取中间两项算术平均）。
 */
export function fitTheilSen(rawPoints: RawPoint[]): FitResult {
  const points = toPoints(rawPoints);

  if (points.length < 2) {
    throw new ServiceError(
      'NOT_ENOUGH_OBSERVATIONS',
      `有效观测不足：${points.length} 个，至少需要 2 个`
    );
  }

  const { sorted, skippedSameX } = enumeratePairSlopes(points);
  if (sorted.length === 0) {
    throw new ServiceError(
      'ALL_X_IDENTICAL',
      '所有观测的 x 相同，没有任何 x 不同的点对，无法识别直线（垂直直线不在本服务范围内）'
    );
  }

  const { slope, explanation: slopeMedian } = explainSlopeMedian(sorted);

  // 截距候选值。同样做稳定排序：先按值，再按输入顺序。
  const interceptCandidates = points.map((p) => ({
    point: p,
    value: p.y - slope * p.x
  }));
  if (interceptCandidates.some((c) => !Number.isFinite(c.value))) {
    throw new ServiceError(
      'NON_FINITE_RESULT',
      '存在非有限的截距候选值 y-a*x，无法完成估计'
    );
  }
  interceptCandidates.sort((u, v) => {
    if (u.value < v.value) return -1;
    if (u.value > v.value) return 1;
    return u.point.seq - v.point.seq;
  });
  const values = interceptCandidates.map((c) => c.value);
  const im = medianOfSorted(values);
  if (!Number.isFinite(im.median)) {
    throw new ServiceError('NON_FINITE_RESULT', '截距中位数为非有限值，无法完成估计');
  }

  const interceptMedian: FitResult['interceptMedian'] = { count: im.count };
  if (im.count % 2 === 1) {
    const c = interceptCandidates[im.lowerIndex]!;
    interceptMedian.sourceId = c.point.id;
    interceptMedian.sourceValue = c.value;
  } else {
    const lo = interceptCandidates[im.lowerIndex]!;
    const hi = interceptCandidates[im.upperIndex]!;
    interceptMedian.lowerId = lo.point.id;
    interceptMedian.upperId = hi.point.id;
    interceptMedian.lowerValue = lo.value;
    interceptMedian.upperValue = hi.value;
  }

  const residuals: ResidualRow[] = points.map((p) => {
    const predicted = slope * p.x + im.median;
    const residual = p.y - predicted;
    return {
      id: p.id,
      x: p.x,
      y: p.y,
      predicted,
      residual,
      absResidual: Math.abs(residual)
    };
  });

  // 按绝对残差降序便于定位；描述性排序，不代表错误数据判定。
  residuals.sort((u, v) => {
    if (u.absResidual > v.absResidual) return -1;
    if (u.absResidual < v.absResidual) return 1;
    return 0;
  });

  const absSorted = [...residuals.map((r) => r.absResidual)].sort((u, v) => u - v);
  const medianAbsResidual = medianOfSorted(absSorted).median;
  const maxAbsResidual = absSorted[absSorted.length - 1]!;

  const pairSlopes: PairSlope[] = sorted.map((p, rank) => ({
    iId: p.i.id,
    jId: p.j.id,
    slope: p.slope,
    dx: p.dx,
    dy: p.dy,
    rank
  }));

  return {
    slope,
    intercept: im.median,
    usedPointCount: points.length,
    validPairCount: sorted.length,
    skippedSameXPairCount: skippedSameX,
    slopeMedian,
    interceptMedian,
    residuals,
    medianAbsResidual,
    maxAbsResidual
  };
}

export function listPairSlopes(rawPoints: RawPoint[]): PairSlope[] {
  return fitTheilSen(rawPoints) && enumeratePairSlopes(toPoints(rawPoints)).sorted.map(
    (p, rank) => ({
      iId: p.i.id,
      jId: p.j.id,
      slope: p.slope,
      dx: p.dx,
      dy: p.dy,
      rank
    })
  );
}
