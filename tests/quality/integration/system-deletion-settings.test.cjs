const mockSettings = { findUnique: jest.fn(), upsert: jest.fn() };
jest.mock('../../../src/lib/prisma', () => ({ __esModule: true, default: { systemSetting: mockSettings } }));
const { isContentDeletionAllowed, setContentDeletionAllowed } = require('../../../src/services/systemSettings.service');
test('every policy check reads current settings, including a change by another worker', async () => {
  mockSettings.findUnique.mockResolvedValue({ value: 'false' });
  expect(await isContentDeletionAllowed()).toBe(false);
  mockSettings.findUnique.mockResolvedValue({ value: 'true' });
  expect(await isContentDeletionAllowed()).toBe(true);
  mockSettings.findUnique.mockResolvedValue({ value: 'false' });
  expect(await isContentDeletionAllowed()).toBe(false);
});
test('writes persist the policy and read failures cannot enable deletion', async () => {
  await setContentDeletionAllowed(true);
  expect(mockSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { value: 'true' } }));
  mockSettings.findUnique.mockRejectedValue(new Error('DB unavailable'));
  await expect(isContentDeletionAllowed()).rejects.toThrow('DB unavailable');
});
