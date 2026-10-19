import { addCalendarDays, egyptDay, egyptDayStart, parseEgyptDate, reportRange } from '../src/utils/egyptTime';
import { normalizeEgyptSchedules } from '../src/middleware/egyptDates';

describe('Egypt calendar and real instants', () => {
  it('uses IANA daylight saving offsets rather than a fixed UTC offset', () => {
    expect(parseEgyptDate('2026-01-15T10:00').toISOString()).toBe('2026-01-15T08:00:00.000Z');
    expect(parseEgyptDate('2026-10-16T10:00').toISOString()).toBe('2026-10-16T07:00:00.000Z');
    expect(egyptDay('2026-10-15T22:30:00Z')).toBe('2026-10-16');
  });
  it('preserves explicit UTC/offset timestamps across saves', () => {
    expect(parseEgyptDate('2026-10-16T10:00:00+03:00').toISOString()).toBe('2026-10-16T07:00:00.000Z');
    expect(parseEgyptDate('2026-10-16T07:00:00Z').toISOString()).toBe('2026-10-16T07:00:00.000Z');
  });
  it('rejects invalid calendar dates, reversed ranges, and nonexistent clocks', () => {
    expect(() => parseEgyptDate('2026-02-30T10:00')).toThrow();
    expect(() => parseEgyptDate('2026-04-24T00:30')).toThrow(/does not exist/);
    expect(() => reportRange({ from: '2026-10-17', to: '2026-10-16' })).toThrow();
    expect(() => reportRange({ from: '2024-01-01', to: '2026-01-01' })).toThrow();
  });
  it('uses a 23-hour Egyptian day on spring transition and includes the whole end date', () => {
    expect(egyptDayStart('2026-04-24').toISOString()).toBe('2026-04-23T22:00:00.000Z');
    const range = reportRange({ from: '2026-04-24', to: '2026-04-24' });
    expect((range.end.getTime() - range.start.getTime()) / 3600000).toBe(23);
    expect(egyptDay(new Date(range.end.getTime() - 1))).toBe('2026-04-24');
  });
  it('uses the earlier repeated-hour instant consistently and spans the long day', () => {
    expect(parseEgyptDate('2026-10-29T23:30').toISOString()).toBe('2026-10-29T20:30:00.000Z');
    const range = reportRange({ from: '2026-10-29', to: '2026-10-29' });
    expect((range.end.getTime() - range.start.getTime()) / 3600000).toBe(25);
  });
  it('normalizes nested scheduling fields without changing IDs or unrelated text', () => {
    const body = { title: '2026-10-16', modules: [{ publishDate: '2026-10-16T10:00', questions: [{ id: 'q' }] }], startDate: null };
    expect(normalizeEgyptSchedules(body)).toEqual({ ...body, modules: [{ publishDate: '2026-10-16T07:00:00.000Z', questions: [{ id: 'q' }] }] });
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
