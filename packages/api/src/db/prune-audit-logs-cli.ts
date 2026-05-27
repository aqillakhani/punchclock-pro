import '../config/load-env.js';
import { pathToFileURL } from 'node:url';
import { withTenantTx, closePool } from '../config/database.js';
import { pruneAuditLogs } from './prune-audit-logs.js';
import { logger } from '../config/logger.js';

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  withTenantTx(null, pruneAuditLogs)
    .then((deletedCount) => {
      logger.info({ deletedCount }, 'audit logs pruned');
      return closePool();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'prune audit logs failed');
      closePool().finally(() => process.exit(1));
    });
}
