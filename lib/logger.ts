import pino from 'pino';
import fs from 'fs';
import path from 'path';

const LEVEL =
  process.env.LOG_LEVEL ??
  (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

const isDev = process.env.NODE_ENV !== 'production';
const isNext = !!process.env.NEXT_RUNTIME || !!process.env.__NEXT_PRIVATE_ORIGIN;
// Read-only filesystems (Vercel /var/task, AWS Lambda) — never try to write a file.
const isServerless =
  !!process.env.VERCEL ||
  !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
  !!process.env.AWS_EXECUTION_ENV;
// Opt-in file logging for long-running scripts (cron jobs on Render etc.).
const logFilePath = process.env.LOG_FILE
  ? path.resolve(process.env.LOG_FILE)
  : null;

if (logFilePath && !isServerless) {
  try {
    const dir = path.dirname(logFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {
    // fall through to stderr
  }
}

// pino-pretty's worker transport breaks under Next.js's module loader
// (.next/server/vendor-chunks/lib/worker.js not found), so we use a synchronous
// pretty formatter there and restrict worker transports to standalone tsx scripts.
function buildLogger() {
  if (isDev) {
    if (isNext) {
      try {
        const pretty = require('pino-pretty');
        return pino(
          { level: LEVEL },
          pretty({ colorize: true, translateTime: 'HH:MM:ss.l', destination: 2, sync: true })
        );
      } catch {
        return pino({ level: LEVEL });
      }
    }
    return pino({
      level: LEVEL,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l', destination: 2 },
      },
    });
  }

  if (logFilePath && !isServerless) {
    try {
      return pino(
        { level: LEVEL },
        pino.destination({ dest: logFilePath, sync: false })
      );
    } catch {
      // fall through to default stderr
    }
  }
  return pino({ level: LEVEL });
}

export const logger = buildLogger();

export function childLogger(scope: string) {
  return logger.child({ scope });
}
