require('ts-node/register/transpile-only');

const fs = require('fs');
const path = require('path');
const { extractAndSaveBase64Images, UPLOADS_DIR } = require('../../../src/shared');

describe('Base64 image extraction and allowed MIME formats', () => {
  const sample1pxBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  test('extracts and saves HEIC base64 image data correctly to /uploads', () => {
    const inputHtml = `<p>Question with HEIC: <img src="data:image/heic;base64,${sample1pxBase64}" /></p>`;
    const processed = extractAndSaveBase64Images(inputHtml);

    expect(processed).not.toContain('data:image/heic;base64');
    expect(processed).toMatch(/\/uploads\/img_[a-f0-9]+\.heic/);

    const match = processed.match(/\/uploads\/(img_[a-f0-9]+\.heic)/);
    expect(match).not.toBeNull();
    const filePath = path.join(UPLOADS_DIR, match[1]);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('extracts AVIF, WEBP, and JPEG base64 images properly', () => {
    const inputPayload = {
      text: `data:image/avif;base64,${sample1pxBase64}`,
      imageUrl: `data:image/webp;base64,${sample1pxBase64}`,
      options: [`data:image/jpeg;base64,${sample1pxBase64}`]
    };

    const result = extractAndSaveBase64Images(inputPayload);

    expect(result.text).toMatch(/\/uploads\/img_[a-f0-9]+\.avif/);
    expect(result.imageUrl).toMatch(/\/uploads\/img_[a-f0-9]+\.webp/);
    expect(result.options[0]).toMatch(/\/uploads\/img_[a-f0-9]+\.jpg/);
  });

  test('does not extract SVG base64 to avoid XSS', () => {
    const inputSvg = `<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" />`;
    const result = extractAndSaveBase64Images(inputSvg);
    expect(result).toBe(inputSvg);
  });
});
