import fs from 'fs';

const filePath = 'd:\\pj\\porj\\corse\\cloud_2819ecee-b8ca-4aed-8f79-855c8e36b079_auto_hourly_backup_egypt_١_-٨_-٢٠٢٦،-١٧-٠٠-٠٠.json';
const outPath = 'd:\\pj\\porj\\corse\\fixed_backup.json';

function fixString(s: string): string {
    if (!s.includes('\uFFFD')) return s;

    let res = s;
    
    // 1. Degree
    res = res.replace(/\uFFFD([CF])/g, '°$1');
    
    // 2. Physics formulas
    res = res.replace(/\uFFFDmv\uFFFD/gi, '½mv²');
    res = res.replace(/Mass\s*\uFFFD\s*Volume/gi, 'Mass ÷ Volume');
    res = res.replace(/Mass\s*\uFFFD\s*Acceleration/gi, 'Mass × Acceleration');
    res = res.replace(/Length\s*\uFFFD\s*Width/gi, 'Length × Width');
    res = res.replace(/Width\s*\uFFFD\s*Height/gi, 'Width × Height');
    res = res.replace(/m\s*\uFFFD\s*a/gi, 'm × a');
    res = res.replace(/F\s*\uFFFD\s*d/gi, 'F × d');
    res = res.replace(/I\s*\uFFFD\s*t/gi, 'I × t');
    
    // 3. Units
    res = res.replace(/s\uFFFD/g, 's²');
    res = res.replace(/([c]?m)\uFFFD/g, (match, p1, offset, full) => {
        const localContext = full.substring(Math.max(0, offset - 40), offset + 40).toLowerCase();
        if (localContext.includes('volume') || localContext.includes('density') || localContext.includes('cubic')) {
            return p1 + '³';
        }
        return p1 + '²';
    });
    res = res.replace(/kg\uFFFDm/g, 'kg·m');
    res = res.replace(/A\uFFFDs/g, 'A·s');
    res = res.replace(/N\uFFFDm/g, 'N·m');
    
    // 4. Scientific notation
    res = res.replace(/(\d+)\s*\uFFFD\s*10/g, '$1 × 10');
    
    // 5. Powers of 10
    res = res.replace(/10\uFFFD\uFFFD/g, '10⁻²');
    res = res.replace(/10\uFFFD(?!\d)/g, '10²');
    
    // 6. Root/Radical
    res = res.replace(/\uFFFD/g, (match, offset, full) => {
        const localContext = full.substring(Math.max(0, offset - 20), offset + 20).toLowerCase();
        if (localContext.includes('root') || localContext.includes('radic') || localContext.includes('جذر')) {
            return '√';
        }
        return match;
    });

    // 7. General number operations
    res = res.replace(/(\d)\s*\uFFFD\s*(\d)/g, (match, p1, p2, offset, full) => {
        const localContext = full.substring(Math.max(0, offset - 20), offset + 20).toLowerCase();
        if (localContext.includes('div') || localContext.includes('قسم')) return `${p1} ÷ ${p2}`;
        return `${p1} × ${p2}`;
    });

    // 8. Remaining standalone  -> default to × if spaced
    res = res.replace(/ \uFFFD /g, ' × ');
    
    // Remove unhandled replacements
    res = res.replace(/\uFFFD/g, '');

    return res;
}

function traverseAndFix(obj: any): any {
    if (typeof obj === 'string') {
        // Also parse if it's a JSON string (like 'options' or 'correctAnswer' in DB)
        if (obj.startsWith('{') || obj.startsWith('[')) {
            try {
                const parsed = JSON.parse(obj);
                const fixed = traverseAndFix(parsed);
                return JSON.stringify(fixed);
            } catch (e) {
                return fixString(obj); // Not valid JSON, treat as string
            }
        }
        return fixString(obj);
    }
    if (Array.isArray(obj)) {
        return obj.map(item => traverseAndFix(item));
    }
    if (obj !== null && typeof obj === 'object') {
        const cleaned: any = {};
        for (const key in obj) {
            cleaned[key] = traverseAndFix(obj[key]);
        }
        return cleaned;
    }
    return obj;
}

try {
    console.log('Loading database JSON...');
    const data = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(data);
    
    console.log('Fixing corrupted characters...');
    const fixed = traverseAndFix(parsed);
    
    console.log('Writing fixed JSON...');
    fs.writeFileSync(outPath, JSON.stringify(fixed, null, 2));
    
    console.log(`Success! Fixed backup saved to: ${outPath}`);
} catch (err) {
    console.error('Error:', err);
}
