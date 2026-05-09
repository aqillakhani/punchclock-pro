import type { AuthenticatedUser } from '@punchclock/shared';
import type { PoolClient } from 'pg';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
    interface Locals {
      db?: PoolClient;
    }
  }
}

export {};
