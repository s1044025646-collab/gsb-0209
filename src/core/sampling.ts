import { Rational } from './rational.ts';
import { dieValueDistribution } from './distribution.ts';
import type { Rule } from './types.ts';
import type { StrategyPolicy } from './solver.ts';

/**
 * 确定性 PRNG（mulberry32）。仅用于抽样复核，不参与精确求解。
 * 同一种子产生完全相同序列，可重复对照。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleDie(rng: () => number, rule: Rule, dieIdx: number): number {
  const die = rule.dice[dieIdx];
  const entries = [...dieValueDistribution(die)];
  // 权重以整数计数抽样，避免浮点比较偏差影响可复现性的解释。
  const total = die.totalWeight;
  const r = rng();
  let acc = Rational.ZERO;
  for (const [value, p] of entries) {
    acc = acc.add(p);
    if (r < Number(acc.num) / Number(acc.den) || r === 1 && value === entries[entries.length - 1][0]) {
      return value;
    }
    void total;
  }
  return entries[entries.length - 1][0];
}

export interface RolloutStep {
  roundsLeft: number;
  values: Record<string, number>;
  action: 'stop' | 'reroll' | 'initial';
  rerollIds: string[];
}

export interface RolloutResult {
  steps: RolloutStep[];
  finalValues: Record<string, number>;
  payoff: number;
}

/** 按已求最优策略推演一次完整对局（固定种子）。 */
export function rollout(rule: Rule, policy: StrategyPolicy, rng: () => number): RolloutResult {
  const ids = rule.dice.map((d) => d.id);
  const values: Record<string, number> = {};
  ids.forEach((id, i) => (values[id] = sampleDie(rng, rule, i)));
  const steps: RolloutStep[] = [
    { roundsLeft: rule.maxRerolls, values: { ...values }, action: 'initial', rerollIds: [] },
  ];

  let rounds = rule.maxRerolls;
  while (rounds >= 0) {
    const decision = policy.query(rounds, values);
    steps.push({
      roundsLeft: rounds,
      values: { ...values },
      action: decision.chosen.action,
      rerollIds: [...decision.chosen.rerollIds],
    });
    if (decision.chosen.action === 'stop' || rounds === 0) break;
    for (const id of decision.chosen.rerollIds) {
      values[id] = sampleDie(rng, rule, ids.indexOf(id));
    }
    rounds -= 1;
  }

  const sum = ids.reduce((s, id) => s + values[id], 0);
  const payoff =
    rule.payoff.kind === 'sum' ? sum : sum >= rule.payoff.threshold ? 1 : 0;
  return { steps, finalValues: { ...values }, payoff };
}

export interface SampleSummary {
  trials: number;
  sampleMean: string;
  exactExpected: { fraction: string; decimal: string };
}

/** 固定种子多次抽样，返回样本均值（十进制）与精确期望对照。 */
export function sampleTrials(
  rule: Rule,
  policy: StrategyPolicy,
  seed: number,
  trials: number,
  exactExpected: Rational,
): SampleSummary {
  const rng = mulberry32(seed);
  let sum = 0;
  for (let i = 0; i < trials; i++) sum += rollout(rule, policy, rng).payoff;
  return {
    trials,
    sampleMean: (sum / trials).toFixed(6),
    exactExpected: exactExpected.toJSON(),
  };
}
