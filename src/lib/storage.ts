import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';

/**
 * Cloud & Local Storage Adapter (Cloudflare R2 / AWS S3 / MinIO + Local Disk Fallback)
 *
 * When S3 / R2 environment variables are configured, media uploads and assets
 * can be stored directly on object storage (such as Cloudflare R2 with zero-egress fees).
 *
 * If credentials are not set, the adapter seamlessly falls back to storing
 * and serving files from the local uploads directory (`uploads/`).
 */

const S3_BUCKET = process.env.S3_BUCKET || process.env.R2_BUCKET;
const S3_ENDPOINT = process.env.S3_ENDPOINT || process.env.R2_ENDPOINT;
const S3_REGION = process.env.S3_REGION || 'auto'; // 'auto' is standard for Cloudflare R2
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;
const S3_PUBLIC_URL = process.env.S3_PUBLIC_URL || process.env.R2_PUBLIC_URL; // e.g. https://media.klevro.com

export const UPLOADS_LOCAL_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_LOCAL_DIR)) {
  fs.mkdirSync(UPLOADS_LOCAL_DIR, { recursive: true });
}

let s3Client: S3Client | null = null;

if (S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY) {
  try {
    s3Client = new S3Client({
      region: S3_REGION,
      endpoint: S3_ENDPOINT,
      credentials: {
        accessKeyId: S3_ACCESS_KEY_ID,
        secretAccessKey: S3_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true, // Needed for MinIO and R2 compatibility
    });
    console.log(`✅ [Storage] S3/R2 Object Storage client initialized for bucket "${S3_BUCKET}".`);
  } catch (err: any) {
    console.warn('⚠️ [Storage] Failed to initialize S3 client, falling back to local disk:', err.message);
    s3Client = null;
  }
} else {
  if (process.env.NODE_ENV === 'production' && process.env.NODE_APP_INSTANCE === '0') {
    console.log('ℹ️ [Storage] Running on local disk storage (uploads/). Set S3_BUCKET/R2_BUCKET to use Cloudflare R2.');
  }
}

export const isCloudStorageActive = (): boolean => s3Client !== null && Boolean(S3_BUCKET);

/**
 * Upload a local file to S3/R2 or retain on disk
 * Returns the public URL or relative local path
 */
export async function persistUpload(
  localFilePath: string,
  filename: string,
  mimeType?: string
): Promise<{ url: string; isCloud: boolean }> {
  // If S3/R2 is configured, stream file to bucket
  if (isCloudStorageActive() && s3Client) {
    try {
      const fileBuffer = fs.readFileSync(localFilePath);
      const command = new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: `uploads/${filename}`,
        Body: fileBuffer,
        ContentType: mimeType || 'application/octet-stream',
      });

      await s3Client.send(command);

      const publicUrl = S3_PUBLIC_URL
        ? `${S3_PUBLIC_URL.replace(/\/$/, '')}/uploads/${filename}`
        : S3_ENDPOINT
          ? `${S3_ENDPOINT.replace(/\/$/, '')}/${S3_BUCKET}/uploads/${filename}`
          : `/uploads/${filename}`;

      return { url: publicUrl, isCloud: true };
    } catch (err: any) {
      console.warn(`⚠️ [Storage] Cloud upload failed for ${filename}, retaining local copy:`, err.message);
      // Fallback to local
    }
  }

  // Local fallback URL
  return { url: `/uploads/${filename}`, isCloud: false };
}

/**
 * Delete a file from Cloud or local storage
 */
export async function deleteStoredFile(fileUrlOrName: string): Promise<void> {
  const filename = path.basename(fileUrlOrName);

  // 1. Delete from local disk if it exists
  const localPath = path.join(UPLOADS_LOCAL_DIR, filename);
  if (fs.existsSync(localPath)) {
    try {
      fs.unlinkSync(localPath);
    } catch {
      // Non-fatal
    }
  }

  // 2. Delete from S3/R2 if configured
  if (isCloudStorageActive() && s3Client) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: `uploads/${filename}`,
      });
      await s3Client.send(command);
    } catch (err: any) {
      console.warn(`⚠️ [Storage] Failed to delete cloud file ${filename}:`, err.message);
    }
  }
}

export default {
  isCloudStorageActive,
  persistUpload,
  deleteStoredFile,
};
