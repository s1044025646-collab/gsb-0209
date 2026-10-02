/**
 * 端到端演示：不依赖 HTTP，直接走引擎 + SQLite，
 * 展示精确分布、最优策略、决策依据、抽样对照与重启读取。
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../src/db/store.ts';
import { validateRule } from '../src/core/validate.ts';
import {
  distribution,
  solve,
  exhaustiveCheck,
  ruleToJSON,
  policyToJSON,
  policyFromJSON,
  ruleFromJSON,
  sample,
  simulate,
  rationalToJSON,
} from '../src/core/engine.ts';
import { decisionToJSON } from '../src/core/serialize.ts';

const dataDir = join(process.cwd(), 'data');
mkdirSync(dataDir, { recursive: true });
const store = new Store(join(dataDir, 'demo.db'));

const line = (s: string) => console.log('\n=== ' + s + ' ===');

// 1) 公平六面骰，最多重掷一次，最大化点数
line('1. 公平 d6 / 1 次重掷 / 最大化点数');
const rule = validateRule({
  name: 'demo-d6',
  dice: [{ id: 'd1', faces: [1, 2, 3, 4, 5, 6].map((v) => ({ value: v, weight: 1 })) }],
  maxRerolls: 1,
  payoff: { kind: 'sum' },
});
store.insertRule({ id: rule.id, name: rule.name, payload: JSON.stringify(ruleToJSON(rule)), created_at: new Date().toISOString() });

const d = distribution(rule);
console.log('概率和 =', d.probabilityMassCheck.toFraction());
console.log('无策略期望 =', d.expectedPayoff.toFraction());

const solved = solve(rule);
console.log('求解状态 =', solved.status, ' 节点数 =', solved.nodes);
console.log('初始投掷前最优期望 =', solved.initialValue!.toFraction(), '≈', solved.initialValue!.toDecimal(6));
console.log('独立穷举核对 =', exhaustiveCheck(rule).toFraction());

const strategyId = 'demo_strategy_1';
store.insertStrategy({
  id: strategyId,
  rule_id: rule.id,
  status: 'optimal',
  initial_value: solved.initialValue!.toFraction(),
  nodes: solved.nodes,
  policy: JSON.stringify(policyToJSON(solved.policy!)),
  config_snapshot: JSON.stringify({ engine: 'bigint-rational-bellman', demo: true }),
  created_at: new Date().toISOString(),
});

// 2) 决策依据：点数 3 vs 4
line('2. 查询决策依据（各候选动作精确值）');
for (const v of [1, 3, 4, 6]) {
  const dec = solved.policy!.query(1, { d1: v });
  console.log(`点数 ${v}: 选择 ${dec.chosen.action}${dec.chosen.action === 'reroll' ? ' d1' : ''}`);
  for (const c of dec.candidates) {
    console.log(`   - ${c.action}${c.rerollIds.length ? ' ' + c.rerollIds.join('+') : ''}: ${c.value.toFraction()} ≈ ${c.value.toDecimal(4)}`);
  }
}

// 3) 固定种子抽样对照
line('3. 固定种子抽样复核（10000 次）');
const summary = sample(rule, solved.policy!, 20261002, 10000, solved.initialValue!);
console.log(JSON.stringify(summary, null, 2));

// 4) 单次按策略推演
line('4. 固定种子单次推演 (seed=7)');
console.log(JSON.stringify(simulate(rule, solved.policy!, 7), null, 2));

// 5) 重启后读取同一策略
line('5. 重启后从 SQLite 重建策略并查询');
const row = store.getStrategy(strategyId)!;
const restoredRule = ruleFromJSON(JSON.parse(store.getRule(rule.id)!.payload));
const restored = policyFromJSON(restoredRule, JSON.parse(row.policy!));
const afterRestart = restored.query(1, { d1: 2 });
console.log('重启后点数 2 的最优动作 =', afterRestart.chosen.action, ' 值 =', afterRestart.chosen.value.toFraction());

// 6) 不同权重骰 + 门槛收益
line('6. 权重骰 + 门槛收益');
const rule2 = validateRule({
  name: 'demo-weighted',
  dice: [
    { id: 'low', faces: [{ value: 1, weight: 1 }, { value: 2, weight: 1 }] },
    { id: 'high', faces: [{ value: 1, weight: 1 }, { value: 10, weight: 3 }] },
  ],
  maxRerolls: 1,
  payoff: { kind: 'threshold', threshold: 10 },
});
const s2 = solve(rule2);
console.log('门槛收益最优期望 =', rationalToJSON(s2.initialValue!));
const interesting = decisionToJSON(s2.policy!.query(1, { low: 2, high: 1 }));
console.log('状态 low=2,high=1（总和3）各动作:');
for (const c of interesting.candidates) console.log(`   - ${c.action} ${c.rerollIds.join('+')}: ${c.value.fraction}`);

store.close();
line('演示完成（数据库: data/demo.db）');
