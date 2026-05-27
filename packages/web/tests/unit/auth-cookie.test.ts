import { serializeAuthCookie, clearAuthCookie } from '@/lib/auth';

describe('serializeAuthCookie', () => {
  it('sets the token with Path=/ and SameSite=Lax', () => {
    const cookie = serializeAuthCookie('tok123', { secure: false });
    expect(cookie).toContain('pc_token=tok123');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=');
  });

  it('appends Secure only in a secure (HTTPS) context', () => {
    expect(serializeAuthCookie('t', { secure: true })).toContain('; Secure');
    expect(serializeAuthCookie('t', { secure: false })).not.toContain('Secure');
  });

  it('URL-encodes the token value', () => {
    expect(serializeAuthCookie('a b/c', { secure: false })).toContain('pc_token=a%20b%2Fc');
  });
});

describe('clearAuthCookie', () => {
  it('expires the cookie with Max-Age=0 and matching attributes', () => {
    const cookie = clearAuthCookie({ secure: true });
    expect(cookie).toContain('pc_token=');
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('; Secure');
  });
});
