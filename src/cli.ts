#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Store } from "./db";
import { Service } from "./service";
import { loadConfig } from "./config";
import { startServer } from "./server";
import { runDemo } from "./demo";
import { FitResult } from "./types";

function usage(): void {
  console.log(`Theil-Sen 稳健直线趋势后端 —— 命令行用法

  serve [--port <n>]              启动 HTTP API（默认自动选择空闲端口）
  demo                            运行内置演示数据集并打印结果（同时写入数据库）
  import <points.json> [名称]     从 JSON 文件导入点集，格式 {"points":[{"id":..,"x":..,"y":..}]}
  fit <datasetId> [排除编号...]   对已导入点集拟合；可跟若干编号作为排除清单
  show <analysisId>               查看某次分析的完整报告
  pairs <analysisId> [编号]       列出全部（或与某编号相关的）成对斜率
  residuals <analysisId>          查看残差排序
  compare <datasetId> id1 id2..   排除指定编号创建新的对照分析（旧分析保留）
  history [datasetId]             列出分析历史（可按点集过滤）
  export <analysisId> [out.json]  导出完整 JSON 快照（默认写入 data/export-*.json）
  help                            显示本帮助

环境变量：
  THEILSEN_DATA_DIR   数据目录（默认项目内 data/）
  THEILSEN_PORT       serve 端口（默认 0=自动空闲端口）
`);
}

function fmt(v: number | null): string {
  return v === null ? "null" : Number.isInteger(v) ? v.toString() : v.toFixed(6);
}

function printFit(result: FitResult): void {
  if (!result.ok) {
    console.log(`拟合失败 [${result.errorCode}] ${result.message}`);
    console.log(
      `  参与点数=${result.pointCount} 跳过同x点对=${result.skippedSameX}`
    );
    return;
  }
  console.log(`直线: y = ${fmt(result.slope)} * x + ${fmt(result.intercept)}`);
  console.log(
    `参与点数=${result.pointCount} 有效点对数=${result.pairCount} 跳过同x点对=${result.skippedSameX}`
  );
  console.log(
    `斜率中位数来源: ` +
      result.slopeMedianSources
        .map((s) => `[${s.index}] ${fmt(s.value)} (${s.idI},${s.idJ})`)
        .join("  ")
  );
  console.log(
    `截距中位数来源: ` +
      result.interceptMedianSources
        .map((s) => `[${s.index}] ${fmt(s.value)} (${s.idI})`)
        .join("  ")
  );
  console.log(
    `绝对残差中位数=${fmt(result.medianAbsResidual)} 最大绝对残差=${fmt(result.maxAbsResidual)}`
  );
  console.log("残差排序（|残差| 降序，仅作定位参考，不判定异常）:");
  for (const r of result.residuals) {
    console.log(
      `  ${r.id.padEnd(6)} x=${fmt(r.x)} y=${fmt(r.y)} 预测=${fmt(r.predicted)} 残差=${fmt(r.residual)} |e|=${fmt(r.absResidual)}`
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "help";
  const config = loadConfig();

  if (command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }

  if (command === "serve") {
    let port = config.port;
    const portIdx = args.indexOf("--port");
    if (portIdx !== -1) {
      port = Number(args[portIdx + 1]);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error("--port 需为 0-65535 的整数");
      }
    }
    const store = new Store(config.dbPath);
    const service = new Service(store);
    const { port: actual } = await startServer(service, port);
    console.log(`Theil-Sen API 已启动: http://127.0.0.1:${actual}`);
    console.log(`数据目录: ${config.dataDir}`);
    console.log("按 Ctrl+C 停止。");
    return;
  }

  if (command === "demo") {
    const store = new Store(config.dbPath);
    const service = new Service(store);
    await runDemo(service, (line) => console.log(line));
    store.close();
    return;
  }

  const store = new Store(config.dbPath);
  const service = new Service(store);

  try {
    if (command === "import") {
      const file = args[1];
      if (!file) throw new Error("用法: import <points.json> [名称]");
      const raw = JSON.parse(readFileSync(resolve(file), "utf-8"));
      const name =
        args[2] ?? (typeof raw.name === "string" ? raw.name : undefined);
      const dataset = service.importDataset(name, raw.points);
      console.log(`已导入点集 id=${dataset.id} 名称=${dataset.name} 版本=v${dataset.version} 点数=${dataset.point_count}`);
      return;
    }

    if (command === "fit") {
      const datasetId = args[1];
      if (!datasetId) throw new Error("用法: fit <datasetId> [排除编号...]");
      const { analysis } = service.runAnalysis(datasetId, args.slice(2));
      console.log(`分析 id=${analysis.id}`);
      printFit(analysis.result);
      return;
    }

    if (command === "show") {
      const id = args[1];
      if (!id) throw new Error("用法: show <analysisId>");
      const analysis = service.getAnalysis(id);
      console.log(
        `分析 id=${analysis.id} 点集=${analysis.dataset_id} 时间=${analysis.created_at} 算法=${analysis.algorithm_version} 排除=[${analysis.exclude_ids.join(",")}]`
      );
      printFit(analysis.result);
      return;
    }

    if (command === "pairs") {
      const id = args[1];
      if (!id) throw new Error("用法: pairs <analysisId> [编号]");
      const out = service.queryPairs(id, { pointId: args[2] });
      console.log(`有效点对共 ${out.totalPairs} 个（按斜率升序）:`);
      for (const p of out.pairs) {
        console.log(
          `  (${p.idI}, ${p.idJ})  (${p.xi},${p.yi})-(${p.xj},${p.yj})  斜率=${fmt(p.slope)}`
        );
      }
      return;
    }

    if (command === "residuals") {
      const id = args[1];
      if (!id) throw new Error("用法: residuals <analysisId>");
      printFit(service.getAnalysis(id).result);
      return;
    }

    if (command === "compare") {
      const datasetId = args[1];
      const ids = args.slice(2);
      if (!datasetId || ids.length === 0) {
        throw new Error("用法: compare <datasetId> <要排除的编号...>");
      }
      const { analysis } = service.runAnalysis(datasetId, ids);
      console.log(`已创建对照分析 id=${analysis.id}（旧分析未被覆盖）`);
      printFit(analysis.result);
      return;
    }

    if (command === "history") {
      const rows = args[1]
        ? service.listDatasetAnalyses(args[1])
        : service.listAllAnalyses();
      if (rows.length === 0) {
        console.log("（暂无分析记录）");
        return;
      }
      for (const r of rows) {
        console.log(
          `${r.id}  点集=${r.dataset_id}  ${r.created_at}  状态=${r.status}  排除=[${r.exclude_ids.join(",")}]${r.error_code ? `  错误=${r.error_code}` : ""}`
        );
      }
      return;
    }

    if (command === "export") {
      const id = args[1];
      if (!id) throw new Error("用法: export <analysisId> [out.json]");
      const analysis = service.getAnalysis(id);
      const payload = {
        analysis: {
          id: analysis.id,
          datasetId: analysis.dataset_id,
          createdAt: analysis.created_at,
          algorithmVersion: analysis.algorithm_version,
          excludeIds: analysis.exclude_ids,
          result: analysis.result,
          pairs: analysis.pairs,
        },
      };
      const out =
        args[2] ??
        resolve(config.dataDir, `export-${analysis.id}.json`);
      writeFileSync(resolve(out), JSON.stringify(payload, null, 2), "utf-8");
      console.log(`已导出到 ${resolve(out)}`);
      return;
    }

    console.error(`未知命令: ${command}`);
    usage();
    process.exitCode = 1;
  } catch (err) {
    if (err && typeof err === "object" && "errorCode" in err) {
      const e = err as { errorCode: string; message: string };
      console.error(`错误 [${e.errorCode}] ${e.message}`);
    } else {
      console.error(err instanceof Error ? err.message : String(err));
    }
    process.exitCode = 1;
  } finally {
    store.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
