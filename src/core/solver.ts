import { Rational } from './rational.ts';
import { dieValueDistribution } from './distribution.ts';
import { LIMITS, type PayoffSpec, type Rule } from './types.ts';

/** 达到预算时抛出，调用方必须把结果标记为“未求得最优”，不得当作最优策略。 */
export class BudgetExceededError extends Error {
 readonly nodes: number;
  constructor(nodes: number) {
    super(`达到计算预算 ${LIMITS.MAX_SOLVE_NODES}，未求得最优策略（非最优结果）`);
    this.name = 'BudgetExceededError';
    this.nodes = nodes;
  }
}

export interface Candidate {
  /** 'stop' 或 'reroll'；reroll 时给出重掷骰子 id 列表。 */
  action: 'stop' | 'reroll';
  rerollIds: string[];
  value: Rational;
}

export interface StateDecision {
  roundsLeft: number;
  values: Record<string, number>;
  chosen: Candidate;
  candidates: Candidate[];
}

interface Cached {
  value: Rational;
  decision: StateDecision;
}

const keyOf = (rounds: number, values: number[]): string =>
  `${rounds}:${values.join(',')}`;

export class StrategySolver {
  private cache = new Map<string, Cached>();
  private nodes = 0;
  private perDie: { id: string; entries: [number, Rational][] }[];
  private n: number;
  private rule: Rule;

  constructor(rule: Rule) {
    this.rule = rule;
    this.perDie = rule.dice.map((d) => ({
      id: d.id,
      entries: [...dieValueDistribution(d)],
    }));
    this.n = rule.dice.length;
  }

  private payoff(values: number[]): Rational {
    const sum = values.reduce((a, b) => a + b, 0);
    const p: PayoffSpec = this.rule.payoff;
    if (p.kind === 'sum') return Rational.of(sum);
    return Rational.of(sum >= p.threshold ? 1 : 0);
  }

  private tick() {
    if (++this.nodes > LIMITS.MAX_SOLVE_NODES) throw new BudgetExceededError(this.nodes);
  }

  /** 若 S 中骰子重掷后得到 next，返回 V(rounds-1, next)。 */
  private rerollExpectation(rounds: number, values: number[], mask: number): Rational {
    const positions: number[] = [];
    for (let i = 0; i < this.n; i++) if ((mask >> i) & 1) positions.push(i);

    let total = Rational.ZERO;
    const next = [...values];
    const rec = (k: number, prob: Rational) => {
      if (k === positions.length) {
        total = total.add(prob.mul(this.solveState(rounds - 1, next).value));
        return;
      }
      const pos = positions[k];
      for (const [value, p] of this.perDie[pos].entries) {
        next[pos] = value;
        rec(k + 1, prob.mul(p));
      }
    };
    rec(0, Rational.ONE);
    return total;
  }

  solveState(rounds: number, values: number[]): Cached {
    const key = keyOf(rounds, values);
    const hit = this.cache.get(key);
    if (hit) return hit;
    this.tick();

    const idsFromMask = (mask: number) =>
      this.perDie.filter((_, i) => (mask >> i) & 1).map((x) => x.id);

    // 候选动作确定性顺序：先 stop（平局优先级最高），
    // 再按掩码升枚举重掷子集（掩码小者平局优先）。
    const candidates: Candidate[] = [
      { action: 'stop', rerollIds: [], value: this.payoff(values) },
    ];
    if (rounds > 0) {
      for (let mask = 1; mask < 1 << this.n; mask++) {
        candidates.push({
          action: 'reroll',
          rerollIds: idsFromMask(mask),
          value: this.rerollExpectation(rounds, values, mask),
        });
      }
    }

    let chosen = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      if (candidates[i].value.cmp(chosen.value) > 0) chosen = candidates[i];
    }

    const record: Record<string, number> = {};
    this.perDie.forEach((d, i) => (record[d.id] = values[i]));
    const decision: StateDecision = {
      roundsLeft: rounds,
      values: record,
      chosen,
      candidates,
    };
    const cached: Cached = { value: chosen.value, decision };
    this.cache.set(key, cached);
    return cached;
  }

 /**
   * 求解初始（首次投掷前）最优期望。
   * 初始时所有骰子尚未掷出，等价于对“全部重掷”这一动作取期望，
   * 其后续允许在 maxRerolls 轮内决策。
   */
  solveInitial(): { value: Rational; policy: StrategyPolicy; nodes: number } {
    const initial = this.rerollExpectation(this.rule.maxRerolls + 1, new Array(this.n).fill(0), (1 << this.n) - 1);
    return {
      value: initial,
      policy: new StrategyPolicy(this.rule, this.cache, this.perDie.map((d) => d.id)),
      nodes: this.nodes,
    };
  }
}

/** 只读策略视图：按 (剩余轮数, 当前点数) 查询决策。 */
export class StrategyPolicy {
  constructor(
    rule: Rule,
    cache: Map<string, Cached>,
    dieIds: string[],
  ) {
    this.rule = rule;
    this.dieIds = dieIds;
    this.cache = cache;
  }

  private cache: Map<string, Cached>;
  readonly rule: Rule;
  readonly dieIds: string[];

  get nodesStored(): number {
    return this.cache.size;
  }

  query(roundsLeft: number, values: Record<string, number>): StateDecision {
    if (roundsLeft < 0 || roundsLeft > this.rule.maxRerolls) {
      throw new Error(`剩余轮数须在 0..${this.rule.maxRerolls}`);
    }
    const vec = this.dieIds.map((id) => {
      const v = values[id];
      if (!Number.isInteger(v)) throw new Error(`缺少骰子 ${id} 的当前点数`);
      return v;
    });
    const c = this.cache.get(keyOf(roundsLeft, vec));
    if (!c) throw new Error('该状态不在已求解策略覆盖范围内');
    return c.decision;
  }

  *allDecisions(): IterableIterator<StateDecision> {
    for (const c of this.cache.values()) yield c.decision;
  }
}
