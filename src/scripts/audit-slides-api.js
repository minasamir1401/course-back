/**
 * audit-slides-api.js
 * يتصل بالـ API ويجيب كل الدروس وعدد الشرائح
 * 
 * الاستخدام:
 *   node audit-slides-api.js <token>
 *
 * التوكن: من localStorage بعد تسجيل الدخول كـ super admin
 * في DevTools: localStorage.getItem('super_admin_token')
 */

const https = require('https');

const API_BASE = 'https://api.klevro.tech/api';
const TOKEN = process.argv[2];

if (!TOKEN) {
  console.log('\n❌ يجب توفير التوكن:');
  console.log('   node audit-slides-api.js <super_admin_token>\n');
  console.log('💡 للحصول على التوكن:');
  console.log('   1. افتح klevro.tech في المتصفح وسجل دخول كـ super admin');
  console.log('   2. افتح DevTools (F12) ثم Console');
  console.log('   3. اكتب: localStorage.getItem("super_admin_token")');
  console.log('   4. انسخ النتيجة واستخدمها هنا\n');
  process.exit(1);
}

function get(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
    https.get({
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('\n🔍 جلب قائمة الكورسات من: ' + API_BASE);
  
  // جلب الكورسات مع الدروس
  const r = await get('/courses?limit=200&isCentral=false');
  if (r.status !== 200) {
    // جرب isCentral=true
    const r2 = await get('/courses?limit=200&isCentral=true');
    if (r2.status !== 200) {
      console.error('❌ فشل جلب الكورسات. تأكد من صحة التوكن.');
      console.error('Status:', r.status);
      return;
    }
  }

  // جلب كل الكورسات
  const allCourses = [];
  for (const centralVal of ['true', 'false']) {
    const resp = await get(`/courses?limit=200&isCentral=${centralVal}`);
    if (resp.status === 200) {
      const data = Array.isArray(resp.body) ? resp.body : (resp.body.courses || resp.body.data || []);
      allCourses.push(...data);
    }
  }
  
  if (allCourses.length === 0) {
    console.error('❌ لا توجد كورسات. تأكد من صحة التوكن أو الصلاحيات.');
    return;
  }

  console.log(`✅ تم العثور على ${allCourses.length} كورس\n`);
  
  let totalLessons = 0;
  let missingLessons = [];
  
  for (const course of allCourses) {
    // جلب تفاصيل الكورس مع الدروس
    const cr = await get(`/courses/${course.id}`);
    if (cr.status !== 200) continue;
    
    const lessons = cr.body.lessons || [];
    if (lessons.length === 0) continue;
    
    console.log(`\n📖 "${course.title}" [${course.id}]`);
    
    for (const lesson of lessons) {
      totalLessons++;
      const sr = await get(`/lessons/${lesson.id}/slides`);
      let count = 0;
      if (sr.status === 200) count = sr.body.count || 0;
      
      const icon = count === 0 ? '🔴' : count < 5 ? '🟡' : count < 20 ? '🟢' : '✨';
      console.log(`   ${icon} [${lesson.id}]`);
      console.log(`      عنوان: "${lesson.title}"`);
      console.log(`      شرائح: ${count}`);
      
      if (count < 5) {
        missingLessons.push({ courseTitle: course.title, lessonId: lesson.id, lessonTitle: lesson.title, slidesCount: count });
      }
    }
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 ملخص: ${totalLessons} درس إجمالي`);
  
  if (missingLessons.length > 0) {
    console.log(`\n⚠️ الدروس التي تحتاج مراجعة (أقل من 5 شرائح):\n`);
    missingLessons.forEach(l => {
      console.log(`   🔴 "${l.lessonTitle}" - ${l.slidesCount} شريحة`);
      console.log(`      ID: ${l.lessonId}`);
      console.log(`      كورس: ${l.courseTitle}\n`);
    });
  } else {
    console.log('\n✅ جميع الدروس لديها شرائح كافية!');
  }
  
  console.log('\n💡 لعرض شرائح درس معين:');
  console.log('   node fix-missing-slides.js <token> <lesson_id>');
}

main().catch(console.error);
