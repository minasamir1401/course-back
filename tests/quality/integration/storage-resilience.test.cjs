'use strict';

require('ts-node/register/transpile-only');
const fs = require('fs');
const path = require('path');

const {
  persistUpload,
  deleteStoredFile,
  UPLOADS_LOCAL_DIR,
} = require('../../../src/lib/storage');

describe('Storage Adapter Resilience (Local & Cloud Fallback)', () => {
  const testFilename = `test-file-${Date.now()}.txt`;
  const tempFilePath = path.join(UPLOADS_LOCAL_DIR, testFilename);

  beforeAll(() => {
    fs.writeFileSync(tempFilePath, 'Sample file content for storage test');
  });

  afterAll(() => {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  });

  test('successfully persists upload and returns valid file url', async () => {
    const result = await persistUpload(tempFilePath, testFilename, 'text/plain');
    expect(result).toHaveProperty('url');
    expect(typeof result.url).toBe('string');
    expect(result.url).toContain(testFilename);
  });

  test('safely deletes local and cloud references without errors', async () => {
    await expect(deleteStoredFile(testFilename)).resolves.not.toThrow();
  });
});
