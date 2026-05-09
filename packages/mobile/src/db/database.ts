import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { schema } from './schema';
import { SyncQueueItemModel } from './models/SyncQueueItem';

let database: Database | null = null;

/**
 * Lazily initialize the on-device SQLite database. Called from the
 * root layout on app launch. Native build is required (the SQLite
 * adapter is implemented in C++ on iOS and JNI on Android).
 */
export async function initDatabase(): Promise<Database> {
  if (database) return database;
  const adapter = new SQLiteAdapter({ schema, dbName: 'punchclock' });
  database = new Database({
    adapter,
    modelClasses: [SyncQueueItemModel],
  });
  return database;
}

export function getDatabase(): Database {
  if (!database) {
    throw new Error('Database not initialized — call initDatabase() first.');
  }
  return database;
}
