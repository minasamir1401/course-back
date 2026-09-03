"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCloudStorageActive = exports.UPLOADS_LOCAL_DIR = void 0;
exports.persistUpload = persistUpload;
exports.deleteStoredFile = deleteStoredFile;
const client_s3_1 = require("@aws-sdk/client-s3");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
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
exports.UPLOADS_LOCAL_DIR = path_1.default.join(process.cwd(), 'uploads');
if (!fs_1.default.existsSync(exports.UPLOADS_LOCAL_DIR)) {
    fs_1.default.mkdirSync(exports.UPLOADS_LOCAL_DIR, { recursive: true });
}
let s3Client = null;
if (S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY) {
    try {
        s3Client = new client_s3_1.S3Client({
            region: S3_REGION,
            endpoint: S3_ENDPOINT,
            credentials: {
                accessKeyId: S3_ACCESS_KEY_ID,
                secretAccessKey: S3_SECRET_ACCESS_KEY,
            },
            forcePathStyle: true, // Needed for MinIO and R2 compatibility
        });
        console.log(`✅ [Storage] S3/R2 Object Storage client initialized for bucket "${S3_BUCKET}".`);
    }
    catch (err) {
        console.warn('⚠️ [Storage] Failed to initialize S3 client, falling back to local disk:', err.message);
        s3Client = null;
    }
}
else {
    if (process.env.NODE_ENV === 'production' && process.env.NODE_APP_INSTANCE === '0') {
        console.log('ℹ️ [Storage] Running on local disk storage (uploads/). Set S3_BUCKET/R2_BUCKET to use Cloudflare R2.');
    }
}
const isCloudStorageActive = () => s3Client !== null && Boolean(S3_BUCKET);
exports.isCloudStorageActive = isCloudStorageActive;
/**
 * Upload a local file to S3/R2 or retain on disk
 * Returns the public URL or relative local path
 */
function persistUpload(localFilePath, filename, mimeType) {
    return __awaiter(this, void 0, void 0, function* () {
        // If S3/R2 is configured, stream file to bucket
        if ((0, exports.isCloudStorageActive)() && s3Client) {
            try {
                const fileBuffer = fs_1.default.readFileSync(localFilePath);
                const command = new client_s3_1.PutObjectCommand({
                    Bucket: S3_BUCKET,
                    Key: `uploads/${filename}`,
                    Body: fileBuffer,
                    ContentType: mimeType || 'application/octet-stream',
                });
                yield s3Client.send(command);
                const publicUrl = S3_PUBLIC_URL
                    ? `${S3_PUBLIC_URL.replace(/\/$/, '')}/uploads/${filename}`
                    : S3_ENDPOINT
                        ? `${S3_ENDPOINT.replace(/\/$/, '')}/${S3_BUCKET}/uploads/${filename}`
                        : `/uploads/${filename}`;
                return { url: publicUrl, isCloud: true };
            }
            catch (err) {
                console.warn(`⚠️ [Storage] Cloud upload failed for ${filename}, retaining local copy:`, err.message);
                // Fallback to local
            }
        }
        // Local fallback URL
        return { url: `/uploads/${filename}`, isCloud: false };
    });
}
/**
 * Delete a file from Cloud or local storage
 */
function deleteStoredFile(fileUrlOrName) {
    return __awaiter(this, void 0, void 0, function* () {
        const filename = path_1.default.basename(fileUrlOrName);
        // 1. Delete from local disk if it exists
        const localPath = path_1.default.join(exports.UPLOADS_LOCAL_DIR, filename);
        if (fs_1.default.existsSync(localPath)) {
            try {
                fs_1.default.unlinkSync(localPath);
            }
            catch (_a) {
                // Non-fatal
            }
        }
        // 2. Delete from S3/R2 if configured
        if ((0, exports.isCloudStorageActive)() && s3Client) {
            try {
                const command = new client_s3_1.DeleteObjectCommand({
                    Bucket: S3_BUCKET,
                    Key: `uploads/${filename}`,
                });
                yield s3Client.send(command);
            }
            catch (err) {
                console.warn(`⚠️ [Storage] Failed to delete cloud file ${filename}:`, err.message);
            }
        }
    });
}
exports.default = {
    isCloudStorageActive: exports.isCloudStorageActive,
    persistUpload,
    deleteStoredFile,
};
