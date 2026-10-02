import type { Rational } from './rational.ts';

/** 单面：数值与权重。权重以非负整数分子/分母给出，必须为正。 */
export interface FaceInput {
  value: number;
  weight: number | string;
}

export interface DieInput {
  id: string;
  faces: FaceInput[];
}

/** 收益：按最终总点数；或门槛型（达到 threshold 得 1，否则 0）。 */
export type PayoffSpec =
  | { kind: 'sum' }
  | { kind: 'threshold'; threshold: number };

export interface RuleInput {
  name: string;
  dice: DieInput[];
  maxRerolls: number;
  payoff: PayoffSpec;
}

/** 校验后的内部表示。 */
export interface Face {
  value: number;
  weight: Rational;
}

export interface Die {
  id: string;
  faces: Face[];
  totalWeight: Rational;
}

export interface Rule {
  id: string;
  name: string;
  dice: Die[];
  maxRerolls: number;
  payoff: PayoffSpec;
}

/** 公开的规模限制。 */
export const LIMITS = {
  MAX_DICE: 8,
  MAX_FACES_PER_DIE: 20,
  MAX_TOTAL_FACES: 48,
  MAX_REROLLS: 4,
  /** 单次求解允许评估的状态/分支节点预算（防止组合爆炸）。 */
  MAX_SOLVE_NODES: 5_000_000,
} as const;
