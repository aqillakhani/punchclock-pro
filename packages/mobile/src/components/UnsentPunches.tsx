import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSyncStore } from '@/store/sync.store';
import { tryGetSyncService } from '@/services/sync.service';

/**
 * Tells the worker about punches still sitting on the device.
 *
 * Queued punches are normal and self-healing — they say so quietly.
 * Failed punches are the ones that exhausted their retry budget against
 * a server that was answering with errors; they never send again on
 * their own, so they get an explicit retry. Without this the queue could
 * park a punch permanently with nothing on screen to show for it.
 */
export function UnsentPunches() {
  const queueSize = useSyncStore((s) => s.queueSize);
  const failedCount = useSyncStore((s) => s.failedCount);
  const setFailedCount = useSyncStore((s) => s.setFailedCount);
  const setQueueSize = useSyncStore((s) => s.setQueueSize);
  const [retrying, setRetrying] = useState(false);

  if (queueSize === 0 && failedCount === 0) return null;

  async function onRetry() {
    const service = tryGetSyncService();
    if (!service) return;
    setRetrying(true);
    try {
      await service.retryFailed();
      await service.flush();
      setQueueSize(await service.queueSize());
      setFailedCount(await service.failedCount());
    } catch {
      // Leave the banner up: the counts below are still accurate and the
      // worker can try again.
    } finally {
      setRetrying(false);
    }
  }

  const failing = failedCount > 0;

  return (
    <View style={[styles.card, failing ? styles.cardFailed : styles.cardQueued]}>
      <Text style={[styles.title, failing ? styles.titleFailed : styles.titleQueued]}>
        {failing
          ? `${failedCount} punch${failedCount === 1 ? '' : 'es'} need${failedCount === 1 ? 's' : ''} attention`
          : `${queueSize} punch${queueSize === 1 ? '' : 'es'} waiting to send`}
      </Text>
      <Text style={styles.body}>
        {failing
          ? 'These are saved on your phone but the server kept rejecting them. Nothing is lost — tap to try again.'
          : 'Saved on your phone. They send automatically as soon as you have a connection.'}
      </Text>
      {failing && (
        <Pressable
          onPress={onRetry}
          disabled={retrying}
          style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
        >
          {retrying ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.buttonText}>Try again</Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 20,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  cardQueued: { backgroundColor: '#fffbeb', borderColor: '#fcd34d' },
  cardFailed: { backgroundColor: '#fef2f2', borderColor: '#fca5a5' },
  title: { fontSize: 15, fontWeight: '700' },
  titleQueued: { color: '#92400e' },
  titleFailed: { color: '#991b1b' },
  body: { marginTop: 4, fontSize: 13, color: '#475569', lineHeight: 18 },
  button: {
    marginTop: 12,
    backgroundColor: '#dc2626',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
