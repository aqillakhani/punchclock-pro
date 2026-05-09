import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, Pressable } from 'react-native';
import { usePunch } from '@/hooks/usePunch';
import { useSyncStore } from '@/store/sync.store';
import { SyncIndicator } from '@/components/SyncIndicator';

export default function ClockScreen() {
  const { isOpen, loading, clockIn, clockOut, lastResult, refresh } = usePunch();
  const syncStatus = useSyncStore((s) => s.status);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  async function onPress() {
    setMessage(null);
    try {
      if (isOpen) {
        await clockOut();
        setMessage('Clocked out');
      } else {
        await clockIn();
        setMessage('Clocked in');
      }
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  return (
    <View style={styles.container}>
      <SyncIndicator status={syncStatus} />
      <Text style={styles.label}>Current status</Text>
      <Text style={styles.status}>{loading ? '…' : isOpen ? 'Clocked In' : 'Clocked Out'}</Text>
      <Pressable
        onPress={onPress}
        disabled={loading}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{isOpen ? 'Punch Out' : 'Punch In'}</Text>
        )}
      </Pressable>
      {message && <Text style={styles.message}>{message}</Text>}
      {lastResult && (
        <Text style={styles.footnote}>
          Last event at {new Date(lastResult.timestamp).toLocaleTimeString()}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#f8fafc' },
  label: { fontSize: 14, textTransform: 'uppercase', color: '#64748b', letterSpacing: 1 },
  status: { fontSize: 36, fontWeight: 'bold', color: '#0f172a', marginTop: 8, marginBottom: 48 },
  button: { backgroundColor: '#2563eb', paddingHorizontal: 48, paddingVertical: 20, borderRadius: 12, minWidth: 240, alignItems: 'center' },
  buttonPressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  buttonText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  message: { marginTop: 24, fontSize: 16, color: '#334155' },
  footnote: { marginTop: 8, fontSize: 12, color: '#94a3b8' },
});
