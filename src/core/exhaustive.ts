import { Rational } from './rational.ts';
import { dieValueDistribution } from './distribution.ts';
import type { Rule } from './types.ts';
import type { Candidate } from './solver.ts';

/**
 * 独立穷举核对：不使用求解器的记忆化结果，直接递归枚举
 * “所有动作 × 重掷后的所有后续点数”，对叶子收益按精确概率求平均。
 * 仅用于微型游戏交叉验证。
 */
export function exhaustiveValue(
  rule: Rule,
  rounds: number,
  values: number[],
): { value: Rational; candidates: Candidate[] } {
  const n = rule.dice.length;
  const payoff = (v: number[]): Rational => {
    const sum = v.reduce((a, b) => a + b, 0);
    const p = rule.payoff;
    return Rational.of(p.kind === 'sum' ? sum : sum >= p.threshold ? 1 : 0);
  };

  const candidate = (mask: number): Rational => {
    const positions: number[] = [];
    for (let i = 0; i < n; i++) if ((mask >> i) & 1) positions.push(i);
    let total = Rational.ZERO;
    const next = [...values];
    const rec = (k: number, prob: Rational): void => {
      if (k === positions.length) {
        total = total.add(prob.mul(rounds <= 1 ? payoff(next) : exhaustiveValue(rule, rounds - 1, next).value));
        return;
      }
      const pos = positions[k];
      for (const [value, pr] of dieValueDistribution(rule.dice[pos])) {
        next[pos] = value;
        rec(k + 1, prob.mul(pr));
      }
    };
    rec(0, Rational.ONE);
    return total;
  };

  const candidates: Candidate[] = [
    { action: 'stop', rerollIds: [], value: payoff(values) },
  ];
  if (rounds > 0) {
    for (let mask = 1; mask < 1 << n; mask++) {
      candidates.push({
        action: 'reroll',
        rerollIds: rule.dice.filter((_, i) => (mask >> i) & 1).map((d) => d.id),
        value: candidate(mask),
      });
    }
  }
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) if (candidates[i].value.cmp(best.value) > 0) best = candidates[i];
  return { value: best.value, candidates };
}

/** 首次投掷前的穷举最优期望：全掷一次进入 rounds=maxRerolls。 */
export function exhaustiveInitial(rule: Rule): Rational {
  const n = rule.dice.length;
  let total = Rational.ZERO;
  const values = new Array(n).fill(0);
  const rec = (i: number, prob: Rational): void => {
    if (i === n) {
      total = total.add(prob.mul(exhaustiveValue(rule, rule.maxRerolls, values).value));
      return;
    }
    for (const [value, p] of dieValueDistribution(rule.dice[i])) {
      values[i] = value;
      rec(i + 1, prob.mul(p));
    }
  };
  rec(0, Rational.ONE);
  return total;
}
