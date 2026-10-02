import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/db/store.ts';
import { validateRule } from '../src/core/validate.ts';
import { ruleToJSON, ruleFromJSON, solve, policyToJSON, policyFromJSON } from '../src/core/engine.ts';
import { fairD6, makeRule } from './helpers.ts';

test('策略持久化并在“重启”后重建，查询同一决策与精确值', () => {
  const dir = mkdtempSync(join(tmpdir(), 'poly-'));
  const dbPath = join(dir, 't.db');
  const rule = validateRule({ name: 'persist', dice: [fairD6('d1')], maxRerolls: 1, payoff: { kind: 'sum' } });
  const solved = solve(rule);

  {
    const store = new Store(dbPath);
    store.insertRule({ id: rule.id, name: rule.name, payload: JSON.stringify(ruleToJSON(rule)), created_at: new Date().toISOString() });
    store.insertStrategy({
      id: 's1',
      rule_id: rule.id,
      status: 'optimal',
      initial_value: solved.initialValue!.toFraction(),
      nodes: solved.nodes,
      policy: JSON.stringify(policyToJSON(solved.policy!)),
      config_snapshot: JSON.stringify({ engine: 'test' }),
      created_at: new Date().toISOString(),
    });
    store.close();
  }

  {
    const store = new Store(dbPath); // 重新打开，模拟重启
    const row = store.getStrategy('s1')!;
    assert.equal(row.initial_value, '17/4');
    const ruleRow = store.getRule(rule.id)!;
    const restoredRule = ruleFromJSON(JSON.parse(ruleRow.payload));
    const policy = policyFromJSON(restoredRule, JSON.parse(row.policy!));
    const d = policy.query(1, { d1: 2 });
    assert.equal(d.chosen.action, 'reroll');
    assert.equal(d.chosen.value.toFraction(), '7/2');
    store.close();
  }

  rmSync(dir, { recursive: true, force: true });
});

test('makeRule 导出可用（冒烟）', () => {
  assert.ok(makeRule({ name: 'x', dice: [fairD6('a')], maxRerolls: 0, payoff: { kind: 'sum' } }));
});
