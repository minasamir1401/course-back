/**
 * fix-missing-slides.js
 * 
 * سكريبت لتشخيص واسترجاع الشرائح المختفية من الدروس
 * يتصل بـ API مباشرة ويعرض الدروس وعدد الشرائح الحالي
 * 
 * الاستخدام:
 *   node fix-missing-slides.js <super_admin_token> [lesson_id] [slides_json_file]
 *
 * أمثلة:
 *   node fix-missing-slides.js eyJhbGc...           ← عرض كل الكورسات والدروس
 *   node fix-missing-slides.js eyJhbGc... <lessonId> ← عرض شرائح درس معين
 */

const https = require('https');
const fs = require('fs');

const API_BASE = 'https://api.klevro.tech/api';
const TOKEN = process.argv[2];
const LESSON_ID = process.argv[3];
const SLIDES_FILE = process.argv[4];

if (!TOKEN) {
  console.error('❌ يجب توفير التوكن كأول argument');
  console.error('   node fix-missing-slides.js <super_admin_token>');
  process.exit(1);
}

function apiRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log('🔍 الاتصال بـ API:', API_BASE);
  console.log('');

  // إذا تم تحديد درس معين + ملف شرائح → استرجاع مباشر
  if (LESSON_ID && SLIDES_FILE) {
    console.log(`📤 استرجاع شرائح الدرس: ${LESSON_ID}`);
    if (!fs.existsSync(SLIDES_FILE)) {
      console.error(`❌ ملف الشرائح غير موجود: ${SLIDES_FILE}`);
      process.exit(1);
    }
    const slidesData = fs.readFileSync(SLIDES_FILE, 'utf-8');
    const slides = JSON.parse(slidesData);
    console.log(`📊 عدد الشرائح في الملف: ${slides.length}`);
    
    const res = await apiRequest('PATCH', `/lessons/${LESSON_ID}/slides`, { slides: slidesData });
    if (res.status === 200) {
      console.log(`✅ تم استرجاع ${res.body.count} شريحة بنجاح!`);
    } else {
      console.error('❌ فشل الاسترجاع:', res.body);
    }
    return;
  }

  // إذا تم تحديد درس فقط → عرض شرائحه الحالية
  if (LESSON_ID) {
    console.log(`🔍 جلب شرائح الدرس: ${LESSON_ID}`);
    const res = await apiRequest('GET', `/lessons/${LESSON_ID}/slides`);
    if (res.status === 200) {
      console.log(`📚 الدرس: ${res.body.title}`);
      console.log(`📊 عدد الشرائح الحالي: ${res.body.count}`);
      console.log('');
      if (res.body.slides && res.body.slides.length > 0) {
        res.body.slides.forEach((s, i) => {
          console.log(`  شريحة ${i+1}: [${s.type || s.label}] ${s.title || s.content?.substring(0, 50) || '(بدون عنوان)'}`);
        });
        // حفظ الشرائح في ملف
        const outFile = `slides-${LESSON_ID}.json`;
        fs.writeFileSync(outFile, JSON.stringify(res.body.slides, null, 2), 'utf-8');
        console.log(`\n💾 تم حفظ الشرائح في: ${outFile}`);
      } else {
        console.log('⚠️ لا توجد شرائح لهذا الدرس في قاعدة البيانات!');
      }
    } else {
      console.error('❌ خطأ:', res.body);
    }
    return;
  }

  // افتراضي: عرض كل الكورسات والدروس
  console.log('📚 جلب قائمة الكورسات...');
  const coursesRes = await apiRequest('GET', '/courses?limit=100');
  
  if (coursesRes.status !== 200) {
    console.error('❌ فشل جلب الكورسات:', coursesRes.body);
    process.exit(1);
  }

  const courses = Array.isArray(coursesRes.body) ? coursesRes.body : (coursesRes.body.courses || coursesRes.body.data || []);
  console.log(`✅ تم جلب ${courses.length} كورس\n`);

  for (const course of courses) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📖 كورس: ${course.title}`);
    console.log(`   ID: ${course.id}`);
    
    // جلب تفاصيل الكورس مع الدروس
    const courseRes = await apiRequest('GET', `/courses/${course.id}`);
    if (courseRes.status !== 200) continue;
    
    const lessons = courseRes.body.lessons || [];
    console.log(`   دروس: ${lessons.length}`);
    console.log('');
    
    for (const lesson of lessons) {
      // جلب الشرائح لكل درس
      const slidesRes = await apiRequest('GET', `/lessons/${lesson.id}/slides`);
      const count = slidesRes.status === 200 ? slidesRes.body.count : '?';
      const status = count === 0 ? '🔴 مختفي!' : count < 5 ? '🟡 قليل' : '🟢';
      console.log(`   ${status} [${lesson.id}] "${lesson.title}" → ${count} شريحة`);
    }
    console.log('');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n💡 لعرض شرائح درس معين:');
  console.log('   node fix-missing-slides.js <token> <lesson_id>');
  console.log('\n💡 لاسترجاع شرائح من ملف:');
  console.log('   node fix-missing-slides.js <token> <lesson_id> <slides.json>');
}

main().catch(console.error);
