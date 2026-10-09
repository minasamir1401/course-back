import fs from 'fs';
import path from 'path';
import express from 'express';
import { rejectHeicDataImages } from '../src/lib/uploadImagePolicy';

jest.mock('../src/middleware/auth', () => ({
  verifyToken: (_req: unknown, _res: unknown, next: () => void) => next(),
  checkRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  checkSchoolAccess: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../src/lib/prisma', () => ({ __esModule: true, default: {} }));
jest.mock('../src/shared', () => ({
  ...jest.requireActual('../src/shared'),
  persistUpload: jest.fn(async (_filePath: string, filename: string) => ({ url: `/uploads/${filename}`, isCloud: false })),
}));

import systemRouter from '../src/routes/system';
import { UPLOADS_DIR, persistUpload } from '../src/shared';
const request = require('supertest');
const app = express();
app.use(express.json());
app.use('/api', rejectHeicDataImages);
app.use(systemRouter);
app.post('/api/test-content', (_req, res) => { res.json({ saved: true }); });

describe('upload and offline content HTTP behavior', () => {
  test.each(['image/heic', 'image/heif'])('rejects %s with a clear error and no file written', async mimetype => {
    const before = fs.readdirSync(UPLOADS_DIR);
    const response = await request(app).post('/api/upload').attach('file', Buffer.from('HEIC'), { filename: 'phone.jpg', contentType: mimetype });
    expect(response.status).toBe(400);
    expect(response.body.details).toMatch(/JPEG/);
    expect(fs.readdirSync(UPLOADS_DIR)).toEqual(before);
    expect(persistUpload).not.toHaveBeenCalled();
  });

  test('rejects a misleading MIME by extension', async () => {
    const response = await request(app).post('/api/upload').attach('file', Buffer.from('HEIC'), { filename: 'phone.HEIC', contentType: 'image/jpeg' });
    expect(response.status).toBe(400);
    expect(response.body.details).toMatch(/JPEG/);
  });

  test('removes a disguised HEIC container before local/cloud publishing', async () => {
    const before = fs.readdirSync(UPLOADS_DIR);
    const header = Buffer.alloc(20);
    header.writeUInt32BE(20, 0);
    header.write('ftypheic', 4);
    const response = await request(app).post('/api/upload').attach('file', header, { filename: 'phone.jpg', contentType: 'image/jpeg' });
    expect(response.status).toBe(415);
    expect(response.body.error).toMatch(/JPEG/);
    expect(fs.readdirSync(UPLOADS_DIR)).toEqual(before);
    expect(persistUpload).not.toHaveBeenCalled();
  });

  test('keeps normal PNG uploads and response metadata working', async () => {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const response = await request(app).post('/api/upload').attach('file', bytes, { filename: 'sample.png', contentType: 'image/png' });
    try {
      expect(response.status).toBe(200);
      expect(response.body.mimetype).toBe('image/png');
      expect(response.body.url).toMatch(/\.png$/);
      expect(response.body.size).toBe(bytes.length);
      expect(persistUpload).toHaveBeenCalledTimes(1);
    } finally {
      if (response.body.filename && path.basename(response.body.filename) === response.body.filename) fs.unlinkSync(path.join(UPLOADS_DIR, response.body.filename));
    }
  });

  test('rejects nested HEIF offline payloads but accepts supported inline images', async () => {
    const rejected = await request(app).post('/api/test-content').send({ questions: [{ text: '<img src="data:image/heif;base64,AAAA">' }] });
    expect(rejected.status).toBe(415);
    expect(rejected.body.error).toMatch(/JPEG/);
    const accepted = await request(app).post('/api/test-content').send({ image: 'data:image/png;base64,AAAA' });
    expect(accepted.status).toBe(200);
  });
});
