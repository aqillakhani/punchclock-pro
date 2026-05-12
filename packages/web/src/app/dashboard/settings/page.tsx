'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

interface OrgInfo {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  geofencing_enabled: boolean;
  break_tracking_enabled: boolean;
}

interface Geofence {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  enforcement_level: 'flag' | 'override' | 'block';
  is_active: boolean;
}

interface NewGeofenceForm {
  name: string;
  latitude: string;
  longitude: string;
  radiusMeters: string;
  enforcementLevel: 'flag' | 'override' | 'block';
}

const COMMON_TZ = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
];

export default function SettingsPage() {
  const qc = useQueryClient();

  const org = useQuery<OrgInfo>({
    queryKey: ['admin', 'organization'],
    queryFn: () => apiClient.get('/api/v1/admin/organization'),
  });

  const geofences = useQuery<Geofence[]>({
    queryKey: ['geofence', 'list'],
    queryFn: () => apiClient.get('/api/v1/geofence/locations'),
  });

  const [orgName, setOrgName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [geofencingOn, setGeofencingOn] = useState(false);
  const [breakTrackingOn, setBreakTrackingOn] = useState(false);
  const [orgMessage, setOrgMessage] = useState<string | null>(null);

  useEffect(() => {
    if (org.data) {
      setOrgName(org.data.name);
      setTimezone(org.data.timezone);
      setGeofencingOn(org.data.geofencing_enabled);
      setBreakTrackingOn(org.data.break_tracking_enabled);
    }
  }, [org.data]);

  const saveOrg = useMutation({
    mutationFn: (patch: Partial<OrgInfo>) =>
      apiClient.patch('/api/v1/admin/organization', {
        name: patch.name,
        timezone: patch.timezone,
        geofencingEnabled: patch.geofencing_enabled,
        breakTrackingEnabled: patch.break_tracking_enabled,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'organization'] });
      qc.invalidateQueries({ queryKey: ['auth', 'me'] });
      setOrgMessage('Saved');
      setTimeout(() => setOrgMessage(null), 2000);
    },
    onError: (e: Error) => setOrgMessage(e.message),
  });

  const [newGeofence, setNewGeofence] = useState<NewGeofenceForm>({
    name: '',
    latitude: '',
    longitude: '',
    radiusMeters: '100',
    enforcementLevel: 'flag',
  });
  const [geofenceError, setGeofenceError] = useState<string | null>(null);

  const createGeofence = useMutation({
    mutationFn: (input: NewGeofenceForm) =>
      apiClient.post('/api/v1/geofence/locations', {
        name: input.name.trim(),
        latitude: Number(input.latitude),
        longitude: Number(input.longitude),
        radiusMeters: Number(input.radiusMeters),
        enforcementLevel: input.enforcementLevel,
        isActive: true,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['geofence', 'list'] });
      setNewGeofence({
        name: '',
        latitude: '',
        longitude: '',
        radiusMeters: '100',
        enforcementLevel: 'flag',
      });
      setGeofenceError(null);
    },
    onError: (e: Error) => setGeofenceError(e.message),
  });

  const deleteGeofence = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/geofence/locations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['geofence', 'list'] }),
  });

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-600">
          Organization profile, tracking rules, and store locations.
        </p>
      </div>

      <Section title="Organization">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveOrg.mutate({
              name: orgName,
              timezone,
              geofencing_enabled: geofencingOn,
              break_tracking_enabled: breakTrackingOn,
            });
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Organization name">
              <input
                type="text"
                required
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Default timezone">
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className={inputClass}
              >
                {!COMMON_TZ.includes(timezone) && timezone && (
                  <option value={timezone}>{timezone}</option>
                )}
                {COMMON_TZ.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="flex flex-col gap-3">
            <Toggle
              checked={geofencingOn}
              onChange={setGeofencingOn}
              label="Geofencing enforcement"
              hint="When on, in-store workers must be within a configured geofence to punch in."
            />
            <Toggle
              checked={breakTrackingOn}
              onChange={setBreakTrackingOn}
              label="Break tracking"
              hint="Lets workers log breaks and tracks paid/unpaid time separately."
            />
          </div>
          <div className="flex items-center justify-end gap-3">
            {orgMessage && <span className="text-sm text-emerald-600">{orgMessage}</span>}
            <button type="submit" disabled={saveOrg.isPending} className={btnPrimary}>
              {saveOrg.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </Section>

      <Section
        title="Store locations (geofences)"
        subtitle="Workers in roles that punch on-site must be inside one of these zones."
      >
        <div className="overflow-hidden rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Coordinates</th>
                <th className="px-3 py-2 text-right">Radius</th>
                <th className="px-3 py-2 text-left">Enforcement</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {geofences.isLoading && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}
              {geofences.data && geofences.data.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-slate-500">
                    No locations yet — add your first below.
                  </td>
                </tr>
              )}
              {geofences.data?.map((g) => (
                <tr key={g.id} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-medium text-slate-900">{g.name}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">
                    {Number(g.latitude).toFixed(4)}, {Number(g.longitude).toFixed(4)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {g.radius_meters} m
                  </td>
                  <td className="px-3 py-2">
                    <EnforcementBadge level={g.enforcement_level} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Delete geofence "${g.name}"?`)) deleteGeofence.mutate(g.id);
                      }}
                      className="text-sm text-red-600 hover:text-red-800"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setGeofenceError(null);
            if (!newGeofence.name.trim()) {
              setGeofenceError('Name is required.');
              return;
            }
            const lat = Number(newGeofence.latitude);
            const lon = Number(newGeofence.longitude);
            const rad = Number(newGeofence.radiusMeters);
            if (Number.isNaN(lat) || lat < -90 || lat > 90) {
              setGeofenceError('Latitude must be between -90 and 90.');
              return;
            }
            if (Number.isNaN(lon) || lon < -180 || lon > 180) {
              setGeofenceError('Longitude must be between -180 and 180.');
              return;
            }
            if (!Number.isInteger(rad) || rad <= 0 || rad > 10000) {
              setGeofenceError('Radius must be a positive integer up to 10000 meters.');
              return;
            }
            createGeofence.mutate(newGeofence);
          }}
          className="mt-4 grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 md:grid-cols-5"
        >
          <Field label="Name">
            <input
              type="text"
              required
              value={newGeofence.name}
              onChange={(e) => setNewGeofence({ ...newGeofence, name: e.target.value })}
              className={inputClass}
              placeholder="Quick Stop #4"
            />
          </Field>
          <Field label="Latitude">
            <input
              type="number"
              step="0.000001"
              required
              value={newGeofence.latitude}
              onChange={(e) => setNewGeofence({ ...newGeofence, latitude: e.target.value })}
              className={inputClass}
              placeholder="29.74"
            />
          </Field>
          <Field label="Longitude">
            <input
              type="number"
              step="0.000001"
              required
              value={newGeofence.longitude}
              onChange={(e) => setNewGeofence({ ...newGeofence, longitude: e.target.value })}
              className={inputClass}
              placeholder="-95.46"
            />
          </Field>
          <Field label="Radius (m)">
            <input
              type="number"
              min={1}
              max={10000}
              required
              value={newGeofence.radiusMeters}
              onChange={(e) => setNewGeofence({ ...newGeofence, radiusMeters: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Enforcement">
            <select
              value={newGeofence.enforcementLevel}
              onChange={(e) =>
                setNewGeofence({
                  ...newGeofence,
                  enforcementLevel: e.target.value as 'flag' | 'override' | 'block',
                })
              }
              className={inputClass}
            >
              <option value="flag">Flag (record violation)</option>
              <option value="override">Override (warn but allow)</option>
              <option value="block">Block (reject punch)</option>
            </select>
          </Field>
          {geofenceError && (
            <div className="md:col-span-5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {geofenceError}
            </div>
          )}
          <div className="md:col-span-5 flex justify-end">
            <button type="submit" disabled={createGeofence.isPending} className={btnPrimary}>
              {createGeofence.isPending ? 'Adding…' : '+ Add location'}
            </button>
          </div>
        </form>
      </Section>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="mb-4 mt-1 text-sm text-slate-600">{subtitle}</p>}
      {!subtitle && <div className="mb-4" />}
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-white p-3 hover:bg-slate-50">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
      />
      <span>
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

function EnforcementBadge({ level }: { level: 'flag' | 'override' | 'block' }) {
  const styles: Record<typeof level, string> = {
    flag: 'bg-amber-50 text-amber-700 ring-amber-200',
    override: 'bg-blue-50 text-blue-700 ring-blue-200',
    block: 'bg-red-50 text-red-700 ring-red-200',
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ${styles[level]}`}
    >
      {level}
    </span>
  );
}

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200';

const btnPrimary =
  'rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-60';
