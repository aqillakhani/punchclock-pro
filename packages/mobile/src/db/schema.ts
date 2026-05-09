import { appSchema, tableSchema } from '@nozbe/watermelondb';

/**
 * Local WatermelonDB schema — mirrors the server's event-sourced time
 * store. All domain writes go into `punch_events` (append-only); the
 * `punches` and `breaks` tables are derived projections kept up to
 * date by the punch service. `sync_queue` holds pending operations
 * waiting for the server to acknowledge them.
 */
export const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'punch_events',
      columns: [
        { name: 'client_generated_id', type: 'string', isIndexed: true },
        { name: 'event_type', type: 'string' },
        { name: 'timestamp', type: 'number', isIndexed: true },
        { name: 'user_id', type: 'string', isIndexed: true },
        { name: 'latitude', type: 'number', isOptional: true },
        { name: 'longitude', type: 'number', isOptional: true },
        { name: 'accuracy', type: 'number', isOptional: true },
        { name: 'payload_json', type: 'string' },
        { name: 'synced', type: 'boolean', isIndexed: true },
        { name: 'server_id', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
      ],
    }),

    tableSchema({
      name: 'punches',
      columns: [
        { name: 'server_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'user_id', type: 'string', isIndexed: true },
        { name: 'punch_in_at', type: 'number', isIndexed: true },
        { name: 'punch_out_at', type: 'number', isOptional: true },
        { name: 'duration_minutes', type: 'number', isOptional: true },
        { name: 'in_event_id', type: 'string' },
        { name: 'out_event_id', type: 'string', isOptional: true },
        { name: 'sync_status', type: 'string', isIndexed: true },
      ],
    }),

    tableSchema({
      name: 'breaks',
      columns: [
        { name: 'server_id', type: 'string', isOptional: true },
        { name: 'punch_id', type: 'string', isIndexed: true },
        { name: 'break_type', type: 'string' },
        { name: 'break_start', type: 'number' },
        { name: 'break_end', type: 'number', isOptional: true },
        { name: 'duration_minutes', type: 'number', isOptional: true },
        { name: 'synced', type: 'boolean' },
      ],
    }),

    tableSchema({
      name: 'sync_queue',
      columns: [
        { name: 'event_id', type: 'string', isIndexed: true },
        { name: 'operation_type', type: 'string' },
        { name: 'payload_json', type: 'string' },
        { name: 'priority', type: 'number' },
        { name: 'retry_count', type: 'number' },
        { name: 'last_retry_at', type: 'number', isOptional: true },
        { name: 'queued_at', type: 'number', isIndexed: true },
        { name: 'status', type: 'string', isIndexed: true },
        { name: 'error_message', type: 'string', isOptional: true },
        { name: 'server_id', type: 'string', isOptional: true },
        { name: 'conflict_reason', type: 'string', isOptional: true },
      ],
    }),

    tableSchema({
      name: 'geofences',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'name', type: 'string' },
        { name: 'latitude', type: 'number' },
        { name: 'longitude', type: 'number' },
        { name: 'radius_meters', type: 'number' },
        { name: 'enforcement_level', type: 'string' },
        { name: 'is_active', type: 'boolean' },
      ],
    }),
  ],
});
