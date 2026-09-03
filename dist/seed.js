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
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma = new client_1.PrismaClient();
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        // Clean all garbage data
        yield prisma.user.deleteMany({ where: { username: "" } });
        yield prisma.school.deleteMany({ where: { name: { contains: "?" } } });
        const adminPassword = process.env.INITIAL_SUPER_ADMIN_PASSWORD;
        if (!adminPassword) {
            throw new Error('INITIAL_SUPER_ADMIN_PASSWORD is required for seeding the super admin');
        }
        const hashedPassword = yield bcryptjs_1.default.hash(adminPassword, 10);
        // Upsert ensures we reset the password even if user exists
        const superAdmin = yield prisma.user.upsert({
            where: { username: 'superadmin' },
            update: { password: hashedPassword },
            create: {
                name: 'مدير الموقع',
                username: 'superadmin',
                password: hashedPassword,
                role: 'SUPER_ADMIN',
            },
        });
        console.log('✅ Super Admin ready:', superAdmin.username);
        // Create some sample schools
        const schoolsData = [
            { name: 'مدرسة النهضة الحديثة', subdomain: 'nahda' },
            { name: 'مدرسة النور الدولية', subdomain: 'noor' },
            { name: 'مدرسة المستقبل للغات', subdomain: 'future' },
        ];
        for (const school of schoolsData) {
            yield prisma.school.upsert({
                where: { subdomain: school.subdomain },
                update: {},
                create: {
                    name: school.name,
                    subdomain: school.subdomain,
                    status: 'ACTIVE',
                }
            });
        }
        console.log('✅ Sample schools created');
        // Add some students to the first school
        const school = yield prisma.school.findFirst({ where: { subdomain: 'nahda' } });
        if (school) {
            const seedStudentPassword = process.env.SEED_USER_PASSWORD || adminPassword;
            const studentPassword = yield bcryptjs_1.default.hash(seedStudentPassword, 10);
            const studentsData = [
                { name: 'أحمد علي', username: 'ahmed.ali' },
                { name: 'سارة محمد', username: 'sara.mohamed' },
                { name: 'ياسين محمود', username: 'yassin.mah' },
            ];
            for (const student of studentsData) {
                yield prisma.user.upsert({
                    where: { username: student.username },
                    update: {},
                    create: {
                        name: student.name,
                        username: student.username,
                        password: studentPassword,
                        role: 'STUDENT',
                        schoolId: school.id,
                    }
                });
            }
            console.log('✅ Sample students created for Nahda school');
        }
    });
}
main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => __awaiter(void 0, void 0, void 0, function* () { yield prisma.$disconnect(); }));
