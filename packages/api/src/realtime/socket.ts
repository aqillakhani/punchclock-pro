import type http from 'node:http';
import { Server } from 'socket.io';
import { verifyAppJwt } from '../middleware/auth.js';
import { logger } from '../config/logger.js';

let io: Server | null = null;

/**
 * Attach a Socket.io server to the existing HTTP server. Each socket
 * authenticates via JWT (either the `auth.token` handshake field or
 * the `Authorization` header). Authenticated sockets are joined to
 * `org:<id>` (broadcast room) and `user:<id>` (direct messages).
 *
 * In production the Redis adapter should be installed so broadcasts
 * fan out across multiple API instances — that wiring lives in
 * `index.ts` and is conditional on REDIS_URL being set.
 */
export function createSocketServer(httpServer: http.Server, corsOrigins: string[]): Server {
  io = new Server(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });

  io.use((socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (typeof socket.handshake.headers.authorization === 'string'
          ? socket.handshake.headers.authorization.replace(/^Bearer\s+/i, '')
          : undefined);
      if (!token) return next(new Error('missing_token'));
      const user = verifyAppJwt(token);
      socket.data.user = user;
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as ReturnType<typeof verifyAppJwt>;
    socket.join(`org:${user.organizationId}`);
    socket.join(`user:${user.userId}`);
    logger.debug({ userId: user.userId }, 'socket connected');

    socket.on('disconnect', () => {
      logger.debug({ userId: user.userId }, 'socket disconnected');
    });
  });

  return io;
}

export function getIo(): Server | null {
  return io;
}

/** Broadcast a time-tracking event to everyone in the organization. */
export function broadcastTimeEvent(
  organizationId: string,
  event: string,
  payload: Record<string, unknown>,
): void {
  io?.to(`org:${organizationId}`).emit(event, payload);
}
