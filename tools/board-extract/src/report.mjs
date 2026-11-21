// The two files a run leaves behind: a machine-readable manifest and a human report.
import fs from "node:fs";
import path from "node:path";

export function writeReports(outDir, manifest, model) {
  fs.writeFileSync(path.join(outDir, "run.json"), JSON.stringify(manifest, null, 1));

  const counts = Object.entries(model.counts_visible || {})
    .sort((a, b) => b[1] - a[1])
    .map(([type, n]) => `| ${type} | ${n} |`)
    .join("\n");
  const artifacts = Object.entries(manifest.artifacts)
    .map(([what, file]) => `- \`${file}\` — ${what}`)
    .join("\n");
  const times = Object.entries(manifest.durations_ms)
    .map(([step, ms]) => `- ${step}: ${ms} ms`)
    .join("\n");

  const md = `# 关卡复刻运行记录

- 运行时间：${manifest.ran_at}
- 游戏：${manifest.game}
- 关卡：${manifest.level}
- 截图：\`${manifest.shot}\`
- 配置：${manifest.config || "默认（羊了个羊 PC）"}

## 结果

| 项 | 值 |
|---|---|
| 检出牌数 | ${manifest.tiles} |
| 可点牌 | ${manifest.clickable} |
| 侧堆 | ${manifest.piles} |
| 层级判定 | ${manifest.layers ? `${manifest.layers.decided}/${manifest.layers.pairs} 对由描边判定，${manifest.layers.agreed} 与明暗一致` : "无（未提供截图）"} |
| 可点一致性 | ${manifest.checks ? `${manifest.checks.pickable}/${manifest.checks.total}，误放行 ${manifest.checks.wronglyPickable}、误挡 ${manifest.checks.wronglyBlocked}` : "—"} |
| 自动命名命中 | ${manifest.auto.matched}/${manifest.tiles}（平均置信度 ${manifest.auto.mean_confidence.toFixed(2)}） |
| 人工覆盖 | ${manifest.types_overridden} |

| 牌型 | 数量 |
|---|---|
${counts}

## 产物

${artifacts}

## 耗时

${times}
`;
  fs.writeFileSync(path.join(outDir, "run.md"), md);
}
