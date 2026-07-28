import '../config/load-env.js';
import { pathToFileURL } from 'node:url';
import { prodSeed } from './prod-seed.js';
import { closePool } from '../config/database.js';
import { logger } from '../config/logger.js';
import { useOwnerConnection } from './owner-connection.js';

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  useOwnerConnection();
  prodSeed()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'production seed failed');
      closePool().finally(() => process.exit(1));
    });
}
