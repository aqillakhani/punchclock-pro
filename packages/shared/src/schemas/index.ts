import { z } from 'zod';
import {
  BREAK_TYPES,
  EVENT_TYPES,
  GEOFENCE_ENFORCEMENT,
  ROLES,
  TIME_ENTRY_STATUS,
} from '../constants/index.js';

export const uuidSchema = z.string().uuid();
export const isoTimestampSchema = z.string().datetime({ offset: true });

export const geoPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().optional(),
});

export const deviceInfoSchema = z.object({
  deviceId: z.string().min(1).max(255),
  platform: z.enum(['ios', 'android', 'web', 'kiosk']),
  appVersion: z.string().max(32).optional(),
  userAgent: z.string().max(1024).optional(),
});

export const roleSchema = z.enum([ROLES.OWNER, ROLES.MANAGER, ROLES.EMPLOYEE, ROLES.VIEWER]);
export const eventTypeSchema = z.enum([
  EVENT_TYPES.PUNCH_IN,
  EVENT_TYPES.PUNCH_OUT,
  EVENT_TYPES.BREAK_START,
  EVENT_TYPES.BREAK_END,
  EVENT_TYPES.ENTRY_EDITED,
  EVENT_TYPES.ENTRY_DELETED,
  EVENT_TYPES.JOB_SWITCHED,
]);
export const geofenceEnforcementSchema = z.enum([
  GEOFENCE_ENFORCEMENT.FLAG,
  GEOFENCE_ENFORCEMENT.OVERRIDE_REQUIRED,
  GEOFENCE_ENFORCEMENT.BLOCK,
]);
export const breakTypeSchema = z.enum([
  BREAK_TYPES.LUNCH,
  BREAK_TYPES.STANDARD,
  BREAK_TYPES.UNPAID,
]);
export const timeEntryStatusSchema = z.enum([
  TIME_ENTRY_STATUS.IN_PROGRESS,
  TIME_ENTRY_STATUS.COMPLETED,
  TIME_ENTRY_STATUS.EDITED,
  TIME_ENTRY_STATUS.DELETED,
]);

// ---- Request schemas ----

export const punchInRequestSchema = z.object({
  clientGeneratedId: z.string().min(1).max(128),
  timestamp: isoTimestampSchema,
  location: geoPointSchema.optional(),
  deviceInfo: deviceInfoSchema.optional(),
  geofenceId: uuidSchema.optional(),
  overrideReason: z.string().max(512).optional(),
  jobId: uuidSchema.optional(),
  notes: z.string().max(1024).optional(),
});

export const punchOutRequestSchema = z.object({
  clientGeneratedId: z.string().min(1).max(128),
  timestamp: isoTimestampSchema,
  location: geoPointSchema.optional(),
  deviceInfo: deviceInfoSchema.optional(),
  notes: z.string().max(1024).optional(),
});

export const breakStartRequestSchema = z.object({
  clientGeneratedId: z.string().min(1).max(128),
  timeEntryId: uuidSchema,
  timestamp: isoTimestampSchema,
  breakType: breakTypeSchema.default(BREAK_TYPES.STANDARD),
});

export const breakEndRequestSchema = z.object({
  clientGeneratedId: z.string().min(1).max(128),
  timestamp: isoTimestampSchema,
});

export const geofenceCreateSchema = z.object({
  name: z.string().min(1).max(255),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().positive().max(10000).default(100),
  enforcementLevel: geofenceEnforcementSchema.default(GEOFENCE_ENFORCEMENT.FLAG),
  isActive: z.boolean().default(true),
});

export const geofenceValidateRequestSchema = z.object({
  location: geoPointSchema,
  geofenceId: uuidSchema.optional(),
});

export const shiftCreateSchema = z.object({
  userId: uuidSchema,
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shiftStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  shiftEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  shiftType: z.enum(['standard', 'overtime', 'double']).default('standard'),
  requiredBreakMinutes: z.number().int().min(0).max(480).default(30),
  notes: z.string().max(1024).optional(),
});

export const inviteUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  role: roleSchema.default(ROLES.EMPLOYEE),
  payRate: z.number().nonnegative().optional(),
});

export const signupRequestSchema = z.object({
  organizationName: z.string().min(1).max(255),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(8).max(128),
  ownerFirstName: z.string().min(1).max(100).optional(),
  ownerLastName: z.string().min(1).max(100).optional(),
  timezone: z.string().default('UTC'),
  industry: z.string().max(64).optional(),
});

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

export const organizationUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  timezone: z.string().min(1).max(50).optional(),
  geofencingEnabled: z.boolean().optional(),
  breakTrackingEnabled: z.boolean().optional(),
});

export const syncBatchRequestSchema = z.object({
  deviceId: z.string().min(1),
  appVersion: z.string().optional(),
  clientTimestamp: z.number().int().nonnegative(),
  events: z
    .array(
      z.object({
        clientGeneratedId: z.string().min(1).max(128),
        eventType: eventTypeSchema,
        timestamp: isoTimestampSchema,
        eventData: z.record(z.unknown()),
      }),
    )
    .min(1)
    .max(50),
});

export type PunchInRequestInput = z.infer<typeof punchInRequestSchema>;
export type PunchOutRequestInput = z.infer<typeof punchOutRequestSchema>;
export type GeofenceCreateInput = z.infer<typeof geofenceCreateSchema>;
export type GeofenceValidateInput = z.infer<typeof geofenceValidateRequestSchema>;
export type ShiftCreateInput = z.infer<typeof shiftCreateSchema>;
export type InviteUserInput = z.infer<typeof inviteUserSchema>;
export type SignupRequestInput = z.infer<typeof signupRequestSchema>;
export type LoginRequestInput = z.infer<typeof loginRequestSchema>;
export type SyncBatchInput = z.infer<typeof syncBatchRequestSchema>;
