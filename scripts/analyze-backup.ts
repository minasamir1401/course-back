import fs from 'fs';

const filePath = 'd:\\pj\\porj\\corse\\cloud_2819ecee-b8ca-4aed-8f79-855c8e36b079_auto_hourly_backup_egypt_١_-٨_-٢٠٢٦،-١٧-٠٠-٠٠.json';

try {
  console.log('Loading file...');
  const data = fs.readFileSync(filePath, 'utf8');
  console.log(`File loaded. Size: ${(data.length / 1024 / 1024).toFixed(2)} MB`);

  const regex = /.{0,30}\uFFFD+.{0,30}/g;
  const matches = [...data.matchAll(regex)];

  console.log(`Found ${matches.length} occurrences of \\uFFFD.`);
  
  // Deduplicate and show first 50 unique contexts
  const uniqueContexts = new Set<string>();
  for (const m of matches) {
    uniqueContexts.add(m[0].replace(/\n/g, ' '));
  }
  
  const sample = Array.from(uniqueContexts).slice(0, 50);
  console.log('\n--- SAMPLES ---');
  sample.forEach((s, i) => {
    console.log(`${i + 1}: ${s}`);
  });

} catch (err) {
  console.error('Error:', err);
}
