import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before } from "node:test";
import { Store } from "../db";
import { Service } from "../service";
import { createApp } from "../server";
import { AddressInfo } from "node:net";
import { Server } from "node:http";

let dir: string;
let store: Store;
let service: Service;
let server: Server;
let baseUrl: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "theilsen-"));
  store = new Store(join(dir, "test.sqlite"));
  service = new Service(store);
  server = createApp(service);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

async function api(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<{ status: number; json: any }> {
  const res = await fetch(baseUrl + path, {
    method: init.method ?? "GET",
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, json };
}

test("端到端：导入 -> 拟合 -> 点对查询 -> 对照分析 -> 历史 -> 导出", async () => {
  const points = [
    { id: "p0", x: 0, y: 0 },
    { id: "p1", x: 1, y: 1 },
    { id: "p2", x: 2, y: 2 },
    { id: "p3", x: 3, y: 3 },
    { id: "p4", x: 4, y: 100 },
  ];

  const imp = await api("/api/datasets", {
    method: "POST",
    body: { name: "e2e", points },
  });
  assert.equal(imp.status, 201);
  const datasetId = imp.json.dataset.id;

  const fit = await api(`/api/datasets/${datasetId}/analyses`, {
    method: "POST",
    body: {},
  });
  assert.equal(fit.status, 201);
  const analysisId = fit.json.analysis.id;
  assert.equal(fit.json.analysis.result.slope, 1);
  assert.equal(fit.json.analysis.result.intercept, 0);

  const pairs = await api(`/api/analyses/${analysisId}/pairs`);
  assert.equal(pairs.status, 200);
  assert.equal(pairs.json.totalPairs, 10);

  const pairsFiltered = await api(
    `/api/analyses/${analysisId}/pairs?pointId=p4`
  );
  assert.equal(pairsFiltered.json.totalPairs, 4);

  const cmp = await api(`/api/datasets/${datasetId}/analyses`, {
    method: "POST",
    body: { excludeIds: ["p4"] },
  });
  assert.equal(cmp.status, 201);
  assert.notEqual(cmp.json.analysis.id, analysisId);
  assert.equal(cmp.json.analysis.result.pointCount, 4);

  const hist = await api(`/api/datasets/${datasetId}/analyses`);
  assert.equal(hist.json.analyses.length, 2);

  const exported = await api(`/api/analyses/${analysisId}/export`);
  assert.equal(exported.status, 200);
  assert.equal(exported.json.analysis.pairs.length, 10);
});

test("错误码：未知编号 404、重复 id 409、非法坐标 400、全相同 x 保存错误快照", async () => {
  let r = await api("/api/datasets", {
    method: "POST",
    body: {
      points: [
        { id: "a", x: 0, y: 0 },
        { id: "a", x: 1, y: 1 },
      ],
    },
  });
  assert.equal(r.status, 409);
  assert.equal(r.json.errorCode, "DUPLICATE_ID");

  r = await api("/api/datasets", {
    method: "POST",
    body: { points: [{ id: "a", x: 0, y: "oops" }] },
  });
  assert.equal(r.status, 400);
  assert.equal(r.json.errorCode, "INVALID_COORDINATE");

  const imp = await api("/api/datasets", {
    method: "POST",
    body: {
      points: [
        { id: "a", x: 1, y: 0 },
        { id: "b", x: 1, y: 5 },
      ],
    },
  });
  const datasetId = imp.json.dataset.id;

  r = await api(`/api/datasets/${datasetId}/analyses`, {
    method: "POST",
    body: { excludeIds: ["ghost"] },
  });
  assert.equal(r.status, 404);
  assert.equal(r.json.errorCode, "UNKNOWN_ID");

  r = await api(`/api/datasets/nonexistent/analyses`, {
    method: "POST",
    body: {},
  });
  assert.equal(r.status, 404);
  assert.equal(r.json.errorCode, "DATASET_NOT_FOUND");

  // 全相同 x：HTTP 层仍然 201 创建分析，结果内 status=error。
  r = await api(`/api/datasets/${datasetId}/analyses`, {
    method: "POST",
    body: {},
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.analysis.result.ok, false);
  assert.equal(r.json.analysis.result.errorCode, "ALL_X_EQUAL");
  assert.equal(r.json.analysis.result.skippedSameX, 1);
});

test("持久化：重新打开数据库后分析快照与残差排序可读，且排除对照不覆盖旧结果", async () => {
  const points = [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 1, y: 1 },
    { id: "c", x: 2, y: 9 },
  ];
  const ds = service.importDataset("persist", points);
  const a1 = service.runAnalysis(ds.id, []).analysis;
  const a2 = service.runAnalysis(ds.id, ["c"]).analysis;

  const reopenedStore = new Store(join(dir, "test.sqlite"));
  const reopened = new Service(reopenedStore);
  const got1 = reopened.getAnalysis(a1.id);
  assert.equal(got1.result.pointCount, 3);
  assert.equal(got1.result.residuals.length, 3);
  // 残差按绝对残差降序
  const abs = got1.result.residuals.map((x) => x.absResidual);
  assert.deepEqual(abs, [...abs].sort((u, v) => v - u));
  const got2 = reopened.getAnalysis(a2.id);
  assert.deepEqual(got2.exclude_ids, ["c"]);
  assert.equal(got2.result.pointCount, 2);
  reopenedStore.close();
});
