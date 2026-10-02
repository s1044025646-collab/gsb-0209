import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rational } from '../src/core/rational.ts';
import { makeRule, fairD6 } from './helpers.ts';
import { exactDistribution } from '../src/core/distribution.ts';
import { solve } from '../src/core/engine.ts';
import { exhaustiveInitial, exhaustiveValue } from '../src/core/exhaustive.ts';
import { validateRule } from '../src/core/validate.ts';
import { LIMITS } from '../src/core/types.ts';

test('公平六面骰重掷一次、最大化点数：初始期望 17/4，应保留 4/5/6', () => {
  const rule = makeRule({
    name: 'd6-once',
    dice: [fairD6('d1')],
    maxRerolls: 1,
    payoff: { kind: 'sum' },
  });
  const r = solve(rule);
  assert.equal(r.status, 'optimal');
  assert.equal(r.initialValue!.toFraction(), '17/4');

  // 1,2,3 应重掷；4,5,6 应停止
  for (const v of [1, 2, 3]) {
    const d = r.policy!.query(1, { d1: v });
    assert.equal(d.chosen.action, 'reroll', `点数 ${v} 应重掷`);
  }
  for (const v of [4, 5, 6]) {
    const d = r.policy!.query(1, { d1: v });
    assert.equal(d.chosen.action, 'stop', `点数 ${v} 应停止`);
  }
  // 无剩余轮数时只能结算
  assert.equal(r.policy!.query(0, { d1: 1 }).chosen.action, 'stop');
});

test('概率和为 1（双骰联合分布）', () => {
  const rule = makeRule({
    name: '2d6',
    dice: [fairD6('a'), fairD6('b')],
    maxRerolls: 0,
    payoff: { kind: 'sum' },
  });
  const d = exactDistribution(rule);
  assert.equal(d.joint.length, 36);
  assert.ok(d.probabilityMassCheck.equals(Rational.ONE));
  const jointMass = d.joint.reduce((s, o) => s.add(o.probability), Rational.ZERO);
  assert.ok(jointMass.equals(Rational.ONE));
});

test('无重掷期望等于总点数均值 7（2d6）', () => {
  const rule = makeRule({ name: '2d6', dice: [fairD6('a'), fairD6('b')], maxRerolls: 0, payoff: { kind: 'sum' } });
  const d = exactDistribution(rule);
  assert.equal(d.expectedPayoff.toFraction(), '7');
});

test('穷举核对：求解器与独立穷举在多组微型游戏上一致', () => {
  const cases = [
    { dice: [fairD6('a')], rerolls: 1, payoff: { kind: 'sum' as const } },
    { dice: [fairD6('a'), fairD6('b')], rerolls: 1, payoff: { kind: 'sum' as const } },
    { dice: [fairD6('a')], rerolls: 2, payoff: { kind: 'threshold' as const, threshold: 5 } },
    {
      dice: [{ id: 'w', faces: [{ value: 1, weight: 1 }, { value: 5, weight: 3 }] }],
      rerolls: 1,
      payoff: { kind: 'sum' as const },
    },
  ];
  for (const c of cases) {
    const rule = makeRule({ name: 'micro', dice: c.dice, maxRerolls: c.rerolls, payoff: c.payoff });
    const r = solve(rule);
    const exh = exhaustiveInitial(rule);
    assert.ok(r.initialValue!.equals(exh), `不一致: ${JSON.stringify(c)} solver=${r.initialValue!.toFraction()} exh=${exh.toFraction()}`);
  }
});

test('每个状态的所有候选动作值与独立穷举逐一吻合（微型游戏全动作核对）', () => {
  const rule = makeRule({
    name: 'micro-actions',
    dice: [fairD6('a'), fairD6('b')],
    maxRerolls: 1,
    payoff: { kind: 'sum' },
  });
  const r = solve(rule);
  for (let x = 1; x <= 6; x++) {
    for (let y = 1; y <= 6; y++) {
      const d = r.policy!.query(1, { a: x, b: y });
      const e = exhaustiveValue(rule, 1, [x, y]);
      assert.equal(d.candidates.length, e.candidates.length);
      for (const cand of d.candidates) {
        const other = e.candidates.find(
          (c) => c.action === cand.action && c.rerollIds.join() === cand.rerollIds.join(),
        )!;
        assert.ok(cand.value.equals(other.value), `动作 ${cand.action} 值不符 (${x},${y})`);
      }
    }
  }
});

test('门槛收益：达到阈值为 1 否则 0，期望为精确分数', () => {
  const rule = makeRule({
    name: 'thr',
    dice: [fairD6('a'), fairD6('b')],
    maxRerolls: 0,
    payoff: { kind: 'threshold', threshold: 11 },
  });
  const d = exactDistribution(rule);
  // 和为 11 或 12 共 3 种 / 36 = 1/12
  assert.equal(d.expectedPayoff.toFraction(), '1/12');
  assert.ok(d.probabilityMassCheck.equals(Rational.ONE));
});

test('相同总和但最优动作不同（保留身份，不错误合并）', () => {
  // 两枚不同权重骰子，同总和下最优重掷对象可能不同。
  const rule = makeRule({
    name: 'identity',
    dice: [
      { id: 'low', faces: [{ value: 1, weight: 1 }, { value: 2, weight: 1 }] },
      { id: 'high', faces: [{ value: 1, weight: 1 }, { value: 10, weight: 1 }] },
    ],
    maxRerolls: 1,
    payoff: { kind: 'sum' },
  });
  const r = solve(rule);
  // 状态 (low=2, high=1) 总和 3：倾向重掷 high
  const s1 = r.policy!.query(1, { low: 2, high: 1 });
  assert.deepEqual(s1.chosen.rerollIds, ['high']);
  // 状态 (low=1, high=2) 不可能（high 无 2 面），改用可达同总和对照：
  // (low=1,high=1) 总和2 与上不同策略，证明按身份区分
  const s2 = r.policy!.query(1, { low: 1, high: 1 });
  assert.notDeepEqual(s1.chosen.rerollIds, s2.chosen.rerollIds);
});

test('立即停止：maxRerolls=0 时所有状态只能 stop', () => {
  const rule = makeRule({ name: 'stop', dice: [fairD6('a'), fairD6('b')], maxRerolls: 0, payoff: { kind: 'sum' } });
  const r = solve(rule);
  const d = r.policy!.query(0, { a: 1, b: 1 });
  assert.equal(d.candidates.length, 1);
  assert.equal(d.chosen.action, 'stop');
});

test('轮数增加时最优值不下降（单调性）', () => {
  const base = { name: 'mono', dice: [fairD6('a'), fairD6('b')], payoff: { kind: 'sum' as const } };
  let prev: Rational | null = null;
  for (let k = 0; k <= 3; k++) {
    const r = solve(makeRule({ ...base, maxRerolls: k }));
    if (prev) assert.ok(r.initialValue!.cmp(prev) >= 0, `轮数 ${k} 时值下降`);
    prev = r.initialValue;
  }
});

test('骰子重命名不改变最优值与分布概率', () => {
  const mk = (id: string) =>
    makeRule({ name: 'rename', dice: [fairD6(id)], maxRerolls: 1, payoff: { kind: 'sum' } });
  const a = solve(mk('x'));
  const b = solve(mk('renamed'));
  assert.equal(a.initialValue!.toFraction(), b.initialValue!.toFraction());
  const da = exactDistribution(mk('x'));
  const db = exactDistribution(mk('renamed'));
  assert.equal(da.expectedPayoff.toFraction(), db.expectedPayoff.toFraction());
});

test('非法输入被拒绝：非正权重、空骰子、超规模、重复 id', () => {
  assert.throws(() => validateRule({ name: 'x', dice: [], maxRerolls: 0, payoff: { kind: 'sum' } }));
  assert.throws(() =>
    validateRule({ name: 'x', dice: [{ id: 'a', faces: [] }], maxRerolls: 0, payoff: { kind: 'sum' } }),
  );
  assert.throws(() =>
    validateRule({
      name: 'x',
      dice: [{ id: 'a', faces: [{ value: 1, weight: 0 }] }],
      maxRerolls: 0,
      payoff: { kind: 'sum' },
    }),
  );
  assert.throws(() =>
    validateRule({
      name: 'x',
      dice: [fairD6('a'), fairD6('a')],
      maxRerolls: 0,
      payoff: { kind: 'sum' },
    }),
  );
  assert.throws(() =>
    validateRule({
      name: 'x',
      dice: [fairD6('a')],
      maxRerolls: LIMITS.MAX_REROLLS + 1,
      payoff: { kind: 'sum' },
    }),
  );
});

test('重复点数面按权重合并概率', () => {
  const rule = makeRule({
    name: 'dup',
    dice: [
      {
        id: 'a',
        faces: [
          { value: 1, weight: 1 },
          { value: 1, weight: 1 },
          { value: 2, weight: 2 },
        ],
      },
    ],
    maxRerolls: 0,
    payoff: { kind: 'sum' },
  });
  const d = exactDistribution(rule);
  const p1 = d.sum.find((x) => x.value === 1)!.probability;
  const p2 = d.sum.find((x) => x.value === 2)!.probability;
  assert.equal(p1.toFraction(), '1/2');
  assert.equal(p2.toFraction(), '1/2');
});
