import { randomUUID } from 'node:crypto';
import { type AppEnv } from '../config/env.js';

/**
 * Document storage on an S3-compatible bucket (Cloudflare R2). The server
 * never handles file bytes — it issues short-lived presigned URLs and the
 * client uploads/downloads directly. Only the object KEY is stored in the
 * database (employee_documents.storage_url); manager views presign a fresh
 * GET on click. The AWS SDK is lazy-loaded so the pure helpers stay testable
 * without pulling in the (large) SDK.
 */

const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB

export function isAllowedContentType(contentType: string): boolean {
  return contentType in CONTENT_TYPE_EXT;
}

export function extensionForContentType(contentType: string): string {
  return CONTENT_TYPE_EXT[contentType] ?? 'bin';
}

export function buildObjectKey(args: {
  organizationId: string;
  userId: string;
  documentType: string;
  contentType: string;
}): string {
  const ext = extensionForContentType(args.contentType);
  return `org/${args.organizationId}/user/${args.userId}/${args.documentType}/${randomUUID()}.${ext}`;
}

export function isDocumentStorageConfigured(env: AppEnv): boolean {
  return Boolean(
    env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY,
  );
}

async function makeClient(env: AppEnv): Promise<import('@aws-sdk/client-s3').S3Client> {
  if (!isDocumentStorageConfigured(env)) {
    throw new Error('Document storage is not configured (set the S3_* env vars)');
  }
  const { S3Client } = await import('@aws-sdk/client-s3');
  return new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true, // R2-friendly
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    },
  });
}

export async function presignUpload(
  env: AppEnv,
  args: { key: string; contentType: string },
): Promise<string> {
  const client = await makeClient(env);
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  return getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: env.S3_BUCKET!, Key: args.key, ContentType: args.contentType }),
    { expiresIn: env.DOCUMENTS_PRESIGN_EXPIRY_SECONDS },
  );
}

export async function presignDownload(env: AppEnv, args: { key: string }): Promise<string> {
  const client = await makeClient(env);
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  return getSignedUrl(client, new GetObjectCommand({ Bucket: env.S3_BUCKET!, Key: args.key }), {
    expiresIn: env.DOCUMENTS_PRESIGN_EXPIRY_SECONDS,
  });
}
