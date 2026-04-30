import { createClient } from '@libsql/client';
import { childLogger } from '../lib/logger';

const log = childLogger('db');
const SLOW_QUERY_MS = 500;

const rawClient = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:local.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

function previewSql(sql: string): string {
  const collapsed = sql.replace(/\s+/g, ' ').trim();
  return collapsed.length > 120 ? collapsed.slice(0, 120) + '…' : collapsed;
}

const RETRY_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN']);
const MAX_RETRIES = 4;

function isRetryable(err: any): boolean {
  if (!err) return false;
  if (err.code && RETRY_CODES.has(err.code)) return true;
  if (err.cause && err.cause.code && RETRY_CODES.has(err.cause.code)) return true;
  const msg = String(err.message ?? '');
  return /ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}

function wrap<T extends (...args: any[]) => Promise<any>>(
  method: T,
  label: string
): T {
  return (async (...args: any[]) => {
    const started = Date.now();
    let lastErr: any;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await method(...args);
        const durationMs = Date.now() - started;
        if (durationMs > SLOW_QUERY_MS) {
          const first = args[0];
          const sqlPreview =
            typeof first === 'string'
              ? previewSql(first)
              : first && typeof first.sql === 'string'
                ? previewSql(first.sql)
                : label;
          log.warn({ durationMs, sql: sqlPreview }, 'slow query');
        }
        return result;
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_RETRIES && isRetryable(err)) {
          const backoffMs = 500 * Math.pow(2, attempt);
          log.warn({ err: (err as any)?.code ?? (err as any)?.message, attempt: attempt + 1, backoffMs }, 'db retry');
          await sleep(backoffMs);
          continue;
        }
        log.error({ err, durationMs: Date.now() - started, op: label }, 'db error');
        throw err;
      }
    }
    throw lastErr;
  }) as T;
}

export const db: typeof rawClient = new Proxy(rawClient, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (prop === 'execute' && typeof value === 'function') {
      return wrap(value.bind(target), 'execute');
    }
    if (prop === 'batch' && typeof value === 'function') {
      return wrap(value.bind(target), 'batch');
    }
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
