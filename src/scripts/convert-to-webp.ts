import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

async function convertImages() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    console.log('Uploads directory not found.');
    return;
  }

  const files = fs.readdirSync(UPLOADS_DIR);
  let convertedCount = 0;
  let errorCount = 0;

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const filePath = path.join(UPLOADS_DIR, file);

    if (['.jpg', '.jpeg', '.png'].includes(ext)) {
      const webpFilename = `${path.parse(file).name}.webp`;
      const webpPath = path.join(UPLOADS_DIR, webpFilename);
      
      try {
        if (!fs.existsSync(webpPath)) {
          console.log(`Converting ${file} to WebP...`);
          await sharp(filePath)
            .webp({ quality: 80 })
            .toFile(webpPath);
          convertedCount++;
        }
      } catch (err: any) {
        console.error(`Error converting ${file}: ${err.message}`);
        errorCount++;
      }
    }
  }

  console.log(`Done. Converted: ${convertedCount}, Errors: ${errorCount}`);
}

convertImages();
