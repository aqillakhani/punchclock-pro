import { describe, it, expect } from '@jest/globals';
import bcrypt from 'bcrypt';
import {
  ipInAnyCidr,
  ipInCidr,
  verifyPunchCredentials,
} from '../../src/services/punch-verify.service.js';
import { AppError } from '../../src/lib/errors.js';

describe('ipInCidr() — IPv4 membership', () => {
  it('matches an IP inside a /24', () => {
    expect(ipInCidr('73.42.18.5', '73.42.18.0/24')).toBe(true);
    expect(ipInCidr('73.42.18.255', '73.42.18.0/24')).toBe(true);
  });

  it('rejects an IP outside the /24', () => {
    expect(ipInCidr('73.42.19.1', '73.42.18.0/24')).toBe(false);
  });

  it('respects narrower prefixes', () => {
    expect(ipInCidr('192.168.1.4', '192.168.1.0/30')).toBe(false);
    expect(ipInCidr('192.168.1.3', '192.168.1.0/30')).toBe(true);
  });

  it('allows everything with /0', () => {
    expect(ipInCidr('1.2.3.4', '0.0.0.0/0')).toBe(true);
  });

  it('strips Express IPv6-mapped IPv4 prefix', () => {
    expect(ipInCidr('::ffff:73.42.18.5', '73.42.18.0/24')).toBe(true);
  });

  it('treats ::1 as 127.0.0.1 for the prefix comparison', () => {
    expect(ipInCidr('::1', '127.0.0.0/8')).toBe(true);
    expect(ipInCidr('::1', '0.0.0.0/0')).toBe(true);
  });

  it('accepts ::/0 as a wildcard for any IP, including IPv6', () => {
    expect(ipInCidr('::1', '::/0')).toBe(true);
    expect(ipInCidr('2001:db8::1', '::/0')).toBe(true);
    expect(ipInCidr('8.8.8.8', '::/0')).toBe(true);
  });

  it('returns false on malformed input', () => {
    expect(ipInCidr('not-an-ip', '73.42.18.0/24')).toBe(false);
    expect(ipInCidr('73.42.18.5', 'bogus/24')).toBe(false);
    expect(ipInCidr('73.42.18.5', '73.42.18.0/99')).toBe(false);
  });
});

describe('ipInAnyCidr()', () => {
  it('passes if any CIDR matches', () => {
    expect(ipInAnyCidr('10.0.0.5', ['192.168.1.0/24', '10.0.0.0/24'])).toBe(true);
  });

  it('fails when no CIDR matches', () => {
    expect(ipInAnyCidr('172.16.0.5', ['192.168.1.0/24', '10.0.0.0/24'])).toBe(false);
  });

  it('returns false with an empty list', () => {
    expect(ipInAnyCidr('1.2.3.4', [])).toBe(false);
  });
});

describe('verifyPunchCredentials()', () => {
  const onshoreUser = { worksite: 'onshore' as const, pinHash: null };
  const offshoreUser = { worksite: 'offshore' as const, pinHash: null };
  const noMethods = { enabledMethods: [], allowedCidrs: [] };

  it('passes when no methods are enabled', async () => {
    await expect(
      verifyPunchCredentials({
        config: noMethods,
        user: onshoreUser,
        providedPin: undefined,
        clientIp: '73.42.19.1',
      }),
    ).resolves.toBeUndefined();
  });

  // ---- PIN ----

  it('passes with a correct PIN', async () => {
    const pinHash = await bcrypt.hash('4242', 4);
    await expect(
      verifyPunchCredentials({
        config: { enabledMethods: ['pin'], allowedCidrs: [] },
        user: { worksite: 'onshore', pinHash },
        providedPin: '4242',
        clientIp: null,
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects an incorrect PIN', async () => {
    const pinHash = await bcrypt.hash('4242', 4);
    await expect(
      verifyPunchCredentials({
        config: { enabledMethods: ['pin'], allowedCidrs: [] },
        user: { worksite: 'onshore', pinHash },
        providedPin: '9999',
        clientIp: null,
      }),
    ).rejects.toMatchObject({ code: 'PIN_INVALID' });
  });

  it('asks the user to set a PIN if pin_hash is null', async () => {
    let err: unknown;
    try {
      await verifyPunchCredentials({
        config: { enabledMethods: ['pin'], allowedCidrs: [] },
        user: { worksite: 'onshore', pinHash: null },
        providedPin: '1234',
        clientIp: null,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('PIN_REQUIRED');
  });

  it('asks for a PIN when one is required but not provided', async () => {
    const pinHash = await bcrypt.hash('4242', 4);
    await expect(
      verifyPunchCredentials({
        config: { enabledMethods: ['pin'], allowedCidrs: [] },
        user: { worksite: 'onshore', pinHash },
        providedPin: undefined,
        clientIp: null,
      }),
    ).rejects.toMatchObject({ code: 'PIN_REQUIRED' });
  });

  // ---- IP ----

  it('passes IP check when client IP is in an allowed CIDR', async () => {
    await expect(
      verifyPunchCredentials({
        config: { enabledMethods: ['ip'], allowedCidrs: ['73.42.18.0/24'] },
        user: onshoreUser,
        providedPin: undefined,
        clientIp: '73.42.18.99',
      }),
    ).resolves.toBeUndefined();
  });

  it('blocks IP check when client IP is outside every allowed CIDR', async () => {
    await expect(
      verifyPunchCredentials({
        config: { enabledMethods: ['ip'], allowedCidrs: ['73.42.18.0/24'] },
        user: onshoreUser,
        providedPin: undefined,
        clientIp: '8.8.8.8',
      }),
    ).rejects.toMatchObject({ code: 'IP_RESTRICTED' });
  });

  it('blocks IP check when client IP is missing', async () => {
    await expect(
      verifyPunchCredentials({
        config: { enabledMethods: ['ip'], allowedCidrs: ['73.42.18.0/24'] },
        user: onshoreUser,
        providedPin: undefined,
        clientIp: null,
      }),
    ).rejects.toMatchObject({ code: 'IP_RESTRICTED' });
  });

  it('auto-exempts offshore workers from IP rules', async () => {
    await expect(
      verifyPunchCredentials({
        config: { enabledMethods: ['ip'], allowedCidrs: ['73.42.18.0/24'] },
        user: offshoreUser,
        providedPin: undefined,
        clientIp: '8.8.8.8',
      }),
    ).resolves.toBeUndefined();
  });

  // ---- PIN + IP combined ----

  it('checks both methods when both are enabled', async () => {
    const pinHash = await bcrypt.hash('4242', 4);
    // PIN wrong but IP fine → still rejects.
    await expect(
      verifyPunchCredentials({
        config: { enabledMethods: ['pin', 'ip'], allowedCidrs: ['10.0.0.0/8'] },
        user: { worksite: 'onshore', pinHash },
        providedPin: '0000',
        clientIp: '10.1.1.1',
      }),
    ).rejects.toMatchObject({ code: 'PIN_INVALID' });

    // Both correct → passes.
    await expect(
      verifyPunchCredentials({
        config: { enabledMethods: ['pin', 'ip'], allowedCidrs: ['10.0.0.0/8'] },
        user: { worksite: 'onshore', pinHash },
        providedPin: '4242',
        clientIp: '10.1.1.1',
      }),
    ).resolves.toBeUndefined();
  });
});
