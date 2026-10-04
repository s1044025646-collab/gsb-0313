import test from "node:test";
import assert from "node:assert/strict";
import {
  applyExclusions,
  validateExclusions,
  validatePoints,
  ValidationError,
} from "../validation";

test("重复编号被拒绝", () => {
  assert.throws(
    () =>
      validatePoints([
        { id: "a", x: 0, y: 0 },
        { id: "a", x: 1, y: 1 },
      ]),
    (err: unknown) => err instanceof ValidationError && err.errorCode === "DUPLICATE_ID"
  );
});

test("非有限值被拒绝", () => {
  assert.throws(
    () => validatePoints([{ id: "a", x: NaN, y: 0 }]),
    (err: unknown) => err instanceof ValidationError && err.errorCode === "NON_FINITE_INPUT"
  );
  assert.throws(
    () => validatePoints([{ id: "a", x: 1, y: Infinity }]),
    (err: unknown) => err instanceof ValidationError && err.errorCode === "NON_FINITE_INPUT"
  );
});

test("超过点数上限被拒绝", () => {
  const points = Array.from({ length: 201 }, (_, i) => ({
    id: `p${i}`,
    x: i,
    y: i,
  }));
  assert.throws(
    () => validatePoints(points),
    (err: unknown) => err instanceof ValidationError && err.errorCode === "TOO_MANY_POINTS"
  );
});

test("超大尺度被拒绝", () => {
  assert.throws(
    () => validatePoints([{ id: "a", x: 1e200, y: 0 }]),
    (err: unknown) => err instanceof ValidationError && err.errorCode === "SCALE_EXCEEDED"
  );
});

test("排除清单：未知编号与重复编号报错，合法清单保持顺序", () => {
  const points = validatePoints([
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 1, y: 1 },
  ]);
  const ids = new Set(points.map((p) => p.id));
  assert.deepEqual(validateExclusions(["b", "a"], ids), ["b", "a"]);
  assert.throws(
    () => validateExclusions(["a", "a"], ids),
    (err: unknown) => err instanceof ValidationError && err.errorCode === "INVALID_EXCLUSIONS"
  );
  assert.throws(
    () => validateExclusions(["zzz"], ids),
    (err: unknown) => err instanceof ValidationError && err.errorCode === "UNKNOWN_ID"
  );
  assert.deepEqual(applyExclusions(points, ["a"]).map((p) => p.id), ["b"]);
});
