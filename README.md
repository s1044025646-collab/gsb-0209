# 多面骰精确概率与有限轮重掷策略后端

仅后端（API + CLI）。使用 **TypeScript + Node.js + 内置 SQLite（`node:sqlite`）**，
所有概率与期望均以 **BigInt 有理数**精确计算，输出分数字符串与十进制近似；
不使用浮点近似、不使用 Monte Carlo 求最优解（抽样仅用于对照复核）。
不依赖 Docker、WSL、付费服务或任何外部在线 API。

## 环境要求

- Windows 本地 PowerShell
- Node.js **>= 22.5**（开发机实测 `v25.5.0`，需要内置 `node:sqlite` 与 `--experimental-strip-types`）

## 安装

```powershell
npm install
```

## 构建 / 测试 / 启动 / 演示

```powershell
npm run build     # tsc 全量类型检查（noEmit；运行时直接执行 TS 源码）
npm test          # node:test，14 个精确性/策略/持久化测试
npm run demo      # 端到端演示：精确分布、最优策略、决策依据、抽样对照、重启读取
npm start         # 启动 HTTP API（默认 http://localhost:8787）
```

可配置环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | HTTP 端口 |
| `DATA_DIR` | `./data` | 项目内数据目录（SQLite 与导出文件） |

## 公开规模限制

在 `src/core/types.ts` 定义并由 `/health` 与 `cli limits` 公开：

- 骰子数最多 `8`
- 单骰面数最多 `20`
- 总面数最多 `48`
- 最大重掷轮数 `0..4`
- 单次求解状态/分支节点预算 `5,000,000`

非法权重（<=0）、空骰子、重复骰子 id、超规模输入一律拒绝。
达到节点预算时状态置为 `budget_exceeded`，明确表示**未求得最优**，绝不把部分搜索当最优策略返回。

## 精确性方法

- `src/core/rational.ts`：BigInt 分子/分母不可变分数，构造约分，四则/比较/十进制近似。
- 独立骰子概率**相乘**得到联合分布；按总点数、收益做精确**聚合**（重复点数面按权重合并）。
- 收益：`sum`（最终总点数）或 `threshold`（达到门槛得 1，否则 0）。
- 有限时域最优策略采用 **Bellman 递推 + 记忆化**：
  状态为 `(剩余轮数, 每个骰子身份 -> 当前点数)`，保留骰子身份，不会因“总和相同”错误合并不同可选状态。
  每轮可 `stop`（立即结算）或 `reroll` 任意骰子子集；取所有候选动作期望的最大值。
- **确定性平局规则**（公开）：候选动作按固定顺序比较，先 `stop`，再按重掷子集掩码升序；
  仅当候选值**严格大于**当前最优才替换，因此平局时选择顺序最前者。
- `src/core/exhaustive.ts`：独立穷举核对器，枚举微型游戏的全部动作与后续结果，与求解器交叉验证。

## 理论核对结论（测试覆盖）

- 公平六面骰、最多重掷一次、最大化点数：初始投掷前最优期望 **`17/4` = 4.25**，
  观察到 **1/2/3 重掷、4/5/6 保留**。
- 联合分布概率和恒为 1；无策略 2d6 总点数期望 = 7；门槛 11 的 2d6 成功概率 = `1/12`。
- 求解器与独立穷举在多组微型游戏（含不同权重骰、门槛收益）上**完全一致**，且逐候选动作值一致。
- 骰子重命名不改变结果；轮数增加时最优值单调不下降；`maxRerolls=0` 时只能立即停止。
- “相同总和、不同身份点数 → 不同最优动作”有专门用例。

## CLI

```powershell
npm run cli -- limits
npm run cli -- import-rule --file examples/d6-once.json
npm run cli -- list-rules
npm run cli -- distribution --rule <id> --export
npm run cli -- solve --rule <id>
npm run cli -- list-strategies [--rule <id>]
npm run cli -- decide --strategy <sid> --rounds 1 --values '{"d1":3}'
npm run cli -- rollout --strategy <sid> --seed 7
npm run cli -- sample --strategy <sid> --seed 42 --trials 10000
npm run cli -- verify --rule <id>
npm run cli -- export-strategy --strategy <sid> --dir exports
```

`distribution --export` 与 `export-strategy` 同时写出 **JSON 与 CSV** 到 `DATA_DIR` 或 `--dir`。

## HTTP API

| 方法 路径 | 说明 |
| --- | --- |
| `GET /health` | 健康检查与公开限制 |
| `POST /rules` | 导入并校验规则 |
| `GET /rules` | 列出规则 |
| `GET /distribution?ruleId=` | 精确联合/总点数/收益分布与期望 |
| `POST /strategies` | 求最优策略并持久化（含计算配置快照） |
| `GET /strategies?ruleId=` | 列出策略与状态 |
| `POST /decide` | 查询指定 `(剩余轮数, 当前点数)` 的决策与各候选动作精确值 |
| `POST /rollout` | 固定种子按策略推演一次完整对局 |
| `POST /sample` | 固定种子多次抽样，样本均值对照精确期望 |
| `GET /verify?ruleId=` | 概率和、期望、求解器与独立穷举一致性核对 |

PowerShell 调用示例见 `scripts/http-smoke.ps1`（`powershell -ExecutionPolicy Bypass -File scripts/http-smoke.ps1`）。

## 规则 JSON 格式

```json
{
  "name": "fair-d6-one-reroll",
  "dice": [
    { "id": "d1", "faces": [ { "value": 1, "weight": 1 } ] }
  ],
  "maxRerolls": 1,
  "payoff": { "kind": "sum" }
}
```

- `weight` 为正整数权重；同一点数可出现多面，按权重合并。
- `payoff`：`{ "kind": "sum" }` 或 `{ "kind": "threshold", "threshold": 10 }`。

示例：`examples/d6-once.json`、`examples/weighted-threshold.json`。

## 持久化

SQLite 表 `rules` 与 `strategies`（见 `src/db/store.ts`）。
策略保存最优初始值、全部已求状态决策、评估节点数与**计算配置快照**；
进程重启后可从数据库重建规则与策略并继续查询（测试 `test/persistence.test.ts` 与演示第 5 步覆盖）。

## 目录

```
src/core/      有理数、校验、分布、Bellman 求解、穷举核对、抽样、引擎编排
src/db/        SQLite 存储
src/cli/       命令行
src/server.ts  HTTP API
test/          精确性/策略/持久化测试
examples/      规则样例
scripts/       演示与 HTTP 冒烟脚本
```

## 限制与假设

- 运行时依赖 Node 的类型剥离（`--experimental-strip-types`），无需打包器；`npm run build` 为严格类型检查。
- 为保证“精确 + 可穷举核对”，规模上限刻意较小；超大输入会在求解阶段触发预算并明确标记未求得最优。
- 抽样使用确定性 `mulberry32`，**仅用于对照**，不参与任何精确结论。
- 纯本地后端，不联网、不含任何在线游戏或赌博集成。
