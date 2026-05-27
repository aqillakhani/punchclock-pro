import express, { type Express } from 'express';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { corsOrigins, loadEnv } from './config/env.js';
import { securityHeaders } from './config/security.js';
import { logger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { timeTrackingRouter } from './routes/time-tracking.js';
import { geofenceRouter } from './routes/geofence.js';
import { schedulingRouter } from './routes/scheduling.js';
import { adminRouter } from './routes/admin.js';
import { meRouter } from './routes/me.js';
import { syncRouter } from './routes/sync.js';

export function createApp(): Express {
  const env = loadEnv();
  const app = express();

  app.disable('x-powered-by');
  // Required so req.ip resolves to the client address when the API
  // sits behind nginx / ALB / Cloud Run. In dev this is harmless.
  app.set('trust proxy', true);
  app.use(securityHeaders());
  app.use(cors({ origin: corsOrigins(env), credentials: true }));
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: '1mb' }));

  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/api/v1/time-tracking', timeTrackingRouter);
  app.use('/api/v1/geofence/locations', geofenceRouter);
  app.use('/api/v1/scheduling', schedulingRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1/me', meRouter);
  app.use('/api/v1/sync', syncRouter);

  app.use(notFoundHandler());
  app.use(errorHandler);

  return app;
}
