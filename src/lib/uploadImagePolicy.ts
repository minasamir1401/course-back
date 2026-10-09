import type { RequestHandler } from 'express';

export const UNSUPPORTED_HEIC_MESSAGE = 'صور HEIC/HEIF غير مدعومة. حوّل الصورة إلى JPEG أو PNG أو WebP ثم ارفعها. / HEIC/HEIF images are not supported. Convert to JPEG, PNG or WebP before uploading.';

export function isHeicUpload(file: { originalname: string; mimetype: string }): boolean {
  return /^image\/hei[cf](?:-sequence)?$/i.test(file.mimetype.trim()) || /\.hei[cf]$/i.test(file.originalname);
}

export function hasHeicSignature(header: Buffer): boolean {
  if (header.length < 12 || header.toString('ascii', 4, 8) !== 'ftyp') return false;
  const boxEnd = Math.min(header.readUInt32BE(0), header.length);
  for (let offset = 8; offset + 4 <= boxEnd; offset += 4) {
    if (offset === 12) continue; // minor version, not a compatible brand
    if (/^(heic|heix|hevc|hevx|heim|heis|hevm|hevs)$/.test(header.toString('ascii', offset, offset + 4))) return true;
  }
  return false;
}

export function containsHeicDataImage(value: unknown): boolean {
  if (typeof value === 'string') return /data:image\/hei[cf](?:-sequence)?;base64,/i.test(value);
  if (Array.isArray(value)) return value.some(containsHeicDataImage);
  if (value && typeof value === 'object') return Object.values(value).some(containsHeicDataImage);
  return false;
}

/** Reject inline images before offline/JSON saves can externalize them to disk. */
export const rejectHeicDataImages: RequestHandler = (req, res, next) => {
  if (containsHeicDataImage(req.body)) {
    res.status(415).json({ error: UNSUPPORTED_HEIC_MESSAGE });
    return;
  }
  next();
};
