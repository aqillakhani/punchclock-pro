import { StyleSheet, Text, View } from 'react-native';
import type { SyncStatus } from '@/store/sync.store';

const LABELS: Record<SyncStatus, string> = {
  idle: 'Idle',
  syncing: 'Syncing…',
  synced: 'Up to date',
  offline: 'Offline',
  error: 'Sync error',
};

const COLORS: Record<SyncStatus, string> = {
  idle: '#94a3b8',
  syncing: '#2563eb',
  synced: '#16a34a',
  offline: '#f59e0b',
  error: '#dc2626',
};

export function SyncIndicator({ status }: { status: SyncStatus }) {
  return (
    <View style={[styles.pill, { backgroundColor: COLORS[status] + '22', borderColor: COLORS[status] }]}>
      <View style={[styles.dot, { backgroundColor: COLORS[status] }]} />
      <Text style={[styles.label, { color: COLORS[status] }]}>{LABELS[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    top: 60,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  label: { fontSize: 12, fontWeight: '600' },
});
