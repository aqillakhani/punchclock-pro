import './config/load-env.js';
import http from 'node:http';
import { createApp } from './app.js';
import { corsOrigins, loadEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { createSocketServer } from './realtime/socket.js';
import { closePool } from './config/database.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = createApp();
  const server = http.createServer(app);
  createSocketServer(server, corsOrigins(env));

  server.listen(env.API_PORT, () => {
    logger.info({ port: env.API_PORT, env: env.NODE_ENV }, 'PunchClock Pro API started');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    // Force exit after 10s.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
