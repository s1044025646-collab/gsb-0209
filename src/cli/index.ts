#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { Store, type StrategyRow } from '../db/store.ts';
import {
  decide,
  distribution,
  exhaustiveCheck,
  policyFromJSON,
  policyToJSON,
  rationalToJSON,
  ruleFromJSON,
  ruleToJSON,
  sample,
  simulate,
  solve,
} from '../core/engine.ts';
import { decisionToJSON } from '../core/serialize.ts';
import { validateRule } from '../core/validate.ts';
import { Rational } from '../core/rational.ts';
import { LIMITS } from '../core/types.ts';

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data');
mkdirSync(DATA_DIR, { recursive: true });
const store = new Store(join(DATA_DIR, 'polyhedral.db'));

const args = process.argv.slice(2);
const cmd = args.shift();

function loadFile(path: string) {
  return JSON.parse(readFileSync(resolve(path), 'utf-8'));
}
function out(obj: unknown) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function toCsv(rows: Record<string, string | number>[]): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

function writeExport(name: string, json: unknown, csv: string) {
  const dir = flag('dir') ?? DATA_DIR;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(json, null, 2));
  writeFileSync(join(dir, `${name}.csv`), csv);
  console.log(`已导出 ${join(dir, name)}.json / .csv`);
}

function getRuleEntity(ruleId: string) {
  const row = store.getRule(ruleId);
  if (!row) throw new Error(`规则不存在：${ruleId}`);
  return { row, rule: ruleFromJSON(JSON.parse(row.payload)) };
}
function getPolicyEntity(strategyId: string) {
  const row = store.getStrategy(strategyId) as StrategyRow;
  if (!row) throw new Error(`策略不存在：${strategyId}`);
  if (row.status !== 'optimal' || !row.policy) throw new Error('策略未求得最优（预算超限）');
  const { rule } = getRuleEntity(row.rule_id);
  return { row, rule, policy: policyFromJSON(rule, JSON.parse(row.policy)) };
}

try {
  switch (cmd) {
    case 'limits':
      out(LIMITS);
      break;

    case 'import-rule': {
      const rule = validateRule(loadFile(flag('file')!));
      store.insertRule({
        id: rule.id,
        name: rule.name,
        payload: JSON.stringify(ruleToJSON(rule)),
        created_at: new Date().toISOString(),
      });
      out({ id: rule.id, dice: rule.dice.length, totalFaces: rule.dice.reduce((s, d) => s + d.faces.length, 0) });
      break;
    }

    case 'list-rules':
      out(store.listRules().map((r) => ({ id: r.id, name: r.name })));
      break;

    case 'distribution': {
      const { rule } = getRuleEntity(flag('rule')!);
      const d = distribution(rule);
      const json = {
        probabilityMass: rationalToJSON(d.probabilityMassCheck),
        expectedPayoff: rationalToJSON(d.expectedPayoff),
        sum: d.sum.map((x) => ({ value: x.value, probability: rationalToJSON(x.probability) })),
        payoff: d.payoff.map((x) => ({ value: x.value, probability: rationalToJSON(x.probability) })),
      };
      if (flag('export')) {
        writeExport(
          `distribution_${rule.id}`,
          json,
          toCsv(d.sum.map((x) => ({ sum: x.value, fraction: x.probability.toFraction(), decimal: x.probability.toDecimal() }))),
        );
      }
      out(json);
      break;
    }

    case 'solve': {
      const { rule } = getRuleEntity(flag('rule')!);
      const result = solve(rule);
      const id = `strat_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
      store.insertStrategy({
        id,
        rule_id: rule.id,
        status: result.status,
        initial_value: result.initialValue?.toFraction() ?? null,
        nodes: result.nodes,
        policy: result.policy ? JSON.stringify(policyToJSON(result.policy)) : null,
        config_snapshot: JSON.stringify({ limits: LIMITS, engine: 'bigint-rational-bellman', timestamp: new Date().toISOString() }),
        created_at: new Date().toISOString(),
      });
      out({
        strategyId: id,
        status: result.status,
        nodes: result.nodes,
        initialValue: result.initialValue ? rationalToJSON(result.initialValue) : null,
        error: result.error ?? null,
      });
      break;
    }

    case 'list-strategies':
      out(store.listStrategies(flag('rule')));
      break;

    case 'decide': {
      const { rule, policy } = getPolicyEntity(flag('strategy')!);
      const values = JSON.parse(flag('values')!);
      const d = decide(rule, policy, Number(flag('rounds') ?? 0), values);
      out(decisionToJSON(d));
      break;
    }

    case 'rollout': {
      const { rule, policy } = getPolicyEntity(flag('strategy')!);
      out(simulate(rule, policy, Number(flag('seed') ?? 1)));
      break;
    }

    case 'sample': {
      const { rule, policy, row } = getPolicyEntity(flag('strategy')!);
      const [n, dd] = row.initial_value!.split('/');
      const exact = Rational.of(BigInt(n), dd === undefined ? 1n : BigInt(dd));
      out(sample(rule, policy, Number(flag('seed') ?? 1), Number(flag('trials') ?? 10000), exact));
      break;
    }

    case 'verify': {
      const { rule } = getRuleEntity(flag('rule')!);
      const d = distribution(rule);
      const result = solve(rule);
      const exh = exhaustiveCheck(rule);
      out({
        probabilityMassIsOne: d.probabilityMassCheck.equals(Rational.ONE),
        expectedPayoff: rationalToJSON(d.expectedPayoff),
        solverStatus: result.status,
        solverInitial: result.initialValue ? rationalToJSON(result.initialValue) : null,
        exhaustiveInitial: rationalToJSON(exh),
        match: result.initialValue?.equals(exh) ?? null,
      });
      break;
    }

    case 'export-strategy': {
      const { rule, policy } = getPolicyEntity(flag('strategy')!);
      const decisions = [...policy.allDecisions()].map(decisionToJSON);
      const csvRows: Record<string, string | number>[] = [];
      for (const dd of decisions) {
        for (const c of dd.candidates) {
          csvRows.push({
            roundsLeft: dd.roundsLeft,
            state: JSON.stringify(dd.values),
            action: c.action,
            rerollIds: c.rerollIds.join('|'),
            valueFraction: c.value.fraction,
            valueDecimal: c.value.decimal,
            chosen: dd.chosen.action === c.action && dd.chosen.rerollIds.join() === c.rerollIds.join() ? 1 : 0,
          });
        }
      }
      writeExport(`strategy_${rule.id}`, { rule: ruleToJSON(rule), decisions }, toCsv(csvRows));
      break;
    }

    default:
      console.log(`多面骰精确概率与重掷策略 CLI

用法:
  npm run cli -- limits
  npm run cli -- import-rule --file rule.json
  npm run cli -- list-rules
  npm run cli -- distribution --rule <id> [--export]
  npm run cli -- solve --rule <id>
  npm run cli -- list-strategies [--rule <id>]
  npm run cli -- decide --strategy <id> --rounds <n> --values '{"d1":3}'
  npm run cli -- rollout --strategy <id> [--seed 1]
  npm run cli -- sample --strategy <id> [--seed 1] [--trials 10000]
  npm run cli -- verify --rule <id>
  npm run cli -- export-strategy --strategy <id> [--dir exports]

环境变量: PORT(HTTP) DATA_DIR(默认 ./data)
规模限制:`, LIMITS);
  }
} catch (e) {
  console.error('错误:', (e as Error).message);
  process.exit(1);
}

store.close();
