const TOKEN_COOKIE = 'pc_token';
const TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24;

/**
 * SECURITY NOTE — this cookie is deliberately NOT httpOnly.
 *
 * The SPA reads the token back (see `getTokenFromDocument`) to send it as the
 * `Authorization` header on REST calls and as the Socket.io handshake
 * credential, so JavaScript must be able to read it. Making it httpOnly would
 * require the API to set the cookie server-side AND a separate websocket auth
 * path — tracked as future hardening. To limit exposure we always set
 * `Secure` (on HTTPS), `SameSite=Lax`, and `Path=/`, and the token is a
 * short-lived (24h) JWT.
 */
export function serializeAuthCookie(token: string, opts: { secure: boolean }): string {
  const parts = [
    `${TOKEN_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${TOKEN_MAX_AGE_SECONDS}`,
    'SameSite=Lax',
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearAuthCookie(opts: { secure: boolean }): string {
  const parts = [`${TOKEN_COOKIE}=`, 'Path=/', 'Max-Age=0', 'SameSite=Lax'];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

function isSecureContext(): boolean {
  return typeof location !== 'undefined' && location.protocol === 'https:';
}

export function setToken(token: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = serializeAuthCookie(token, { secure: isSecureContext() });
}

export function clearToken(): void {
  if (typeof document === 'undefined') return;
  document.cookie = clearAuthCookie({ secure: isSecureContext() });
}

export function getTokenFromDocument(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)pc_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]!) : null;
}
