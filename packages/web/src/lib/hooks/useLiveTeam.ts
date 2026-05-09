'use client';

import { useEffect, useState } from 'react';
import { getSocket } from '@/lib/ws-client';

interface LiveTeamState {
  clockedIn: number;
  total: number;
  lastEvent: string | null;
}

/**
 * Subscribe to real-time punch events for the current organization.
 * This is a placeholder until the team directory API is wired up —
 * it listens for broadcast events and updates counts optimistically.
 */
export function useLiveTeam(): LiveTeamState {
  const [state, setState] = useState<LiveTeamState>({
    clockedIn: 0,
    total: 0,
    lastEvent: null,
  });

  useEffect(() => {
    const token =
      typeof document !== 'undefined'
        ? document.cookie.match(/(?:^|;\s*)pc_token=([^;]+)/)?.[1] ?? null
        : null;
    if (!token) return;
    const socket = getSocket(decodeURIComponent(token));
    if (!socket) return;

    const onIn = () =>
      setState((s) => ({
        ...s,
        clockedIn: s.clockedIn + 1,
        lastEvent: new Date().toLocaleTimeString(),
      }));
    const onOut = () =>
      setState((s) => ({
        ...s,
        clockedIn: Math.max(0, s.clockedIn - 1),
        lastEvent: new Date().toLocaleTimeString(),
      }));

    socket.on('time:punch-in', onIn);
    socket.on('time:punch-out', onOut);
    return () => {
      socket.off('time:punch-in', onIn);
      socket.off('time:punch-out', onOut);
    };
  }, []);

  return state;
}
