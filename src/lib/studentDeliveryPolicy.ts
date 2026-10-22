import sharp from 'sharp';
import { createHash } from 'crypto';

export const CERTIFICATE_MAX_BYTES = 8 * 1024 * 1024;
export function validPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    // Never send user-supplied URLs to arbitrary servers or internal networks.
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
      (host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' ||
        host === 'web.push.apple.com' || host.endsWith('.push.apple.com') ||
        host === 'wns.windows.com' || host.endsWith('.notify.windows.com'));
  } catch { return false; }
}

export function certificateScope(user: any) {
  if (user.role === 'STUDENT') return { studentId: user.id, revokedAt: null };
  if (user.role === 'SCHOOL_ADMIN' && user.schoolId) return { schoolId: user.schoolId };
  if (user.role === 'SUPER_ADMIN') return {};
  return null;
}

export async function prepareCertificate(buffer: Buffer, originalName: string) {
  if (!buffer.length || buffer.length > CERTIFICATE_MAX_BYTES) throw new Error('FILE_SIZE');
  let bytes: Buffer; let mimeType: string; let extension: string;
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    const text = buffer.toString('latin1');
    // PDF is always downloaded, never rendered in the app's origin. Reject active features too.
    const normalized = text.replace(/#([a-f\d]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    if (!/%%EOF\s*$/.test(text) || /\/(JavaScript|JS|Launch|OpenAction|AA|EmbeddedFile|RichMedia|XFA)\b/i.test(normalized)) throw new Error('UNSAFE_PDF');
    bytes = buffer; mimeType = 'application/pdf'; extension = 'pdf';
  } else {
    const image = sharp(buffer, { limitInputPixels: 24_000_000, animated: false });
    const meta = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(meta.format || '') || (meta.pages || 1) !== 1) throw new Error('FILE_TYPE');
    // Decode and re-encode: remove metadata and appended payloads, never accept SVG/HTML.
    // Compare two lossless encodings of the same raster; do not quantise text or colours.
    const raster = image.rotate().resize({ width: 4000, height: 4000, fit: 'inside', withoutEnlargement: true });
    const png = await raster.clone().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    const webp = await raster.clone().webp({ lossless: true, effort: 4 }).toBuffer();
    const useWebp = webp.length < png.length;
    bytes = useWebp ? webp : png;
    if (bytes.length > CERTIFICATE_MAX_BYTES) throw new Error('FILE_SIZE');
    mimeType = useWebp ? 'image/webp' : 'image/png'; extension = useWebp ? 'webp' : 'png';
  }
  const stem = originalName.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 100) || 'certificate';
  return { fileData: bytes.toString('base64'), byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mimeType, fileName: `${stem}.${extension}` };
}

export function readCertificateBytes(file: { fileData: string; byteSize: number; sha256: string; mimeType: string }) {
  if (typeof file.fileData !== 'string' || typeof file.sha256 !== 'string' || !Number.isInteger(file.byteSize)) throw new Error('CERTIFICATE_INTEGRITY');
  if (!['application/pdf', 'image/png', 'image/webp'].includes(file.mimeType) || !/^[a-f0-9]{64}$/.test(file.sha256) || file.byteSize < 1 || file.byteSize > CERTIFICATE_MAX_BYTES || file.fileData.length > 4 * Math.ceil(CERTIFICATE_MAX_BYTES / 3)) throw new Error('CERTIFICATE_INTEGRITY');
  const bytes = Buffer.from(file.fileData, 'base64');
  if (bytes.length !== file.byteSize || bytes.toString('base64') !== file.fileData || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('CERTIFICATE_INTEGRITY');
  return bytes;
}
