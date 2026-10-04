import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { Service, NotFoundError, ValidationError } from "./service";

interface HttpError {
  errorCode: string;
  message: string;
  status: number;
}

function mapError(err: unknown): HttpError {
  if (err instanceof ValidationError) {
    const statusMap: Record<string, number> = {
      EMPTY_POINTS: 400,
      TOO_MANY_POINTS: 400,
      INVALID_BODY: 400,
      INVALID_POINT: 400,
      INVALID_ID: 400,
      DUPLICATE_ID: 409,
      INVALID_COORDINATE: 400,
      NON_FINITE_INPUT: 400,
      SCALE_EXCEEDED: 400,
      INVALID_EXCLUSIONS: 400,
      UNKNOWN_ID: 404,
    };
    return {
      errorCode: err.errorCode,
      message: err.message,
      status: statusMap[err.errorCode] ?? 400,
    };
  }
  if (err instanceof NotFoundError) {
    return { errorCode: err.errorCode, message: err.message, status: 404 };
  }
  const message = err instanceof Error ? err.message : "未知内部错误";
  return { errorCode: "INTERNAL_ERROR", message, status: 500 };
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(body);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) {
        reject(new ValidationError("BODY_TOO_LARGE", "请求体超过 5MB 上限"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch {
        reject(new ValidationError("INVALID_JSON", "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function createApp(service: Service): Server {
  const server = createServer(async (req, res) => {
    try {
      await route(req, res, service);
    } catch (err) {
      const e = mapError(err);
      sendJson(res, e.status, { errorCode: e.errorCode, message: e.message });
    }
  });
  return server;
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  service: Service
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";

  if (method === "GET" && path === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (method === "POST" && path === "/api/datasets") {
    const body = (await readJson(req)) as Record<string, unknown>;
    const dataset = service.importDataset(body.name as string | undefined, body.points);
    sendJson(res, 201, { dataset });
    return;
  }

  if (method === "GET" && path === "/api/datasets") {
    sendJson(res, 200, { datasets: service.listDatasets() });
    return;
  }

  let m = path.match(/^\/api\/datasets\/([^/]+)$/);
  if (method === "GET" && m) {
    sendJson(res, 200, { dataset: service.getDataset(m[1]) });
    return;
  }

  m = path.match(/^\/api\/datasets\/([^/]+)\/analyses$/);
  if (method === "POST" && m) {
    const body = (await readJson(req)) as Record<string, unknown>;
    const { analysis } = service.runAnalysis(m[1], body.excludeIds);
    sendJson(res, 201, {
      analysis: {
        id: analysis.id,
        datasetId: analysis.dataset_id,
        createdAt: analysis.created_at,
        algorithmVersion: analysis.algorithm_version,
        excludeIds: analysis.exclude_ids,
        result: analysis.result,
      },
    });
    return;
  }
  if (method === "GET" && m) {
    sendJson(res, 200, { analyses: service.listDatasetAnalyses(m[1]) });
    return;
  }

  if (method === "GET" && path === "/api/analyses") {
    sendJson(res, 200, { analyses: service.listAllAnalyses() });
    return;
  }

  m = path.match(/^\/api\/analyses\/([^/]+)$/);
  if (method === "GET" && m) {
    const analysis = service.getAnalysis(m[1]);
    sendJson(res, 200, {
      analysis: {
        id: analysis.id,
        datasetId: analysis.dataset_id,
        createdAt: analysis.created_at,
        algorithmVersion: analysis.algorithm_version,
        excludeIds: analysis.exclude_ids,
        result: analysis.result,
      },
    });
    return;
  }

  m = path.match(/^\/api\/analyses\/([^/]+)\/pairs$/);
  if (method === "GET" && m) {
    const pointId = url.searchParams.get("pointId") ?? undefined;
    const limitRaw = url.searchParams.get("limit");
    let limit: number | undefined;
    if (limitRaw !== null) {
      limit = Number(limitRaw);
      if (!Number.isInteger(limit) || limit < 0) {
        throw new ValidationError(
          "INVALID_QUERY",
          "limit 必须是非负整数",
          "limit"
        );
      }
    }
    sendJson(res, 200, service.queryPairs(m[1], { pointId, limit }));
    return;
  }

  m = path.match(/^\/api\/analyses\/([^/]+)\/export$/);
  if (method === "GET" && m) {
    const analysis = service.getAnalysis(m[1]);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="analysis-${analysis.id}.json"`,
    });
    res.end(
      JSON.stringify(
        {
          analysis: {
            id: analysis.id,
            datasetId: analysis.dataset_id,
            createdAt: analysis.created_at,
            algorithmVersion: analysis.algorithm_version,
            excludeIds: analysis.exclude_ids,
            result: analysis.result,
            pairs: analysis.pairs,
          },
        },
        null,
        2
      )
    );
    return;
  }

  sendJson(res, 404, { errorCode: "ROUTE_NOT_FOUND", message: `未知路径：${method} ${path}` });
}

/** 启动服务；port 为 0 或未指定时由系统分配空闲端口。 */
export function startServer(
  service: Service,
  port: number
): Promise<{ server: Server; port: number }> {
  const server = createApp(service);
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({ server, port: address.port });
    });
  });
}
