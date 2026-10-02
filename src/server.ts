import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { Rational } from './core/rational.ts';
import { Store, type StrategyRow } from './db/store.ts';
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
} from './core/engine.ts';
import { decisionToJSON } from './core/serialize.ts';
import { validateRule } from './core/validate.ts';
import { LIMITS } from './core/types.ts';

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data');
const store = new Store(join(DATA_DIR, 'polyhedral.db'));

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
  });
}

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
};

function loadRule(ruleId: string) {
  const row = store.getRule(ruleId);
  if (!row) throw new Error(`规则不存在：${ruleId}`);
  return ruleFromJSON(JSON.parse(row.payload));
}

function loadPolicy(strategyId: string) {
  const row = store.getStrategy(strategyId);
  if (!row) throw new Error(`策略不存在：${strategyId}`);
  if (row.status !== 'optimal' || !row.policy) throw new Error('该策略未求得最优（预算超限），无法查询');
  const rule = loadRule(row.rule_id);
  return { rule, row, policy: policyFromJSON(rule, JSON.parse(row.policy)) };
}

type Handler = (req: IncomingMessage, res: ServerResponse, body: any, url: URL) => Promise<void> | void;
const routes: Record<string, Handler> = {
  'GET /health': (_req: IncomingMessage, res: ServerResponse) => json(res, 200, { ok: true, limits: LIMITS }),

  'POST /rules': (_req, res, body) => {
    const rule = validateRule(body);
    store.insertRule({
      id: rule.id,
      name: rule.name,
      payload: JSON.stringify(ruleToJSON(rule)),
      created_at: new Date().toISOString(),
    });
    json(res, 201, { id: rule.id, rule: ruleToJSON(rule) });
  },

  'GET /rules': (_req, res) => json(res, 200, { rules: store.listRules() }),

  'GET /distribution': (_req: IncomingMessage, res: ServerResponse, _b: any, url: URL) => {
    const rule = loadRule(url.searchParams.get('ruleId')!);
    const d = distribution(rule);
    json(res, 200, {
      probabilityMass: rationalToJSON(d.probabilityMassCheck),
      expectedPayoff: rationalToJSON(d.expectedPayoff),
      sum: d.sum.map((x) => ({ value: x.value, probability: rationalToJSON(x.probability) })),
      payoff: d.payoff.map((x) => ({ value: x.value, probability: rationalToJSON(x.probability) })),
      joint: d.joint.map((o) => ({ faces: o.faces, probability: rationalToJSON(o.probability) })),
    });
  },

  'POST /strategies': (_req, res, body) => {
    const rule = loadRule(body.ruleId);
    const outcome = solve(rule);
    const id = `strat_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
    const configSnapshot = JSON.stringify({
      limits: LIMITS,
      engine: 'bigint-rational-bellman',
      payoff: rule.payoff,
      maxRerolls: rule.maxRerolls,
      dice: rule.dice.map((d) => d.id),
      timestamp: new Date().toISOString(),
    });
    const row: StrategyRow = {
      id,
      rule_id: rule.id,
      status: outcome.status,
      initial_value: outcome.initialValue ? outcome.initialValue.toFraction() : null,
      nodes: outcome.nodes,
      policy: outcome.policy ? JSON.stringify(policyToJSON(outcome.policy)) : null,
      config_snapshot: configSnapshot,
      created_at: new Date().toISOString(),
    };
    store.insertStrategy(row);
    json(res, 201, {
      id,
      status: outcome.status,
      error: outcome.error ?? null,
      nodes: outcome.nodes,
      initialValue: outcome.initialValue ? rationalToJSON(outcome.initialValue) : null,
    });
  },

  'GET /strategies': (_req: IncomingMessage, res: ServerResponse, _b: any, url: URL) =>
    json(res, 200, { strategies: store.listStrategies(url.searchParams.get('ruleId') ?? undefined) }),

  'POST /decide': (_req, res, body) => {
    const { rule, policy } = loadPolicy(body.strategyId);
    const d = decide(rule, policy, Number(body.roundsLeft), body.values);
    json(res, 200, decisionToJSON(d));
  },

  'POST /rollout': (_req, res, body) => {
    const { rule, policy } = loadPolicy(body.strategyId);
    const r = simulate(rule, policy, Number(body.seed ?? 1));
    json(res, 200, r);
  },

  'POST /sample': (_req, res, body) => {
    const { rule, policy, row } = loadPolicy(body.strategyId);
    const [n, dd] = row.initial_value!.split('/');
    const exact = Rational.of(BigInt(n), dd === undefined ? 1n : BigInt(dd));
    const r = sample(rule, policy, Number(body.seed ?? 1), Number(body.trials ?? 10000), exact);
    json(res, 200, r);
  },

  'GET /verify': (_req: IncomingMessage, res: ServerResponse, _b: any, url: URL) => {
    const rule = loadRule(url.searchParams.get('ruleId')!);
    const d = distribution(rule);
    const outcome = solve(rule);
    const exh = exhaustiveCheck(rule);
    json(res, 200, {
      probabilityMassIsOne: d.probabilityMassCheck.num === d.probabilityMassCheck.den && d.probabilityMassCheck.den === 1n,
      expectedPayoff: rationalToJSON(d.expectedPayoff),
      solverStatus: outcome.status,
      solverInitial: outcome.initialValue ? rationalToJSON(outcome.initialValue) : null,
      exhaustiveInitial: rationalToJSON(exh),
      match: outcome.initialValue ? outcome.initialValue.equals(exh) : null,
    });
  },
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const key = `${req.method} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) return json(res, 404, { error: `无此路由：${key}` });
    const body = req.method === 'POST' ? await readBody(req) : {};
    await handler(req, res, body, url);
  } catch (e) {
    json(res, 400, { error: (e as Error).message });
  }
});

server.listen(PORT, () => {
  console.log(`[polyhedral] HTTP API 已启动: http://localhost:${PORT}`);
  console.log(`[polyhedral] 数据目录: ${DATA_DIR}`);
});
