'use client';

import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

/**
 * Lazily connect to the real-time server. The caller must provide a
 * token — the server rejects unauthenticated sockets.
 */
export function getSocket(token: string | null): Socket | null {
  if (!token) return null;
  if (socket && socket.connected) return socket;
  const url = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000';
  socket = io(url, { auth: { token }, transports: ['websocket'] });
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
