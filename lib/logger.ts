import pino from 'pino';
import fs from 'fs';
import path from 'path';

const LEVEL =
  process.env.LOG_LEVEL ??
  (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

const isDev = process.env.NODE_ENV !== 'production';
const isNext = !!process.env.NEXT_RUNTIME || !!process.env.__NEXT_PRIVATE_ORIGIN;

const logsDir = path.join(process.cwd(), 'logs');
if (!isDev) {
  try {
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  } catch {
    // Read-only FS — fall through to stderr.
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

  try {
    return pino(
      { level: LEVEL },
      pino.destination({ dest: path.join(logsDir, 'app.log'), sync: false })
    );
  } catch {
    return pino({ level: LEVEL });
  }
}

export const logger = buildLogger();

export function childLogger(scope: string) {
  return logger.child({ scope });
}
