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
exports.runHourlyCloudBackupJob = runHourlyCloudBackupJob;
exports.initCronJobs = initCronJobs;
const node_cron_1 = __importDefault(require("node-cron"));
const db_backup_1 = require("../lib/db-backup");
const backups_controller_1 = require("../controllers/backups.controller");
let isRunningHourlyCron = false;
/** Hourly and manual backups use the same consistent, complete, paginated snapshot. */
function runHourlyCloudBackupJob() {
    return __awaiter(this, void 0, void 0, function* () {
        if (isRunningHourlyCron)
            return;
        isRunningHourlyCron = true;
        try {
            const result = yield (0, backups_controller_1.performBackupAndPruning)();
            console.log(`[Cron Service] Full snapshot saved: ${result.filename}`);
        }
        catch (error) {
            console.error('[Cron Service] Full backup failed:', error);
        }
        finally {
            isRunningHourlyCron = false;
        }
    });
}
function initCronJobs() {
    if (process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== '0')
        return;
    node_cron_1.default.schedule('0 * * * *', runHourlyCloudBackupJob);
    console.log('[Cron Service] Hourly full backup scheduler initialized.');
    if (!db_backup_1.CLOUD_BACKUP_ENABLED)
        console.log('[Cron Service] Cloud backup disabled; snapshots are local only.');
}
