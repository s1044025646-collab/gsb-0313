export const ALGORITHM_VERSION = 'theil-sen-v1';

export const LIMITS = {
  maxPoints: 200,
  maxFiniteAbs: 1e150
} as const;

export interface RawPoint {
  id: string;
  x: number;
  y: number;
}

export interface Point extends RawPoint {
  /** 输入顺序序号（从 0 开始），保证估计与排序与输入顺序无关但可复现 */
  seq: number;
}

export interface PairSlope {
  /** 无序点对中编号较小（按输入顺序）一端 */
  iId: string;
  jId: string;
  slope: number;
  dx: number;
  dy: number;
  /** 斜率升序后的稳定位次（0 起），编号顺序作为决胜依据 */
  rank: number;
}

export interface MedianExplanation {
  count: number;
  /** 奇数：1 个来源；偶数：中间两个来源（斜率较小者在前） */
  lower?: PairSource;
  upper?: PairSource;
  source?: PairSource;
}

export interface PairSource {
  iId: string;
  jId: string;
  slope: number;
  rank: number;
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
  slope: number;
  intercept: number;
  usedPointCount: number;
  validPairCount: number;
  skippedSameXPairCount: number;
  slopeMedian: MedianExplanation;
  interceptMedian: {
    count: number;
    lowerId?: string;
    upperId?: string;
    sourceId?: string;
    lowerValue?: number;
    upperValue?: number;
    sourceValue?: number;
  };
  residuals: ResidualRow[];
  medianAbsResidual: number;
  maxAbsResidual: number;
}

export interface FitRequest {
  pointSetId: string;
  pointSetVersion: number;
  excludedIds: string[];
}

export interface FitRecord extends FitRequest {
  id: number;
  algorithmVersion: string;
  createdAt: string;
  result: FitResult;
}

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'DUPLICATE_ID'
  | 'TOO_MANY_POINTS'
  | 'POINT_SET_NOT_FOUND'
  | 'ANALYSIS_NOT_FOUND'
  | 'UNKNOWN_EXCLUDED_ID'
  | 'NOT_ENOUGH_OBSERVATIONS'
  | 'ALL_X_IDENTICAL'
  | 'NON_FINITE_RESULT'
  | 'NOT_FOUND';

export class ServiceError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.details = details;
  }
}
