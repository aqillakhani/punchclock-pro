import type { PoolClient } from 'pg';
import {
  GEOFENCE_ENFORCEMENT,
  type GeoPoint,
  type GeofenceEnforcement,
  type Geofence,
} from '@punchclock/shared';

/**
 * Haversine distance in meters. Used client-side for fast local checks
 * and in pure unit tests; the authoritative server check uses PostGIS.
 */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface GeofenceDecision {
  allowed: boolean;
  inside: boolean;
  geofence: Geofence | null;
  distanceMeters: number;
  enforcementLevel: GeofenceEnforcement;
  reason?: string;
}

interface GeofenceRow {
  id: string;
  organization_id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  enforcement_level: GeofenceEnforcement;
  is_active: boolean;
  created_at: string;
  distance_m: number;
}

function rowToGeofence(row: GeofenceRow): Geofence {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    radiusMeters: row.radius_meters,
    enforcementLevel: row.enforcement_level,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

/**
 * Given the caller's current GPS point, find the nearest active
 * geofence for the organization and decide whether the punch should be
 * allowed based on its enforcement level.
 *
 * Semantics:
 *   flag              — always allowed, but inside/distance reported
 *   override_required — allowed only if inside OR overrideProvided
 *   block             — allowed only if inside the fence
 *
 * If the org has no geofences at all, the punch is allowed with
 * `geofence: null`.
 */
export async function evaluateGeofence(
  db: PoolClient,
  location: GeoPoint | undefined,
  opts: { overrideProvided?: boolean } = {},
): Promise<GeofenceDecision> {
  if (!location) {
    return {
      allowed: true,
      inside: false,
      geofence: null,
      distanceMeters: Number.POSITIVE_INFINITY,
      enforcementLevel: GEOFENCE_ENFORCEMENT.FLAG,
      reason: 'no_location_provided',
    };
  }

  const { rows } = await db.query<GeofenceRow>(
    `SELECT id, organization_id, name, latitude, longitude, radius_meters,
            enforcement_level, is_active, created_at,
            ST_Distance(
              geog,
              ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
            ) AS distance_m
     FROM geofences
     WHERE is_active = TRUE
     ORDER BY distance_m ASC
     LIMIT 1`,
    [location.longitude, location.latitude],
  );

  if (rows.length === 0) {
    return {
      allowed: true,
      inside: false,
      geofence: null,
      distanceMeters: Number.POSITIVE_INFINITY,
      enforcementLevel: GEOFENCE_ENFORCEMENT.FLAG,
      reason: 'no_geofences_configured',
    };
  }

  const row = rows[0]!;
  const distance = Number(row.distance_m);
  const inside = distance <= row.radius_meters;
  const geofence = rowToGeofence(row);

  switch (row.enforcement_level) {
    case GEOFENCE_ENFORCEMENT.FLAG:
      return {
        allowed: true,
        inside,
        geofence,
        distanceMeters: distance,
        enforcementLevel: row.enforcement_level,
        reason: inside ? 'inside' : 'flagged_outside',
      };
    case GEOFENCE_ENFORCEMENT.OVERRIDE_REQUIRED:
      return {
        allowed: inside || !!opts.overrideProvided,
        inside,
        geofence,
        distanceMeters: distance,
        enforcementLevel: row.enforcement_level,
        reason: inside
          ? 'inside'
          : opts.overrideProvided
            ? 'override_provided'
            : 'override_required',
      };
    case GEOFENCE_ENFORCEMENT.BLOCK:
      return {
        allowed: inside,
        inside,
        geofence,
        distanceMeters: distance,
        enforcementLevel: row.enforcement_level,
        reason: inside ? 'inside' : 'blocked_outside',
      };
    default:
      return {
        allowed: true,
        inside,
        geofence,
        distanceMeters: distance,
        enforcementLevel: GEOFENCE_ENFORCEMENT.FLAG,
      };
  }
}
