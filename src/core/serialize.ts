import { Rational } from './rational.ts';
import type { StateDecision } from './solver.ts';
import type { Rule } from './types.ts';

/** 将规则转成可 JSON 持久化的纯数据（权重保留整数字符串，精确不丢）。 */
export function ruleToJSON(rule: Rule) {
  return {
    id: rule.id,
    name: rule.name,
    maxRerolls: rule.maxRerolls,
    payoff: rule.payoff,
    dice: rule.dice.map((d) => ({
      id: d.id,
      totalWeight: d.totalWeight.toFraction(),
      faces: d.faces.map((f) => ({ value: f.value, weight: f.weight.toFraction() })),
    })),
  };
}

export function rationalToJSON(r: Rational) {
  return { num: r.num.toString(), den: r.den.toString(), fraction: r.toFraction(), decimal: r.toDecimal() };
}

export function decisionToJSON(d: StateDecision) {
  const cand = (c: StateDecision['chosen']) => ({
    action: c.action,
    rerollIds: c.rerollIds,
    value: rationalToJSON(c.value),
  });
  return {
    roundsLeft: d.roundsLeft,
    values: d.values,
    chosen: cand(d.chosen),
    candidates: d.candidates.map(cand),
  };
}
