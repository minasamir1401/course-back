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
let dbUrl = process.env.DATABASE_URL || '';
if (dbUrl && !dbUrl.includes('connection_limit')) {
    dbUrl += (dbUrl.includes('?') ? '&' : '?') + 'connection_limit=5&pool_timeout=15';
}
// Base Prisma Client
const basePrisma = new client_1.PrismaClient({
    datasources: {
        db: { url: dbUrl }
    }
});
// Create an extended Prisma Client for Global Soft Deletes
const prisma = basePrisma.$extends({
    query: {
        course: {
            findMany(_a) {
                return __awaiter(this, arguments, void 0, function* ({ args, query }) {
                    var _b;
                    if (((_b = args.where) === null || _b === void 0 ? void 0 : _b.deletedAt) === undefined) {
                        args.where = Object.assign(Object.assign({}, args.where), { deletedAt: null });
                    }
                    return query(args);
                });
            },
            findFirst(_a) {
                return __awaiter(this, arguments, void 0, function* ({ args, query }) {
                    var _b;
                    if (((_b = args.where) === null || _b === void 0 ? void 0 : _b.deletedAt) === undefined) {
                        args.where = Object.assign(Object.assign({}, args.where), { deletedAt: null });
                    }
                    return query(args);
                });
            },
            findUnique(_a) {
                return __awaiter(this, arguments, void 0, function* ({ args, query }) {
                    var _b;
                    if (((_b = args.where) === null || _b === void 0 ? void 0 : _b.deletedAt) === undefined) {
                        args.where = Object.assign(Object.assign({}, args.where), { deletedAt: null });
                    }
                    return query(args);
                });
            },
            count(_a) {
                return __awaiter(this, arguments, void 0, function* ({ args, query }) {
                    var _b;
                    if (((_b = args.where) === null || _b === void 0 ? void 0 : _b.deletedAt) === undefined) {
                        args.where = Object.assign(Object.assign({}, args.where), { deletedAt: null });
                    }
                    return query(args);
                });
            },
            delete(_a) {
                return __awaiter(this, arguments, void 0, function* ({ args, query }) {
                    // Intercept delete and turn it into a soft delete (update)
                    return basePrisma.course.update({
                        where: args.where,
                        data: { deletedAt: new Date() },
                    });
                });
            },
            deleteMany(_a) {
                return __awaiter(this, arguments, void 0, function* ({ args, query }) {
                    return basePrisma.course.updateMany({
                        where: args.where,
                        data: { deletedAt: new Date() },
                    });
                });
            }
        },
        lesson: {
            findMany(_a) {
                return __awaiter(this, arguments, void 0, function* ({ args, query }) {
                    var _b;
                    if (((_b = args.where) === null || _b === void 0 ? void 0 : _b.deletedAt) === undefined) {
                        args.where = Object.assign(Object.assign({}, args.where), { deletedAt: null });
                    }
                    return query(args);
                });
            },
            findFirst(_a) {
                return __awaiter(this, arguments, void 0, function* ({ args, query }) {
                    var _b;
                    if (((_b = args.where) === null || _b === void 0 ? void 0 : _b.deletedAt) === undefined) {
                        args.where = Object.assign(Object.assign({}, args.where), { deletedAt: null });
                    }
                    return query(args);
                });
            },
            findUnique(_a) {
                return __awaiter(this, arguments, void 0, function* ({ args, query }) {
                    var _b;
                    if (((_b = args.where) === null || _b === void 0 ? void 0 : _b.deletedAt) === undefined) {
                        args.where = Object.assign(Object.assign({}, args.where), { deletedAt: null });
                    }
                    return query(args);
                });
            },
            count(_a) {
                return __awaiter(this, arguments, void 0, function* ({ args, query }) {
                    var _b;
                    if (((_b = args.where) === null || _b === void 0 ? void 0 : _b.deletedAt) === undefined) {
                        args.where = Object.assign(Object.assign({}, args.where), { deletedAt: null });
                    }
                    return query(args);
                });
            },
            delete(_a) {
                return __awaiter(this, arguments, void 0, function* ({ args, query }) {
                    return basePrisma.lesson.update({
                        where: args.where,
                        data: { deletedAt: new Date() },
                    });
                });
            },
            deleteMany(_a) {
                return __awaiter(this, arguments, void 0, function* ({ args, query }) {
                    return basePrisma.lesson.updateMany({
                        where: args.where,
                        data: { deletedAt: new Date() },
                    });
                });
            }
        }
    }
});
exports.default = prisma;
