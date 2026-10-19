"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeEgyptSchedules = normalizeEgyptSchedules;
exports.egyptDates = egyptDates;
const egyptTime_1 = require("../utils/egyptTime");
const scheduleKeys = new Set(['startDate', 'endDate', 'publishDate', 'cutOffDate', 'availableFrom', 'availableTo', 'dueDate', 'scheduledAt']);
function normalizeEgyptSchedules(value) {
    if (Array.isArray(value))
        return value.map(normalizeEgyptSchedules);
    if (!value || typeof value !== 'object')
        return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
        if (scheduleKeys.has(key) && typeof item === 'string' && item)
            return [key, (0, egyptTime_1.parseEgyptDate)(item).toISOString()];
        return [key, normalizeEgyptSchedules(item)];
    }));
}
function egyptDates(req, res, next) {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method) || !req.is('application/json'))
        return next();
    try {
        req.body = normalizeEgyptSchedules(req.body);
        next();
    }
    catch (error) {
        res.status(400).json({ error: error.message, timeZone: 'Africa/Cairo' });
    }
}
