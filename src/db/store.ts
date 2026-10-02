import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface RuleRow {
  id: string;
  name: string;
  payload: string;
  created_at: string;
}

export interface StrategyRow {
  id: string;
  rule_id: string;
  status: 'optimal' | 'budget_exceeded';
  initial_value: string | null;
  nodes: number;
  policy: string | null;
  config_snapshot: string;
  created_at: string;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS strategies (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        status TEXT NOT NULL,
        initial_value TEXT,
        nodes INTEGER NOT NULL,
        policy TEXT,
        config_snapshot TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (rule_id) REFERENCES rules(id)
      );
    `);
  }

  insertRule(row: RuleRow): void {
    this.db
      .prepare('INSERT OR REPLACE INTO rules (id,name,payload,created_at) VALUES (?,?,?,?)')
      .run(row.id, row.name, row.payload, row.created_at);
  }
  getRule(id: string): RuleRow | undefined {
    return this.db.prepare('SELECT * FROM rules WHERE id=?').get(id) as RuleRow | undefined;
  }
  listRules(): RuleRow[] {
    return this.db.prepare('SELECT * FROM rules ORDER BY created_at').all() as unknown as RuleRow[];
  }

  insertStrategy(row: StrategyRow): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO strategies
         (id,rule_id,status,initial_value,nodes,policy,config_snapshot,created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.id,
        row.rule_id,
        row.status,
        row.initial_value,
        row.nodes,
        row.policy,
        row.config_snapshot,
        row.created_at,
      );
  }
  getStrategy(id: string): StrategyRow | undefined {
    return this.db.prepare('SELECT * FROM strategies WHERE id=?').get(id) as
      | StrategyRow
      | undefined;
  }
  listStrategies(ruleId?: string): StrategyRow[] {
    const rows = ruleId
      ? (this.db.prepare('SELECT * FROM strategies WHERE rule_id=? ORDER BY created_at').all(ruleId) as unknown as StrategyRow[])
      : (this.db.prepare('SELECT * FROM strategies ORDER BY created_at').all() as unknown as StrategyRow[]);
    return rows;
  }
  close(): void {
    this.db.close();
  }
}
