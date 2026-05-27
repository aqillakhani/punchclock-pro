import { describe, it, expect } from '@jest/globals';
import {
  isAllowedContentType,
  extensionForContentType,
  buildObjectKey,
  isDocumentStorageConfigured,
  presignUpload,
} from '../../src/services/document-storage.service.js';
import { parseEnv } from '../../src/config/env.js';

const configuredEnv = parseEnv({
  DATABASE_URL: 'postgres://x',
  S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  S3_BUCKET: 'docs',
  S3_ACCESS_KEY_ID: 'AKIA_TEST',
  S3_SECRET_ACCESS_KEY: 'secret_test',
});

describe('isAllowedContentType()', () => {
  it('allows JPEG, PNG, and PDF', () => {
    expect(isAllowedContentType('image/jpeg')).toBe(true);
    expect(isAllowedContentType('image/png')).toBe(true);
    expect(isAllowedContentType('application/pdf')).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isAllowedContentType('text/html')).toBe(false);
    expect(isAllowedContentType('application/octet-stream')).toBe(false);
  });
});

describe('extensionForContentType()', () => {
  it('maps content types to file extensions', () => {
    expect(extensionForContentType('image/jpeg')).toBe('jpg');
    expect(extensionForContentType('application/pdf')).toBe('pdf');
  });
});

describe('buildObjectKey()', () => {
  it('namespaces by org, user, and document type, ending in the right extension', () => {
    const key = buildObjectKey({
      organizationId: 'org1',
      userId: 'user1',
      documentType: 'food_handler',
      contentType: 'application/pdf',
    });
    expect(key).toMatch(/^org\/org1\/user\/user1\/food_handler\/[0-9a-f-]+\.pdf$/);
  });

  it('produces a unique key each call', () => {
    const args = {
      organizationId: 'o',
      userId: 'u',
      documentType: 'i9',
      contentType: 'image/jpeg',
    };
    expect(buildObjectKey(args)).not.toBe(buildObjectKey(args));
  });
});

describe('isDocumentStorageConfigured()', () => {
  it('false when S3 vars are unset', () => {
    expect(isDocumentStorageConfigured(parseEnv({ DATABASE_URL: 'postgres://x' }))).toBe(false);
  });
  it('true when endpoint, bucket, and credentials are all present', () => {
    expect(isDocumentStorageConfigured(configuredEnv)).toBe(true);
  });
});

describe('presignUpload()', () => {
  it('returns a signed URL containing the object key', async () => {
    const url = await presignUpload(configuredEnv, {
      key: 'org/o/user/u/i9/abc.pdf',
      contentType: 'application/pdf',
    });
    expect(url).toMatch(/^https:\/\//);
    expect(url).toContain('org/o/user/u/i9/abc.pdf');
    expect(url).toContain('X-Amz-Signature');
  });

  it('throws when storage is not configured', async () => {
    await expect(
      presignUpload(parseEnv({ DATABASE_URL: 'postgres://x' }), {
        key: 'k',
        contentType: 'application/pdf',
      }),
    ).rejects.toThrow(/not configured/i);
  });
});
