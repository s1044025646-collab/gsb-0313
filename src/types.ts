// 共享类型定义

export const ALGORITHM_VERSION = "theil-sen-1.0.0";
export const MAX_POINTS = 200;

/** 输入观测点：编号必须唯一 */
export interface InputPoint {
  id: string;
  x: number;
  y: number;
}

/** 参与拟合的观测点（保留原始顺序与编号） */
export interface Point extends InputPoint {
  /** 输入序号，从 0 开始，用于稳定排序 */
  order: number;
}

/** 一对观测点计算出的斜率 */
export interface PairSlope {
  idI: string;
  idJ: string;
  i: number;
  j: number;
  xi: number;
  yi: number;
  xj: number;
  yj: number;
  slope: number;
}

/** 中位数来源：可能是单个值或两个值的平均 */
export interface MedianSource {
  index: number;
  value: number;
  idI: string;
  idJ: string;
}

export interface SlopeResult {
  slope: number;
  pairCount: number;
  skippedSameX: number;
  /** 中位数依据（1 个或 2 个点对） */
  medianSources: MedianSource[];
  /** 全部有效点对，按斜率升序、稳定编号顺序 */
  pairs: PairSlope[];
}

export interface ResidualRow {
  id: string;
  x: number;
  y: number;
  predicted: number;
  residual: number;
  absResidual: number;
}

export interface FitResult {
  ok: boolean;
  algorithmVersion: string;
  pointCount: number;
  excludedIds: string[];
  slope: number | null;
  intercept: number | null;
  pairCount: number;
  skippedSameX: number;
  slopeMedianSources: MedianSource[];
  interceptMedianSources: MedianSource[];
  /** 残差，按绝对残差降序排列，绝对值相同按编号稳定排列 */
  residuals: ResidualRow[];
  medianAbsResidual: number | null;
  maxAbsResidual: number | null;
  /** ok=false 时的错误码 */
  errorCode?: string;
  message?: string;
}
