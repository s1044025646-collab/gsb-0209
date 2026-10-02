import { Rational } from './rational.ts';
import type { Die, PayoffSpec, Rule } from './types.ts';

export interface Outcome {
  /** 以骰子 id -> 点数 记录联合结果，保留骰子身份。 */
  faces: Record<string, number>;
  probability: Rational;
}

export interface DistributionResult {
  /** 全联合分布（笛卡尔积，重复点数不合并，因为身份不同）。 */
  joint: Outcome[];
  /** 总点数 -> 概率；相同总点数在此聚合。 */
  sum: { value: number; probability: Rational }[];
  /** 收益 -> 概率（门槛型只含 0 / 1）。 */
  payoff: { value: number; probability: Rational }[];
  expectedPayoff: Rational;
  probabilityMassCheck: Rational;
}

/** 单个骰子按“点数”合并权重后的条件概率表。 */
export function dieValueDistribution(die: Die): Map<number, Rational> {
  const agg = new Map<number, Rational>();
  for (const f of die.faces) {
    const p = f.weight.div(die.totalWeight);
    agg.set(f.value, (agg.get(f.value) ?? Rational.ZERO).add(p));
  }
  return agg;
}

function payoffOf(sum: number, payoff: PayoffSpec): number {
  return payoff.kind === 'sum' ? sum : sum >= payoff.threshold ? 1 : 0;
}

/**
 * 一次投掷的精确联合分布：独立骰子概率相乘，
 * 随后按总点数与收益做精确聚合。
 */
export function exactDistribution(rule: Rule): DistributionResult {
  const perDie = rule.dice.map((d) => ({ die: d, dist: [...dieValueDistribution(d)] }));

  const joint: Outcome[] = [];
  const sumAgg = new Map<number, Rational>();
  const payAgg = new Map<number, Rational>();

  const rec = (idx: number, faces: Record<string, number>, prob: Rational, sum: number) => {
    if (idx === perDie.length) {
      joint.push({ faces: { ...faces }, probability: prob });
      sumAgg.set(sum, (sumAgg.get(sum) ?? Rational.ZERO).add(prob));
      const po = payoffOf(sum, rule.payoff);
      payAgg.set(po, (payAgg.get(po) ?? Rational.ZERO).add(prob));
      return;
    }
    const { die, dist } = perDie[idx];
    for (const [value, p] of dist) {
      faces[die.id] = value;
      rec(idx + 1, faces, prob.mul(p), sum + value);
    }
  };
  rec(0, {}, Rational.ONE, 0);

  const sum = [...sumAgg.entries()]
    .map(([value, probability]) => ({ value, probability }))
    .sort((a, b) => a.value - b.value);
  const payoff = [...payAgg.entries()]
    .map(([value, probability]) => ({ value, probability }))
    .sort((a, b) => a.value - b.value);

  const expectedPayoff = payoff.reduce(
    (e, x) => e.add(x.probability.mul(Rational.of(x.value))),
    Rational.ZERO,
  );
  const probabilityMassCheck = sum.reduce(
    (s, x) => s.add(x.probability),
    Rational.ZERO,
  );

  return { joint, sum, payoff, expectedPayoff, probabilityMassCheck };
}
