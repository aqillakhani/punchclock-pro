'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

interface ApiUser {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: 'owner' | 'manager' | 'employee' | 'viewer';
  status: 'active' | 'inactive' | 'archived';
}

interface ApiShift {
  id: string;
  user_id: string;
  scheduled_date: string;
  shift_start: string;
  shift_end: string;
  duration_minutes: number;
  shift_type: 'standard' | 'overtime' | 'double';
  status: string;
}

interface NewShiftForm {
  userId: string;
  scheduledDate: string;
  shiftStart: string;
  shiftEnd: string;
  shiftType: 'standard' | 'overtime' | 'double';
  notes: string;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function SchedulePage() {
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<NewShiftForm>(() => emptyForm(weekStart));
  const [formError, setFormError] = useState<string | null>(null);

  const days = useMemo(() => buildDays(weekStart), [weekStart]);
  const fromIso = days[0]!.iso;
  const toIso = days[6]!.iso;

  const users = useQuery<ApiUser[]>({
    queryKey: ['admin', 'users'],
    queryFn: () => apiClient.get('/api/v1/admin/users'),
  });
  const shifts = useQuery<ApiShift[]>({
    queryKey: ['scheduling', 'shifts', fromIso, toIso],
    queryFn: () => apiClient.get(`/api/v1/scheduling/shifts?from=${fromIso}&to=${toIso}`),
  });

  const createShift = useMutation({
    mutationFn: (input: NewShiftForm) =>
      apiClient.post('/api/v1/scheduling/shifts', {
        userId: input.userId,
        scheduledDate: input.scheduledDate,
        shiftStart: input.shiftStart,
        shiftEnd: input.shiftEnd,
        shiftType: input.shiftType,
        requiredBreakMinutes: 30,
        notes: input.notes.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scheduling', 'shifts'] });
      setModalOpen(false);
      setForm(emptyForm(weekStart));
      setFormError(null);
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const deleteShift = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/scheduling/shifts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduling', 'shifts'] }),
  });

  const userById = useMemo(() => {
    const map = new Map<string, ApiUser>();
    for (const u of users.data ?? []) map.set(u.id, u);
    return map;
  }, [users.data]);

  const activeUsers = useMemo(
    () => (users.data ?? []).filter((u) => u.status === 'active'),
    [users.data],
  );

  const shiftsByCell = useMemo(() => {
    const map = new Map<string, ApiShift[]>();
    for (const s of shifts.data ?? []) {
      const key = `${s.user_id}|${s.scheduled_date}`;
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return map;
  }, [shifts.data]);

  function openModalForCell(userId: string, dateIso: string) {
    setForm({
      userId,
      scheduledDate: dateIso,
      shiftStart: '09:00',
      shiftEnd: '17:00',
      shiftType: 'standard',
      notes: '',
    });
    setFormError(null);
    setModalOpen(true);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Schedule</h1>
          <p className="text-sm text-slate-600">
            Week of {fmtLongDate(days[0]!.date)} – {fmtLongDate(days[6]!.date)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            className={btnGhost}
          >
            ← Prev
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(startOfWeek(new Date()))}
            className={btnGhost}
          >
            This week
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            className={btnGhost}
          >
            Next →
          </button>
          <button
            type="button"
            onClick={() => {
              setForm(emptyForm(weekStart));
              setFormError(null);
              setModalOpen(true);
            }}
            className={btnPrimary}
          >
            + Add shift
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-44 px-4 py-3 text-left">Employee</th>
                {days.map((d) => (
                  <th key={d.iso} className="px-2 py-3 text-left">
                    <div>{DAY_LABELS[d.dayOfWeekMon]}</div>
                    <div className="text-slate-400">{d.date.getDate()}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.isLoading && (
                <tr>
                  <td colSpan={8} className="p-6 text-slate-500">
                    Loading employees…
                  </td>
                </tr>
              )}
              {activeUsers.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <div>{displayName(u)}</div>
                    <div className="text-xs capitalize text-slate-500">{u.role}</div>
                  </td>
                  {days.map((d) => {
                    const cellShifts = shiftsByCell.get(`${u.id}|${d.iso}`) ?? [];
                    return (
                      <td key={d.iso} className="align-top px-1 py-2">
                        <div className="flex min-h-[3rem] flex-col gap-1">
                          {cellShifts.map((s) => (
                            <ShiftChip
                              key={s.id}
                              shift={s}
                              onDelete={() => deleteShift.mutate(s.id)}
                            />
                          ))}
                          <button
                            type="button"
                            onClick={() => openModalForCell(u.id, d.iso)}
                            className="rounded border border-dashed border-slate-200 px-2 py-1 text-xs text-slate-400 hover:border-brand-300 hover:text-brand-600"
                          >
                            +
                          </button>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {activeUsers.length === 0 && !users.isLoading && (
                <tr>
                  <td colSpan={8} className="p-6 text-slate-500">
                    No active employees yet — add one from the Team page.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <Modal onClose={() => setModalOpen(false)} title="Add shift">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setFormError(null);
              if (!form.userId) {
                setFormError('Pick an employee.');
                return;
              }
              if (form.shiftStart >= form.shiftEnd) {
                setFormError('Shift end must be after shift start.');
                return;
              }
              createShift.mutate(form);
            }}
            className="space-y-4"
          >
            <Field label="Employee">
              <select
                required
                value={form.userId}
                onChange={(e) => setForm({ ...form, userId: e.target.value })}
                className={inputClass}
              >
                <option value="">— Select —</option>
                {activeUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {displayName(u)} ({u.role})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date">
              <input
                type="date"
                required
                value={form.scheduledDate}
                onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })}
                className={inputClass}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start">
                <input
                  type="time"
                  required
                  value={form.shiftStart}
                  onChange={(e) => setForm({ ...form, shiftStart: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="End">
                <input
                  type="time"
                  required
                  value={form.shiftEnd}
                  onChange={(e) => setForm({ ...form, shiftEnd: e.target.value })}
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label="Type">
              <select
                value={form.shiftType}
                onChange={(e) =>
                  setForm({ ...form, shiftType: e.target.value as NewShiftForm['shiftType'] })
                }
                className={inputClass}
              >
                <option value="standard">Standard</option>
                <option value="overtime">Overtime</option>
                <option value="double">Double</option>
              </select>
            </Field>
            <Field label="Notes (optional)">
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className={inputClass}
                placeholder="e.g. Cover register 2"
              />
            </Field>
            {formError && (
              <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setModalOpen(false)} className={btnGhost}>
                Cancel
              </button>
              <button type="submit" disabled={createShift.isPending} className={btnPrimary}>
                {createShift.isPending ? 'Adding…' : 'Add shift'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function ShiftChip({ shift, onDelete }: { shift: ApiShift; onDelete: () => void }) {
  const tone =
    shift.shift_type === 'overtime'
      ? 'bg-amber-50 text-amber-800 ring-amber-200'
      : shift.shift_type === 'double'
        ? 'bg-purple-50 text-purple-800 ring-purple-200'
        : 'bg-brand-50 text-brand-800 ring-brand-200';
  return (
    <div className={`group relative rounded px-2 py-1 text-xs ring-1 ${tone}`}>
      <div className="font-medium">
        {fmtTime(shift.shift_start)}–{fmtTime(shift.shift_end)}
      </div>
      <div className="text-[10px] capitalize opacity-80">{shift.shift_type}</div>
      <button
        type="button"
        onClick={onDelete}
        className="absolute -right-1 -top-1 hidden h-4 w-4 rounded-full bg-white text-[10px] leading-none text-red-600 shadow ring-1 ring-red-200 group-hover:flex group-hover:items-center group-hover:justify-center"
        aria-label="Delete shift"
      >
        ×
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = (day + 6) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildDays(weekStart: Date): { iso: string; date: Date; dayOfWeekMon: number }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    return { iso: toIsoDate(date), date, dayOfWeekMon: i };
  });
}

function emptyForm(weekStart: Date): NewShiftForm {
  return {
    userId: '',
    scheduledDate: toIsoDate(weekStart),
    shiftStart: '09:00',
    shiftEnd: '17:00',
    shiftType: 'standard',
    notes: '',
  };
}

function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const ampm = h >= 12 ? 'p' : 'a';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

function fmtLongDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function displayName(u: ApiUser): string {
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return name || u.email;
}

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200';

const btnPrimary =
  'rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-60';

const btnGhost =
  'rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50';
