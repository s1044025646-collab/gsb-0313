import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ALGORITHM_VERSION, FitResult, PairSlope, Point } from "./types";

export interface DatasetRow {
  id: string;
  name: string;
  version: number;
  point_count: number;
  points: Point[];
  algorithm_version: string;
  created_at: string;
}

export interface AnalysisRow {
  id: string;
  dataset_id: string;
  created_at: string;
  algorithm_version: string;
  exclude_ids: string[];
  status: "ok" | "error";
  error_code: string | null;
  message: string | null;
  result: FitResult;
  pairs: PairSlope[];
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS datasets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version INTEGER NOT NULL,
        point_count INTEGER NOT NULL,
        points_json TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS analyses (
        id TEXT PRIMARY KEY,
        dataset_id TEXT NOT NULL REFERENCES datasets(id),
        created_at TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        exclude_ids_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('ok','error')),
        error_code TEXT,
        message TEXT,
        result_json TEXT NOT NULL,
        pairs_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_analyses_dataset ON analyses(dataset_id, created_at);
    `);
  }

  close(): void {
    this.db.close();
  }

  insertDataset(id: string, name: string, points: Point[]): DatasetRow {
    // 同名点集按版本递增，历史导入不被覆盖。
    const maxVersionRow = this.db
      .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM datasets WHERE name = ?")
      .get(name) as { v: number } | undefined;
    const version = (maxVersionRow?.v ?? 0) + 1;
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO datasets (id, name, version, point_count, points_json, algorithm_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        name,
        version,
        points.length,
        JSON.stringify(points),
        ALGORITHM_VERSION,
        createdAt
      );
    return {
      id,
      name,
      version,
      point_count: points.length,
      points,
      algorithm_version: ALGORITHM_VERSION,
      created_at: createdAt,
    };
  }

  getDataset(id: string): DatasetRow | null {
    const row = this.db.prepare("SELECT * FROM datasets WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.hydrateDataset(row) : null;
  }

  listDatasets(): Array<Omit<DatasetRow, "points">> {
    const rows = this.db
      .prepare(
        "SELECT id, name, version, point_count, algorithm_version, created_at FROM datasets ORDER BY created_at DESC, name"
      )
      .all() as Array<Omit<DatasetRow, "points">>;
    return rows;
  }

  private hydrateDataset(row: Record<string, unknown>): DatasetRow {
    return {
      id: row.id as string,
      name: row.name as string,
      version: row.version as number,
      point_count: row.point_count as number,
      points: JSON.parse(row.points_json as string) as Point[],
      algorithm_version: row.algorithm_version as string,
      created_at: row.created_at as string,
    };
  }

  insertAnalysis(
    id: string,
    datasetId: string,
    excludeIds: string[],
    result: FitResult,
    pairs: PairSlope[]
  ): AnalysisRow {
    const createdAt = new Date().toISOString();
    const status = result.ok ? "ok" : "error";
    this.db
      .prepare(
        `INSERT INTO analyses
         (id, dataset_id, created_at, algorithm_version, exclude_ids_json, status, error_code, message, result_json, pairs_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        datasetId,
        createdAt,
        result.algorithmVersion,
        JSON.stringify(excludeIds),
        status,
        result.errorCode ?? null,
        result.message ?? null,
        JSON.stringify(result),
        JSON.stringify(pairs)
      );
    return this.hydrateAnalysis({
      id,
      dataset_id: datasetId,
      created_at: createdAt,
      algorithm_version: result.algorithmVersion,
      exclude_ids_json: JSON.stringify(excludeIds),
      status,
      error_code: result.errorCode ?? null,
      message: result.message ?? null,
      result_json: JSON.stringify(result),
      pairs_json: JSON.stringify(pairs),
    } as Record<string, unknown>);
  }

  getAnalysis(id: string): AnalysisRow | null {
    const row = this.db.prepare("SELECT * FROM analyses WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.hydrateAnalysis(row) : null;
  }

  listAnalyses(datasetId?: string): Array<{
    id: string;
    dataset_id: string;
    created_at: string;
    algorithm_version: string;
    exclude_ids: string[];
    status: string;
    error_code: string | null;
  }> {
    const rows = datasetId
      ? (this.db
          .prepare(
            "SELECT id, dataset_id, created_at, algorithm_version, exclude_ids_json, status, error_code FROM analyses WHERE dataset_id = ? ORDER BY created_at DESC"
          )
          .all(datasetId) as Record<string, unknown>[])
      : (this.db
          .prepare(
            "SELECT id, dataset_id, created_at, algorithm_version, exclude_ids_json, status, error_code FROM analyses ORDER BY created_at DESC"
          )
          .all() as Record<string, unknown>[]);
    return rows.map((r) => ({
      id: r.id as string,
      dataset_id: r.dataset_id as string,
      created_at: r.created_at as string,
      algorithm_version: r.algorithm_version as string,
      exclude_ids: JSON.parse(r.exclude_ids_json as string) as string[],
      status: r.status as string,
      error_code: (r.error_code as string | null) ?? null,
    }));
  }

  private hydrateAnalysis(row: Record<string, unknown>): AnalysisRow {
    return {
      id: row.id as string,
      dataset_id: row.dataset_id as string,
      created_at: row.created_at as string,
      algorithm_version: row.algorithm_version as string,
      exclude_ids: JSON.parse(row.exclude_ids_json as string) as string[],
      status: row.status as "ok" | "error",
      error_code: (row.error_code as string | null) ?? null,
      message: (row.message as string | null) ?? null,
      result: JSON.parse(row.result_json as string) as FitResult,
      pairs: JSON.parse(row.pairs_json as string) as PairSlope[],
    };
  }
}
