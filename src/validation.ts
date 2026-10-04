import { InputPoint, MAX_POINTS, Point } from "./types";

/**
 * 输入数值尺度上限。超过该量级的坐标在相减/相除时容易丢失精度或溢出，
 * 属于明确拒绝的范围，而不是静默继续。
 */
export const SCALE_LIMIT = 1e150;

export class ValidationError extends Error {
  constructor(
    public errorCode: string,
    message: string,
    public field?: string
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

function isIdLike(id: unknown): id is string {
  return typeof id === "string" && id.trim().length > 0;
}

/** 校验原始点集，返回保留输入顺序的点数组。 */
export function validatePoints(input: unknown): Point[] {
  if (!Array.isArray(input)) {
    throw new ValidationError("INVALID_BODY", "points 必须是数组", "points");
  }
  if (input.length === 0) {
    throw new ValidationError("EMPTY_POINTS", "点集不能为空", "points");
  }
  if (input.length > MAX_POINTS) {
    throw new ValidationError(
      "TOO_MANY_POINTS",
      `点数 ${input.length} 超过上限 ${MAX_POINTS}`,
      "points"
    );
  }

  const seen = new Set<string>();
  const points: Point[] = [];

  input.forEach((raw, idx) => {
    const field = `points[${idx}]`;
    if (raw === null || typeof raw !== "object") {
      throw new ValidationError("INVALID_POINT", `${field} 必须是对象`, field);
    }
    const obj = raw as Record<string, unknown>;
    if (!isIdLike(obj.id)) {
      throw new ValidationError(
        "INVALID_ID",
        `${field}.id 必须是非空字符串`,
        `${field}.id`
      );
    }
    const id = obj.id;
    if (/\s/.test(id)) {
      throw new ValidationError(
        "INVALID_ID",
        `编号 ${JSON.stringify(id)} 不能包含空白字符`,
        `${field}.id`
      );
    }
    if (seen.has(id)) {
      throw new ValidationError(
        "DUPLICATE_ID",
        `编号重复：${JSON.stringify(id)}`,
        `${field}.id`
      );
    }
    if (typeof obj.x !== "number" || typeof obj.y !== "number") {
      throw new ValidationError(
        "INVALID_COORDINATE",
        `${field} 的 x、y 必须是数值（number）`,
        field
      );
    }
    if (!Number.isFinite(obj.x) || !Number.isFinite(obj.y)) {
      throw new ValidationError(
        "NON_FINITE_INPUT",
        `${field}（编号 ${id}）的 x、y 必须是有限数值，不接受 NaN / Infinity`,
        field
      );
    }
    if (Math.abs(obj.x) > SCALE_LIMIT || Math.abs(obj.y) > SCALE_LIMIT) {
      throw new ValidationError(
        "SCALE_EXCEEDED",
        `编号 ${id} 的坐标绝对值超过尺度上限 ${SCALE_LIMIT}，请先按比例缩小数据`,
        field
      );
    }
    seen.add(id);
    points.push({ id, x: obj.x, y: obj.y, order: idx });
  });

  return points;
}

/**
 * 校验排除清单：必须是字符串数组、编号必须存在、不能重复。
 * 返回去重后的清单（保持首次出现顺序）。空数组表示不排除。
 */
export function validateExclusions(
  raw: unknown,
  knownIds: Set<string>
): string[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new ValidationError(
      "INVALID_EXCLUSIONS",
      "excludeIds 必须是编号字符串数组",
      "excludeIds"
    );
  }
  const result: string[] = [];
  const seen = new Set<string>();
  raw.forEach((id, idx) => {
    if (!isIdLike(id)) {
      throw new ValidationError(
        "INVALID_EXCLUSIONS",
        `excludeIds[${idx}] 必须是非空字符串`,
        `excludeIds[${idx}]`
      );
    }
    if (!knownIds.has(id)) {
      throw new ValidationError(
        "UNKNOWN_ID",
        `排除清单包含未知编号：${JSON.stringify(id)}`,
        "excludeIds"
      );
    }
    if (seen.has(id)) {
      throw new ValidationError(
        "INVALID_EXCLUSIONS",
        `排除清单中编号重复：${JSON.stringify(id)}`,
        "excludeIds"
      );
    }
    seen.add(id);
    result.push(id);
  });
  return result;
}

/** 按排除清单过滤点，保留原始输入顺序。 */
export function applyExclusions(
  points: Point[],
  excludeIds: string[]
): Point[] {
  const excluded = new Set(excludeIds);
  return points.filter((p) => !excluded.has(p.id));

}

export type { InputPoint };
