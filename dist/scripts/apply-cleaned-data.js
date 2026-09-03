"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const prisma = new client_1.PrismaClient();
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const jsonPath = process.argv[2];
        if (!jsonPath) {
            console.error('❌ Please provide the path to final_cleaned_website_backup.json as an argument.');
            console.error('Usage: npx ts-node src/scripts/apply-cleaned-data.ts <path-to-json>');
            process.exit(1);
        }
        const fullPath = path.resolve(jsonPath);
        if (!fs.existsSync(fullPath)) {
            console.error(`❌ File not found: ${fullPath}`);
            process.exit(1);
        }
        console.log(`\n======================================================`);
        console.log(`🧹 APPLYING CLEANED DATABASE BACKUP`);
        console.log(`======================================================\n`);
        console.log(`📂 Loading data from: ${fullPath}...`);
        const fileData = fs.readFileSync(fullPath, 'utf8');
        const backup = JSON.parse(fileData);
        const questions = ((_a = backup.data) === null || _a === void 0 ? void 0 : _a.question) || [];
        const lessonBlocks = ((_b = backup.data) === null || _b === void 0 ? void 0 : _b.lessonBlock) || [];
        console.log(`✅ Loaded ${questions.length} questions and ${lessonBlocks.length} slides.`);
        console.log(`\n⏳ Updating database...\n`);
        let qUpdated = 0;
        for (const q of questions) {
            if (!q.id)
                continue;
            try {
                yield prisma.question.update({
                    where: { id: q.id },
                    data: {
                        text: q.text,
                        options: q.options,
                        correctAnswer: q.correctAnswer,
                        explanation: q.explanation,
                        skill: q.skill,
                        level: q.level,
                        indicator: q.indicator,
                        standard: q.standard,
                        learningOutcome: q.learningOutcome,
                        dok: q.dok
                    }
                });
                qUpdated++;
                if (qUpdated % 100 === 0)
                    console.log(`   ...Updated ${qUpdated} questions`);
            }
            catch (err) {
                if (err.code !== 'P2025') { // Ignore RecordNotFound
                    console.error(`   ❌ Failed to update question ${q.id}: ${err.message}`);
                }
            }
        }
        console.log(`✅ Successfully updated ${qUpdated} questions.`);
        let sUpdated = 0;
        for (const slide of lessonBlocks) {
            if (!slide.id)
                continue;
            try {
                yield prisma.lessonBlock.update({
                    where: { id: slide.id },
                    data: {
                        title: slide.title,
                        content: slide.content,
                        type: slide.type,
                        order: slide.order
                    }
                });
                sUpdated++;
                if (sUpdated % 50 === 0)
                    console.log(`   ...Updated ${sUpdated} slides`);
            }
            catch (err) {
                if (err.code !== 'P2025') {
                    console.error(`   ❌ Failed to update slide ${slide.id}: ${err.message}`);
                }
            }
        }
        console.log(`✅ Successfully updated ${sUpdated} slides.`);
        console.log(`\n======================================================`);
        console.log(`🎉 ALL DONE! Your database is now cleaned and updated.`);
        console.log(`======================================================\n`);
    });
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
}));
