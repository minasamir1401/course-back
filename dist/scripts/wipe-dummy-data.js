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
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
function wipeDummyData() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Starting wipe of all dummy data...");
        const DUMMY_DOMAINS = ['alrowad', 'nile', 'almanara'];
        try {
            const dummySchools = yield prisma.school.findMany({
                where: {
                    subdomain: { in: DUMMY_DOMAINS }
                }
            });
            if (dummySchools.length === 0) {
                console.log("No dummy schools found. Database is clean.");
                return;
            }
            const schoolIds = dummySchools.map(s => s.id);
            console.log(`Found dummy schools:`, dummySchools.map(s => s.name).join(", "));
            const deletedUsers = yield prisma.user.deleteMany({
                where: { schoolId: { in: schoolIds } }
            });
            console.log(`Deleted users: ` + deletedUsers.count);
            yield prisma.lesson.deleteMany({
                where: { course: { schoolId: { in: schoolIds } } }
            });
            const deletedCourses = yield prisma.course.deleteMany({
                where: { schoolId: { in: schoolIds } }
            });
            console.log(`Deleted courses: ` + deletedCourses.count);
            const deletedClassrooms = yield prisma.classroom.deleteMany({
                where: { schoolId: { in: schoolIds } }
            });
            console.log(`Deleted classrooms: ` + deletedClassrooms.count);
            const deletedSchools = yield prisma.school.deleteMany({
                where: { id: { in: schoolIds } }
            });
            console.log(`Deleted schools: ` + deletedSchools.count);
            console.log("All dummy data wiped successfully!");
        }
        catch (error) {
            console.error("Error wiping dummy data:", error);
        }
        finally {
            yield prisma.$disconnect();
        }
    });
}
wipeDummyData();
