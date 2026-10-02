import { Rational } from './rational.ts';
import { LIMITS, type Die, type Rule, type RuleInput } from './types.ts';

let ruleSeq = 0;

function isInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x);
}

export function validateRule(input: RuleInput): Rule {
  if (!input || typeof input !== 'object') throw new Error('规则必须是对象');
  if (typeof input.name !== 'string' || !input.name.trim()) {
    throw new Error('规则名称不能为空');
  }
  if (!Array.isArray(input.dice) || input.dice.length === 0) {
    throw new Error('至少需要一个骰子（拒绝空骰子集）');
  }
  if (input.dice.length > LIMITS.MAX_DICE) {
    throw new Error(`骰子数超出限制：最多 ${LIMITS.MAX_DICE} 个，实际 ${input.dice.length}`);
  }
  if (!isInt(input.maxRerolls) || input.maxRerolls < 0 || input.maxRerolls > LIMITS.MAX_REROLLS) {
    throw new Error(`最大重掷轮数必须是 0..${LIMITS.MAX_REROLLS} 的整数`);
  }
  const payoff = input.payoff;
  if (!payoff || (payoff.kind !== 'sum' && payoff.kind !== 'threshold')) {
    throw new Error("收益类型必须是 'sum' 或 'threshold'");
  }
  if (payoff.kind === 'threshold' && (!isInt(payoff.threshold) || payoff.threshold <= 0)) {
    throw new Error('门槛值必须为正整数');
  }

  const seenIds = new Set<string>();
  let totalFaces = 0;
  const dice: Die[] = input.dice.map((d) => {
    if (!d || typeof d.id !== 'string' || !d.id.trim()) {
      throw new Error('每个骰子需要非空字符串 id');
    }
    if (seenIds.has(d.id)) throw new Error(`骰子 id 重复：${d.id}`);
    seenIds.add(d.id);
    if (!Array.isArray(d.faces) || d.faces.length === 0) {
      throw new Error(`骰子 ${d.id} 为空，拒绝空骰子`);
    }
    if (d.faces.length > LIMITS.MAX_FACES_PER_DIE) {
      throw new Error(`骰子 ${d.id} 面数超出限制：最多 ${LIMITS.MAX_FACES_PER_DIE}`);
    }
    totalFaces += d.faces.length;

    const faces = d.faces.map((f) => {
      if (!isInt(f.value)) throw new Error(`骰子 ${d.id} 存在非整数点数`);
      let weight: Rational;
      try {
        weight = Rational.of(BigInt(f.weight));
      } catch {
        throw new Error(`骰子 ${d.id} 权重无法解析为整数：${String(f.weight)}`);
      }
      if (weight.cmp(Rational.ZERO) <= 0) {
        throw new Error(`骰子 ${d.id} 存在非正权重（${f.weight}），拒绝`);
      }
      return { value: f.value, weight };
    });
    const totalWeight = faces.reduce((s, f) => s.add(f.weight), Rational.ZERO);
    return { id: d.id, faces, totalWeight };
  });

  if (totalFaces > LIMITS.MAX_TOTAL_FACES) {
    throw new Error(`总面数超出限制：最多 ${LIMITS.MAX_TOTAL_FACES}，实际 ${totalFaces}`);
  }

  const id = `rule_${Date.now().toString(36)}_${(ruleSeq++).toString(36)}`;
  return { id, name: input.name.trim(), dice, maxRerolls: input.maxRerolls, payoff };
}
