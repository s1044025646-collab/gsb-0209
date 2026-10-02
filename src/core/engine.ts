import { Rational } from './rational.ts';
import { validateRule } from './validate.ts';
import { exactDistribution, type DistributionResult } from './distribution.ts';
import {
  BudgetExceededError,
  StrategyPolicy,
  StrategySolver,
  type StateDecision,
} from './solver.ts';
import { decisionToJSON, rationalToJSON, ruleToJSON } from './serialize.ts';
import { exhaustiveInitial } from './exhaustive.ts';
import { rollout, sampleTrials, mulberry32, type SampleSummary } from './sampling.ts';
import type { Rule, RuleInput } from './types.ts';

function parseFraction(s: string): Rational {
  const [n, d] = s.split('/');
  return Rational.of(BigInt(n), d === undefined ? 1n : BigInt(d));
}

/** 从持久化 JSON 重建 Rule（权重为分数字符串，精确还原）。 */
export function ruleFromJSON(json: ReturnType<typeof ruleToJSON>): Rule {
  const input: RuleInput = {
    name: json.name,
    maxRerolls: json.maxRerolls,
    payoff: json.payoff as RuleInput['payoff'],
    dice: json.dice.map((d) => ({
      id: d.id,
      faces: d.faces.map((f) => ({
        value: f.value,
        weight: f.weight.includes('/') ? f.weight : f.weight,
      })),
    })),
  };
  const rule = validateRule(input);
  return { ...rule, id: json.id };
}

export interface SolveOutcome {
  status: 'optimal' | 'budget_exceeded';
  initialValue: Rational | null;
  policy: StrategyPolicy | null;
  nodes: number;
  error?: string;
}

export function solve(rule: Rule): SolveOutcome {
  const solver = new StrategySolver(rule);
  try {
    const res = solver.solveInitial();
    return { status: 'optimal', initialValue: res.value, policy: res.policy, nodes: res.nodes };
  } catch (e) {
    if (e instanceof BudgetExceededError) {
      return { status: 'budget_exceeded', initialValue: null, policy: null, nodes: e.nodes, error: e.message };
    }
    throw e;
  }
}

export function distribution(rule: Rule): DistributionResult {
  return exactDistribution(rule);
}

export function exhaustiveCheck(rule: Rule): Rational {
  return exhaustiveInitial(rule);
}

export function policyToJSON(policy: StrategyPolicy) {
  const out: Record<string, unknown> = {};
  for (const d of policy.allDecisions()) {
    const key = `${d.roundsLeft}:${policy.dieIds.map((id) => d.values[id]).join(',')}`;
    out[key] = decisionToJSON(d);
  }
  return { dieIds: policy.dieIds, states: out };
}

/** 重启后从持久化 JSON 重建可查询策略。 */
export function policyFromJSON(rule: Rule, json: { dieIds: string[]; states: Record<string, unknown> }): StrategyPolicy {
  const cache = new Map();
  for (const [key, raw] of Object.entries(json.states)) {
    const d = raw as ReturnType<typeof decisionToJSON>;
    const value = parseFraction(d.chosen.value.fraction);
    const candidates = d.candidates.map((c) => ({
      action: c.action as 'stop' | 'reroll',
      rerollIds: c.rerollIds,
      value: parseFraction(c.value.fraction),
    }));
    const chosen = candidates.find((c) => c.action === d.chosen.action && c.rerollIds.join() === d.chosen.rerollIds.join())!;
    cache.set(key, {
      value,
      decision: { roundsLeft: d.roundsLeft, values: d.values, chosen, candidates },
    });
  }
  return new StrategyPolicy(rule, cache, json.dieIds);
}

export function decide(rule: Rule, policy: StrategyPolicy, roundsLeft: number, values: Record<string, number>): StateDecision {
  return policy.query(roundsLeft, values);
}

export function simulate(rule: Rule, policy: StrategyPolicy, seed: number) {
  return rollout(rule, policy, mulberry32(seed));
}

export function sample(rule: Rule, policy: StrategyPolicy, seed: number, trials: number, exact: Rational): SampleSummary {
  return sampleTrials(rule, policy, seed, trials, exact);
}

export { rationalToJSON, ruleToJSON };
