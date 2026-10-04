import { Service } from "./service";

type Log = (line: string) => void;

/**
 * 内置演示：
 * A. 4 个完美直线点 + 1 个 y=100 的异常高值 -> 多数成对斜率仍为 1，a=1 b=0。
 * B. 含重复 x（同 x 点对被跳过并计数）且有效斜率个数为偶数 -> 中位数为中间两项平均。
 * C. 对 A 排除异常编号后创建对照分析（旧报告保留）。
 */
export async function runDemo(service: Service, log: Log): Promise<void> {
  log("=== 演示 A：异常 y 不改变多数斜率（Theil-Sen 稳健性）===");
  const pointsA = [
    { id: "p0", x: 0, y: 0 },
    { id: "p1", x: 1, y: 1 },
    { id: "p2", x: 2, y: 2 },
    { id: "p3", x: 3, y: 3 },
    { id: "p4", x: 4, y: 100 },
  ];
  const dsA = service.importDataset("演示A-单点异常", pointsA);
  log(`点集 id=${dsA.id} 共 ${dsA.point_count} 点（共 10 个点对）`);
  const { analysis: anA } = service.runAnalysis(dsA.id, []);
  log(`分析 id=${anA.id}`);
  log(
    `直线 y = ${anA.result.slope} x + ${anA.result.intercept}，` +
      `有效点对=${anA.result.pairCount}，跳过同x=${anA.result.skippedSameX}`
  );
  log("10 个成对斜率中至少 6 个等于 1（前四点两两组合），故斜率中位数=1，截距中位数=0。");
  const worst = anA.result.residuals[0];
  log(
    `绝对残差最大点：${worst.id} (x=${worst.x},y=${worst.y})，` +
      `残差=${worst.residual}；前四点残差均为 0。`
  );
  log(
    `绝对残差中位数=${anA.result.medianAbsResidual}，最大=${anA.result.maxAbsResidual}（描述量，不是置信度）`
  );

  log("");
  log("=== 演示 B：重复 x 被跳过 + 偶数个斜率取中间两项平均 ===");
  // (0,0),(0,5) 同 x 跳过；有效点对 5 个：需要偶数个，故再加一点。
  const pointsB = [
    { id: "q0", x: 0, y: 0 },
    { id: "q1", x: 0, y: 5 },
    { id: "q2", x: 1, y: 1 },
    { id: "q3", x: 2, y: 4 },
    { id: "q4", x: 4, y: 4 },
  ];
  // 总点对 10，同 x 1 对，有效 9（奇数）。调整 q4 让示例成对斜率更直观：
  // 改用 5 点保证偶数个不同 x 点对：同 x 占 1 对 => C(5,2)-1 = 9。
  // 为得到偶数有效点对，使用 6 点其中同 x 点对 2 个：C(6,2)-2=13 仍奇数；
  // 故增加第三个 x=0 点：同 x 点对 C(3,2)=3，15-3=12（偶数）。
  pointsB.push({ id: "q5", x: 0, y: -3 });
  const dsB = service.importDataset("演示B-重复x与偶数中位数", pointsB);
  const { analysis: anB } = service.runAnalysis(dsB.id, []);
  log(`点集 id=${dsB.id}`);
  log(
    `有效点对=${anB.result.pairCount}（12 个，偶数），跳过同x点对=${anB.result.skippedSameX}（x=0 的 3 点两两 3 对）`
  );
  log(
    `斜率中位数=${anB.result.slope}，来源=` +
      anB.result.slopeMedianSources
        .map((s) => `(${s.idI},${s.idJ})=${s.value}`)
        .join(" 与 ")
  );
  log(`截距中位数=${anB.result.intercept}`);

  log("");
  log("=== 演示 C：排除 p4 作对照（原始分析仍保留）===");
  const { analysis: anA2 } = service.runAnalysis(dsA.id, ["p4"]);
  log(
    `排除 p4 后：y = ${anA2.result.slope} x + ${anA2.result.intercept}，` +
      `参与点数=${anA2.result.pointCount}，新分析 id=${anA2.id}`
  );
  log(`原分析 ${anA.id} 未被覆盖，仍包含全部 5 个原始观测。`);
  log("");
  log("可用 `history`、`pairs <分析id>`、`export <分析id>` 查看点对表与导出 JSON。");
}
