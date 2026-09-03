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
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const sharp_1 = __importDefault(require("sharp"));
const UPLOADS_DIR = path_1.default.join(process.cwd(), 'uploads');
function convertImages() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!fs_1.default.existsSync(UPLOADS_DIR)) {
            console.log('Uploads directory not found.');
            return;
        }
        const files = fs_1.default.readdirSync(UPLOADS_DIR);
        let convertedCount = 0;
        let errorCount = 0;
        for (const file of files) {
            const ext = path_1.default.extname(file).toLowerCase();
            const filePath = path_1.default.join(UPLOADS_DIR, file);
            if (['.jpg', '.jpeg', '.png'].includes(ext)) {
                const webpFilename = `${path_1.default.parse(file).name}.webp`;
                const webpPath = path_1.default.join(UPLOADS_DIR, webpFilename);
                try {
                    if (!fs_1.default.existsSync(webpPath)) {
                        console.log(`Converting ${file} to WebP...`);
                        yield (0, sharp_1.default)(filePath)
                            .webp({ quality: 80 })
                            .toFile(webpPath);
                        convertedCount++;
                    }
                }
                catch (err) {
                    console.error(`Error converting ${file}: ${err.message}`);
                    errorCount++;
                }
            }
        }
        console.log(`Done. Converted: ${convertedCount}, Errors: ${errorCount}`);
    });
}
convertImages();
