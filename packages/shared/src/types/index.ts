import type {
  BreakType,
  CorrectionRequestType,
  CorrectionStatus,
  EventType,
  GeofenceEnforcement,
  Role,
  TimeEntryStatus,
} from '../constants/index.js';

export type UUID = string;
export type ISOTimestamp = string;

export interface GeoPoint {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface DeviceInfo {
  deviceId: string;
  platform: 'ios' | 'android' | 'web' | 'kiosk';
  appVersion?: string;
  userAgent?: string;
}

export interface Organization {
  id: UUID;
  name: string;
  slug: string;
  timezone: string;
  geofencingEnabled: boolean;
  breakTrackingEnabled: boolean;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

export interface User {
  id: UUID;
  organizationId: UUID;
  email: string;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  role: Role;
  payRate?: number | null;
  status: 'active' | 'inactive' | 'archived';
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

export interface Geofence {
  id: UUID;
  organizationId: UUID;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  enforcementLevel: GeofenceEnforcement;
  isActive: boolean;
  createdAt: ISOTimestamp;
}

export interface TimeEntry {
  id: UUID;
  organizationId: UUID;
  userId: UUID;
  punchInAt: ISOTimestamp;
  punchOutAt?: ISOTimestamp | null;
  punchInLocation?: GeoPoint | null;
  punchOutLocation?: GeoPoint | null;
  punchInGeofenceId?: UUID | null;
  punchOutGeofenceId?: UUID | null;
  /** PAYABLE minutes — gross less unpaid breaks. What payroll pays. */
  durationMinutes?: number | null;
  /** Wall-clock minutes between the punches, before break deduction. */
  grossMinutes?: number | null;
  /** Completed lunch/unpaid break minutes. Paid rest breaks excluded. */
  unpaidBreakMinutes: number;
  status: TimeEntryStatus;
  notes?: string | null;
  deviceInfo?: DeviceInfo | null;
  isManual: boolean;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

export interface TimeEntryEvent {
  id: UUID;
  organizationId: UUID;
  userId: UUID;
  eventType: EventType;
  eventData: Record<string, unknown>;
  clientGeneratedId?: string | null;
  recordedAt: ISOTimestamp;
  createdAt: ISOTimestamp;
}

/**
 * A worker's request to change a time record after the fact.
 *
 * Approving one never rewrites the immutable event log — it appends an
 * `entry_edited` event and updates the projection, so the originally
 * punched times remain recoverable.
 */
export interface TimeCorrectionRequest {
  id: UUID;
  organizationId: UUID;
  /** Whose time record this concerns. */
  userId: UUID;
  /** Who filed it — usually the same person, but a manager may file for a worker. */
  requestedBy: UUID;
  timeEntryId?: UUID | null;
  requestType: CorrectionRequestType;
  originalPunchInAt?: ISOTimestamp | null;
  originalPunchOutAt?: ISOTimestamp | null;
  requestedPunchInAt?: ISOTimestamp | null;
  requestedPunchOutAt?: ISOTimestamp | null;
  reason: string;
  status: CorrectionStatus;
  decidedBy?: UUID | null;
  decidedAt?: ISOTimestamp | null;
  decisionNote?: string | null;
  appliedEntryId?: UUID | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

export interface Break {
  id: UUID;
  organizationId: UUID;
  timeEntryId: UUID;
  breakStart: ISOTimestamp;
  breakEnd?: ISOTimestamp | null;
  durationMinutes?: number | null;
  breakType: BreakType;
  status: 'in_progress' | 'completed' | 'cancelled';
  createdAt: ISOTimestamp;
}

export interface Shift {
  id: UUID;
  organizationId: UUID;
  userId: UUID;
  scheduledDate: string; // YYYY-MM-DD
  shiftStart: string; // HH:mm
  shiftEnd: string; // HH:mm
  durationMinutes: number;
  shiftType: 'standard' | 'overtime' | 'double';
  requiredBreakMinutes: number;
  status: 'scheduled' | 'completed' | 'cancelled';
  notes?: string | null;
  createdAt: ISOTimestamp;
}

export interface PayRate {
  id: UUID;
  organizationId: UUID;
  userId: UUID;
  hourlyRate: number;
  overtimeMultiplier: number;
  effectiveDate: string;
  endDate?: string | null;
}

export interface PayrollRecord {
  id: UUID;
  organizationId: UUID;
  userId: UUID;
  periodStartDate: string;
  periodEndDate: string;
  regularHours: number;
  overtimeHours: number;
  regularPay: number;
  overtimePay: number;
  totalPay: number;
  status: 'draft' | 'submitted' | 'approved' | 'paid';
}

// ---- API envelope types ----

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiFailure {
  success: false;
  error: ApiError;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

// ---- Punch request DTOs ----

export interface PunchInRequest {
  clientGeneratedId: string;
  timestamp: ISOTimestamp;
  location?: GeoPoint;
  deviceInfo?: DeviceInfo;
  geofenceId?: UUID;
  overrideReason?: string;
  jobId?: UUID;
  notes?: string;
}

export interface PunchOutRequest {
  clientGeneratedId: string;
  timestamp: ISOTimestamp;
  location?: GeoPoint;
  deviceInfo?: DeviceInfo;
  notes?: string;
}

export interface GeofenceValidateRequest {
  location: GeoPoint;
  geofenceId?: UUID;
}

export interface GeofenceValidateResponse {
  inside: boolean;
  geofenceId?: UUID;
  distanceMeters: number;
  enforcementLevel: GeofenceEnforcement;
  allowed: boolean;
  reason?: string;
}

// ---- JWT claims ----

export interface AuthenticatedUser {
  userId: UUID;
  organizationId: UUID;
  role: Role;
  email: string;
}
