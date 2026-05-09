import type { PoolClient } from 'pg';
import type { EventType, UUID } from '@punchclock/shared';
import { AppError } from '../lib/errors.js';
import { logger } from '../config/logger.js';

export interface PublishEventInput {
  organizationId: UUID;
  userId: UUID;
  actorUserId?: UUID;
  eventType: EventType;
  eventData: Record<string, unknown>;
  clientGeneratedId?: string | null;
  timeEntryId?: UUID | null;
  recordedAt?: Date;
}

/**
 * Append an event to `time_entry_events`. Idempotent by
 * (organization_id, user_id, client_generated_id) — if a duplicate
 * arrives we return the existing event row rather than throwing.
 *
 * This is the single write path for time-tracking domain changes.
 * All materialized-state mutations on `time_entries` are performed by
 * callers after the event has been persisted, inside the same
 * transaction.
 */
export async function publishTimeEvent(
  db: PoolClient,
  input: PublishEventInput,
): Promise<{ id: UUID; recordedAt: string; duplicate: boolean }> {
  const recordedAt = input.recordedAt ?? new Date();

  // Idempotency short-circuit.
  if (input.clientGeneratedId) {
    const existing = await db.query<{ id: string; recorded_at: string }>(
      `SELECT id, recorded_at FROM time_entry_events
       WHERE organization_id = $1 AND user_id = $2 AND client_generated_id = $3
       LIMIT 1`,
      [input.organizationId, input.userId, input.clientGeneratedId],
    );
    if (existing.rows.length > 0) {
      logger.debug(
        { clientGeneratedId: input.clientGeneratedId },
        'idempotent replay of time event',
      );
      return {
        id: existing.rows[0]!.id,
        recordedAt: existing.rows[0]!.recorded_at,
        duplicate: true,
      };
    }
  }

  try {
    const { rows } = await db.query<{ id: string; recorded_at: string }>(
      `INSERT INTO time_entry_events
         (organization_id, user_id, time_entry_id, event_type, event_data,
          client_generated_id, actor_user_id, recorded_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       RETURNING id, recorded_at`,
      [
        input.organizationId,
        input.userId,
        input.timeEntryId ?? null,
        input.eventType,
        JSON.stringify(input.eventData ?? {}),
        input.clientGeneratedId ?? null,
        input.actorUserId ?? null,
        recordedAt,
      ],
    );
    return { id: rows[0]!.id, recordedAt: rows[0]!.recorded_at, duplicate: false };
  } catch (err) {
    // Race condition: two concurrent inserts with the same client id.
    if ((err as { code?: string }).code === '23505') {
      const existing = await db.query<{ id: string; recorded_at: string }>(
        `SELECT id, recorded_at FROM time_entry_events
         WHERE organization_id = $1 AND user_id = $2 AND client_generated_id = $3
         LIMIT 1`,
        [input.organizationId, input.userId, input.clientGeneratedId],
      );
      if (existing.rows.length > 0) {
        return {
          id: existing.rows[0]!.id,
          recordedAt: existing.rows[0]!.recorded_at,
          duplicate: true,
        };
      }
    }
    throw AppError.validation('Failed to publish time event', { cause: String(err) });
  }
}
