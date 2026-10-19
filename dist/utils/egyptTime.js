"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REPORT_TIME_ZONE = void 0;
exports.egyptParts = egyptParts;
exports.egyptDay = egyptDay;
exports.addCalendarDays = addCalendarDays;
exports.parseEgyptDate = parseEgyptDate;
exports.egyptDayStart = egyptDayStart;
exports.reportRange = reportRange;
/** Persist instants in UTC; interpret calendar filters and timezone-less schedules in Egypt. */
exports.REPORT_TIME_ZONE = 'Africa/Cairo';
const partsFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: exports.REPORT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function egyptParts(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime()))
        throw new Error('Invalid date');
    return Object.fromEntries(partsFormatter.formatToParts(date).map(part => [part.type, part.value]));
}
function egyptDay(value = new Date()) {
    const p = egyptParts(value);
    return `${p.year}-${p.month}-${p.day}`;
}
function addCalendarDays(day, amount) {
    const date = new Date(`${day}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
        throw new Error('Invalid calendar date');
    }
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
}
function parseEgyptDate(value) {
    if (/^\d{4}-\d{2}-\d{2}/.test(value))
        addCalendarDays(value.slice(0, 10), 0);
    if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
        const date = new Date(value);
        if (!Number.isFinite(date.getTime()))
            throw new Error('Invalid date');
        return date;
    }
    const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(value);
    if (!match)
        throw new Error('Use an ISO date or Egyptian local date and time');
    addCalendarDays(match[1], 0);
    const clock = `${match[2] || '00'}:${match[3] || '00'}:${match[4] || '00'}`;
    const desired = Date.parse(`${match[1]}T${clock}Z`);
    if (!Number.isFinite(desired))
        throw new Error('Invalid time');
    // Search the actual IANA offsets instead of assuming Egypt is always UTC+2.
    const candidates = new Set();
    for (const delta of [-86400000, 0, 86400000]) {
        const probe = new Date(desired + delta);
        const p = egyptParts(probe);
        const localAsUTC = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
        candidates.add(desired - (localAsUTC - probe.getTime()));
    }
    const matches = [...candidates].sort((a, b) => a - b).filter(candidate => {
        const p = egyptParts(new Date(candidate));
        return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}` === `${match[1]}T${clock}`;
    });
    if (!matches.length)
        throw new Error('This local time does not exist in Egypt due to daylight saving time');
    // During a repeated hour choose the earlier instant consistently.
    return new Date(matches[0] + Number((match[5] || '').padEnd(3, '0')));
}
function egyptDayStart(day) {
    try {
        return parseEgyptDate(day);
    }
    catch (error) {
        // Cairo can advance from 23:59 directly to 01:00. The calendar day starts then.
        addCalendarDays(day, 0);
        return parseEgyptDate(`${day}T01:00`);
    }
}
function reportRange(query, now = new Date()) {
    const to = typeof query.to === 'string' ? query.to : egyptDay(now);
    const from = typeof query.from === 'string' ? query.from : addCalendarDays(to, -29);
    const start = egyptDayStart(from), end = egyptDayStart(addCalendarDays(to, 1));
    const span = (Date.parse(`${to}T12:00Z`) - Date.parse(`${from}T12:00Z`)) / 86400000;
    if (span < 0 || span > 365)
        throw new Error('Select a date range of 366 days or less');
    return { from, to, start, end, timeZone: exports.REPORT_TIME_ZONE };
}
