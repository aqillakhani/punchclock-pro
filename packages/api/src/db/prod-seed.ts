import { getPool, withTenantTx } from '../config/database.js';
import { loadEnv } from '../config/env.js';
import { logger } from '../config/logger.js';

interface GeofenceConfig {
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

/**
 * Check if an organization is seedable (has only the owner).
 * Returns true only if userCount <= 1.
 */
export function isOrgSeedable(userCount: number): boolean {
  return userCount <= 1;
}

/**
 * Validate and parse geofence environment variables.
 * Returns validated config or throws with a clear error message.
 */
export function validateGeofenceEnv(env: Record<string, string | undefined>): GeofenceConfig {
  const name = env.SEED_GEOFENCE_NAME;
  if (!name) {
    throw new Error('SEED_GEOFENCE_NAME environment variable is required for production seed');
  }

  const latStr = env.SEED_GEOFENCE_LAT;
  if (!latStr) {
    throw new Error('SEED_GEOFENCE_LAT environment variable is required for production seed');
  }
  const lat = Number(latStr);
  if (Number.isNaN(lat)) {
    throw new Error(`SEED_GEOFENCE_LAT must be numeric; got: ${latStr}`);
  }

  const lngStr = env.SEED_GEOFENCE_LNG;
  if (!lngStr) {
    throw new Error('SEED_GEOFENCE_LNG environment variable is required for production seed');
  }
  const lng = Number(lngStr);
  if (Number.isNaN(lng)) {
    throw new Error(`SEED_GEOFENCE_LNG must be numeric; got: ${lngStr}`);
  }

  let radiusMeters = 150;
  if (env.SEED_GEOFENCE_RADIUS_M) {
    const radius = Number(env.SEED_GEOFENCE_RADIUS_M);
    if (Number.isNaN(radius)) {
      throw new Error(`SEED_GEOFENCE_RADIUS_M must be numeric; got: ${env.SEED_GEOFENCE_RADIUS_M}`);
    }
    radiusMeters = radius;
  }

  return {
    name,
    latitude: lat,
    longitude: lng,
    radiusMeters,
  };
}

async function seedImpl(): Promise<void> {
  const env = loadEnv();
  const geofenceConfig = validateGeofenceEnv(process.env);

  await withTenantTx(null, async (client) => {
    logger.info({ geofence: geofenceConfig.name }, 'starting production seed');

    // Check idempotency: if the org has more than 1 non-deleted user, abort.
    const { rows: userCounts } = await client.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL`,
    );
    const userCount = parseInt(userCounts[0]!.count, 10);

    if (!isOrgSeedable(userCount)) {
      logger.warn(
        { userCount },
        'production seed aborted: org already has non-owner users; this seed is only for fresh orgs',
      );
      return;
    }

    // Insert or ensure geofence.
    // Upsert: update if exists (by org + name), insert if not.
    const geofenceOrg = await client.query<{ id: string }>(`SELECT id FROM organizations LIMIT 1`);
    if (!geofenceOrg.rows[0]) {
      throw new Error('No organization found; production seed requires an existing organization');
    }
    const orgId = geofenceOrg.rows[0].id;

    await client.query(
      `INSERT INTO geofences
         (organization_id, name, latitude, longitude, radius_meters, enforcement_level, is_active)
       VALUES ($1, $2, $3, $4, $5, 'flag', TRUE)
       ON CONFLICT (organization_id, name) DO UPDATE SET
         latitude = $3,
         longitude = $4,
         radius_meters = $5,
         is_active = TRUE,
         updated_at = NOW()`,
      [
        orgId,
        geofenceConfig.name,
        geofenceConfig.latitude,
        geofenceConfig.longitude,
        geofenceConfig.radiusMeters,
      ],
    );
    logger.info({ geofence: geofenceConfig.name }, 'geofence inserted/updated');

    // Ensure organization caps are set to defaults (8h/day = 480 min, 40h/week = 2400 min).
    await client.query(
      `UPDATE organizations
       SET max_daily_minutes = 480,
           max_weekly_minutes = 2400,
           updated_at = NOW()
       WHERE id = $1`,
      [orgId],
    );
    logger.info(
      { maxDailyMinutes: 480, maxWeeklyMinutes: 2400 },
      'organization caps set to defaults',
    );

    logger.info('production seed complete');
  });
}

// Public API for calling the seed directly (useful for programmatic access).
export async function prodSeed(): Promise<void> {
  return seedImpl();
}
