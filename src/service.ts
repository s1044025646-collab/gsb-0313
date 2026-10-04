import { randomUUID } from "node:crypto";
import { Store, AnalysisRow, DatasetRow } from "./db";
import { fitTheilSen } from "./theilSen";
import { Point, PairSlope } from "./types";
import {
  ValidationError,
  applyExclusions,
  validateExclusions,
  validatePoints,
} from "./validation";

export { ValidationError };

export class NotFoundError extends Error {
  constructor(
    public errorCode: string,
    message: string
  ) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class Service {
  constructor(private store: Store) {}

  importDataset(name: string | undefined, rawPoints: unknown): DatasetRow {
    const finalName = typeof name === "string" && name.trim() ? name.trim() : "未命名点集";
    const points = validatePoints(rawPoints);
    return this.store.insertDataset(randomUUID(), finalName, points);
  }

  getDataset(id: string): DatasetRow {
    const dataset = this.store.getDataset(id);
    if (!dataset) {
      throw new NotFoundError("DATASET_NOT_FOUND", `点集不存在：${id}`);
    }
    return dataset;
  }

  /**
   * 运行一次分析并保存完整快照。
   * 即使拟合本身失败（有效点不足 / 全相同 x / 非有限结果），也保存错误快照，
   * 但不删除任何输入点；未知编号等非法请求在保存前直接抛错。
   */
  runAnalysis(datasetId: string, rawExclusions: unknown): {
    analysis: AnalysisRow;
  } {
    const dataset = this.getDataset(datasetId);
    const knownIds = new Set(dataset.points.map((p) => p.id));
    const excludeIds = validateExclusions(rawExclusions, knownIds);
    const activePoints: Point[] = applyExclusions(dataset.points, excludeIds);
    const result = fitTheilSen(activePoints, excludeIds);
    const pairs: PairSlope[] = result.ok
      ? this.extractPairs(dataset.points, activePoints)
      : [];
    const analysis = this.store.insertAnalysis(
      randomUUID(),
      datasetId,
      excludeIds,
      result,
      pairs
    );
    return { analysis };
  }

  /**
   * 重新枚举点对用于快照查询。拟合时算法内部已枚举一次，
   * 这里为保持存储模块简单而独立枚举（n <= 200，O(n^2) 可接受）。
   */
  private extractPairs(allPoints: Point[], activePoints: Point[]): PairSlope[] {
    const pairs: PairSlope[] = [];
    for (let a = 0; a < activePoints.length; a++) {
      for (let b = a + 1; b < activePoints.length; b++) {
        const pi = activePoints[a];
        const pj = activePoints[b];
        if (pi.x === pj.x) continue;
        pairs.push({
          idI: pi.id,
          idJ: pj.id,
          i: pi.order,
          j: pj.order,
          xi: pi.x,
          yi: pi.y,
          xj: pj.x,
          yj: pj.y,
          slope: (pj.y - pi.y) / (pj.x - pi.x),
        });
      }
    }
    pairs.sort((u, v) => {
      if (u.slope < v.slope) return -1;
      if (u.slope > v.slope) return 1;
      if (u.i !== v.i) return u.i - v.i;
      return u.j - v.j;
    });
    return pairs;
  }

  getAnalysis(id: string): AnalysisRow {
    const analysis = this.store.getAnalysis(id);
    if (!analysis) {
      throw new NotFoundError("ANALYSIS_NOT_FOUND", `分析不存在：${id}`);
    }
    return analysis;
  }

  queryPairs(
    analysisId: string,
    opts: { pointId?: string; limit?: number } = {}
  ): { analysisId: string; totalPairs: number; pairs: PairSlope[] } {
    const analysis = this.getAnalysis(analysisId);
    let pairs = analysis.pairs;
    if (opts.pointId !== undefined) {
      pairs = pairs.filter(
        (p) => p.idI === opts.pointId || p.idJ === opts.pointId
      );
    }
    const totalPairs = pairs.length;
    if (typeof opts.limit === "number" && opts.limit >= 0) {
      pairs = pairs.slice(0, opts.limit);
    }
    return { analysisId, totalPairs, pairs };
  }

  listDatasets() {
    return this.store.listDatasets();
  }

  listDatasetAnalyses(datasetId: string) {
    this.getDataset(datasetId);
    return this.store.listAnalyses(datasetId);
  }

  listAllAnalyses() {
    return this.store.listAnalyses();
  }
}
