import { resolve } from "node:path";

export interface Config {
  dataDir: string;
  dbPath: string;
  port: number;
}

/**
 * 默认数据目录：项目内 data/（相对 dist/ 上两级即项目根）。
 * 可用环境变量 THEILSEN_DATA_DIR / THEILSEN_PORT 覆盖。
 */
export function loadConfig(): Config {
  const projectRoot = resolve(__dirname, "..");
  const dataDir = resolve(
    process.env.THEILSEN_DATA_DIR ?? resolve(projectRoot, "data")
  );
  const dbPath = resolve(dataDir, "theil_sen.sqlite");

  let port = 0; // 0 = 让操作系统选择空闲端口
  if (process.env.THEILSEN_PORT) {
    const parsed = Number(process.env.THEILSEN_PORT);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
      throw new Error(
        `THEILSEN_PORT 非法：${process.env.THEILSEN_PORT}（需 0-65535 的整数，0 表示自动选择空闲端口）`
      );
    }
    port = parsed;
  }
  return { dataDir, dbPath, port };
}
