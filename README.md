# Theil–Sen 稳健直线趋势与残差定位后端

离线二维观测点 `(x, y)` 的**单变量直线**趋势估计服务：输入带唯一编号的数值点，输出对少量异常 `y` 值较稳健的直线 `y = a·x + b`、各观测残差、斜率与截距中位数来源。只做后端（HTTP API + CLI），无前端、无外部在线服务。

- 运行时：Node.js（建议 22.5+，已在 Node 25 验证）+ TypeScript
- 存储：SQLite（使用 Node 内置 `node:sqlite`，**无需安装原生模块、无需编译**）
- 零运行时 npm 依赖（TypeScript 与类型包仅为开发依赖）
- 不依赖 Docker、WSL、付费服务或外部在线 API

## 估计规则

1. 枚举所有 **x 互不相同**的无序点对 `i < j`，计算斜率 `(yj - yi) / (xj - xi)`。
2. 斜率 `a` = 全部有效成对斜率的**中位数**。
3. 对每个参与观测计算 `yi - a·xi`，截距 `b` = 这些值的**中位数**。
4. 偶数个值时，中位数为排序后中间两项的算术平均。
5. `x` 相同的点对无法定义斜率，**跳过并单独计数**（`skippedSameX`），不使用 `Infinity`。
6. 全部 `x` 相同，或参与分析的观测少于 2 个时，报告无法识别直线（错误码 `ALL_X_EQUAL` / `INSUFFICIENT_POINTS`），不输出伪造的直线。
7. 同坐标不同编号视为不同观测，按实际条数参与统计，**不去重**；编号重复则整次导入被拒绝。
8. 估计结果与输入顺序无关；报告中残差按绝对残差降序排列，便于定位，但**不会**把排序靠前的点判定为“错误数据”，也不会自动删除或平滑任何点。
9. 成对斜率相同时，按点对中两点的稳定输入顺序列出。

### 输出内容

- `slope`、`intercept`：直线参数
- `pairCount`：有效点对数；`skippedSameX`：跳过的同 x 点对数
- `slopeMedianSources`：决定斜率中位数的 1 个（奇数）或 2 个（偶数）点对及编号
- `interceptMedianSources`：决定截距中位数的观测编号（1 或 2 个）
- `residuals`：每个观测的 `y - (a·x + b)` 及绝对值，按绝对残差降序
- `medianAbsResidual`、`maxAbsResidual`：仅作描述的尺度量，**不是置信度、不是预测区间**
- `algorithmVersion`：算法版本标识（当前 `theil-sen-1.0.0`）

## 数值容差与尺度限制

- 只接受有限数值；`NaN`、`Infinity` 一律拒绝（`NON_FINITE_INPUT`）。
- 坐标绝对值上限 `1e150`（`SCALE_EXCEEDED`），避免相减/相除时溢出。
- 计算过程中若出现非有限斜率或截距，返回 `NON_FINITE_SLOPE` / `NON_FINITE_INTERCEPT` 明确诊断，**不会**删除坏值后继续宣称对全部输入完成估计。
- 点坐标使用 IEEE-754 双精度，普通量级（如 `1e6` 以内）残差核对误差约在 `1e-9` 量级；请不要把极大量级与极小量级坐标混在同一数据中。
- 点数上限 **200**，保留全部点对枚举（最坏约 19,900 对），刻意不使用次二次近似算法。

## 方法的实际限制

- Theil–Sen 只对**少量**异常值稳健；异常点接近或超过一半时中位数也会被带偏。
- 它只抵抗 `y` 方向异常；`x` 方向的异常值（高杠杆点）可能显著影响斜率。
- 它描述线性趋势，不识别曲线、分段变点，也不做因果推断或预测置信区间。
- 重复 `x` 很多时有效点对减少；全部同 `x` 时直线不可识别。

## 快速开始（Windows PowerShell）

```powershell
cd E:\GSB\0313\B
npm install
npm run build
npm test          # 构建并运行全部测试（node:test）
npm run demo      # 内置演示：异常稳健性、重复x、偶数中位数、排除对照
npm start         # 启动 HTTP API，默认自动选择空闲端口并打印地址
```

数据默认保存在项目内 `data/theil_sen.sqlite`。

## CLI 完整命令演示

```powershell
# 1) 内置演示（同时写入数据库）
npm run demo

# 2) 从文件导入（文件内容见 examples/points.json）
node dist/cli.js import examples/points.json 我的测量

# 3) 拟合（返回 datasetId / analysisId）
node dist/cli.js fit <datasetId>

# 4) 查看全部成对斜率（手工核对点对表）；加编号只看与该点相关的点对
node dist/cli.js pairs <analysisId>
node dist/cli.js pairs <analysisId> p4

# 5) 残差排序与完整报告
node dist/cli.js residuals <analysisId>
node dist/cli.js show <analysisId>

# 6) 排除指定编号创建对照分析（旧分析保留，不被覆盖）
node dist/cli.js compare <datasetId> p4

# 7) 历史与 JSON 导出
node dist/cli.js history
node dist/cli.js history <datasetId>
node dist/cli.js export <analysisId>
```

## HTTP API 演示

启动后（以下用 `$port` 表示打印出的实际端口）：

```powershell
$base = "http://127.0.0.1:$port"

# 导入
Invoke-RestMethod "$base/api/datasets" -Method Post -ContentType "application/json" `
  -Body '{"name":"demo","points":[{"id":"p0","x":0,"y":0},{"id":"p1","x":1,"y":1},{"id":"p2","x":2,"y":2},{"id":"p3","x":3,"y":3},{"id":"p4","x":4,"y":100}]}'

# 拟合（<datasetId> 用上一步返回的 id）
Invoke-RestMethod "$base/api/datasets/<datasetId>/analyses" -Method Post -ContentType "application/json" -Body '{}'

# 解释中位数 / 查点对 / 残差
Invoke-RestMethod "$base/api/analyses/<analysisId>"
Invoke-RestMethod "$base/api/analyses/<analysisId>/pairs"
Invoke-RestMethod "$base/api/analyses/<analysisId>/pairs?pointId=p4&limit=10"

# 排除点对照（不覆盖旧分析）
Invoke-RestMethod "$base/api/datasets/<datasetId>/analyses" -Method Post -ContentType "application/json" -Body '{"excludeIds":["p4"]}'

# 历史 / 导出
Invoke-RestMethod "$base/api/analyses"
Invoke-RestMethod "$base/api/datasets/<datasetId>/analyses"
Invoke-WebRequest "$base/api/analyses/<analysisId>/export" -OutFile result.json
```

### 路由一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| POST | `/api/datasets` | 导入点集（同名自动升版本，不覆盖） |
| GET | `/api/datasets` | 点集列表 |
| GET | `/api/datasets/:id` | 点集详情（含原始点与编号） |
| POST | `/api/datasets/:id/analyses` | 拟合/对照（body：`{"excludeIds":[...]}`，可空） |
| GET | `/api/datasets/:id/analyses` | 该点集的分析历史 |
| GET | `/api/analyses` | 全部分析历史 |
| GET | `/api/analyses/:id` | 完整分析报告快照 |
| GET | `/api/analyses/:id/pairs` | 成对斜率，支持 `pointId`、`limit` |
| GET | `/api/analyses/:id/export` | 下载完整 JSON 快照 |

## 错误码

| 错误码 | 含义 |
| --- | --- |
| `INVALID_JSON` / `INVALID_BODY` / `INVALID_POINT` | 请求体或点格式非法 |
| `INVALID_ID` / `DUPLICATE_ID` | 编号缺失/含空白/重复 |
| `INVALID_COORDINATE` / `NON_FINITE_INPUT` | 坐标不是有限数值 |
| `SCALE_EXCEEDED` | 坐标绝对值超过 `1e150` |
| `TOO_MANY_POINTS` / `EMPTY_POINTS` | 点数超过 200 或为空 |
| `UNKNOWN_ID` / `INVALID_EXCLUSIONS` | 排除清单含未知或重复编号 |
| `DATASET_NOT_FOUND` / `ANALYSIS_NOT_FOUND` | id 不存在 |
| `INSUFFICIENT_POINTS` | 参与观测不足 2 个 |
| `ALL_X_EQUAL` | 没有 x 互不相同的点对 |
| `NON_FINITE_SLOPE` / `NON_FINITE_INTERCEPT` | 计算结果非有限 |

拟合层面的失败（有效点不足、全相同 x、非有限结果）仍会保存为 `status=error` 的分析快照，但不会给出直线参数。

## 配置

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `THEILSEN_PORT` | `0` | `serve` 端口，`0` 表示由系统选择空闲端口；也可用 `--port` |
| `THEILSEN_DATA_DIR` | 项目内 `data/` | SQLite 与 CLI 导出文件目录 |

## 存储与快照

SQLite 两张表：`datasets`（点集 id、名称、版本、点数、原始点 JSON、算法版本、时间）与 `analyses`（分析 id、点集 id、排除清单、算法版本、状态、错误信息、完整结果快照、全部点对 JSON）。服务重启后，中位数来源、点对表与残差排序均可重新读取；更换排除清单总是创建**新**分析，不覆盖旧结果。

## 项目结构

```
src/
  types.ts        类型与常量（点数上限、算法版本）
  theilSen.ts     Theil-Sen 纯算法（点对枚举、中位数、残差）
  validation.ts   输入/排除清单校验
  db.ts           SQLite 存储与快照
  service.ts      编排：导入、拟合、对照、点对查询
  server.ts       HTTP API
  cli.ts          命令行入口
  demo.ts         内置演示
  test/           node:test 测试
examples/         演示导入文件
data/             运行后生成（SQLite、导出）
```
