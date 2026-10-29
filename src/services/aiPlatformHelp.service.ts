import { DEFAULT_PLATFORM_KNOWLEDGE } from './aiKnowledge.service';

const normalized = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[\u064B-\u065F\u0670]/g, '').replace(/[أإآ]/g, 'ا');
const programs = [
  ['SAT', 'الرياضيات: الجبر، الرياضيات المتقدمة، حل المشكلات وتحليل البيانات، الهندسة وحساب المثلثات؛ والقراءة والكتابة.', 'Mathematics: Algebra, Advanced Math, Problem Solving and Data Analysis, Geometry and Trigonometry; Reading and Writing.'],
  ['Pre-SAT / PSAT', 'تأسيس الرياضيات والقراءة والكتابة.', 'Foundational Mathematics, Reading and Writing.'],
  ['GAT — القدرات العامة', 'الاستدلال الكمي واللفظي، مع دعم محتوى عربي.', 'Quantitative and Verbal reasoning, with Arabic content support.'],
  ['SAAT — التحصيلي', 'الرياضيات والأحياء والكيمياء والفيزياء، مع دعم محتوى تقييم عربي.', 'Mathematics, Biology, Chemistry and Physics, with Arabic assessment content support.'],
  ['NAFS — نافس', 'الصف الثالث: القراءة والرياضيات. الصفان السادس والتاسع: القراءة والرياضيات والعلوم.', 'Grade 3: Reading and Mathematics. Grades 6 and 9: Reading, Mathematics and Science.'],
  ['Skills Hub — تنمية المهارات', 'المهارات الأساسية وحل المشكلات والتفكير الناقد والرياضيات.', 'Foundational skills, problem-solving, critical thinking and Mathematics.'],
];

/** Fast, factual platform FAQs. Arbitrary tutoring and personal questions still
 * go to the model with authorized context. Release-specific templates are used
 * only while the owner's reference matches the reviewed source; owner edits
 * fall back to the current reference instead of receiving stale canned facts. */
export function verifiedPlatformHelp(message: string, knowledge: string, history: Array<{ role: string; content: string }> = []): string | null {
  const query = normalized(message);
  // Do not intercept personal performance analysis or a request to teach a lesson.
  if (/درجتي|نتيجتي كام|اسمي|مشاكلي|تنبيهاتي|اشعاراتي|مهامي|واجباتي|اختباراتي|تقييمي|شهاداتي|حللي|حللني|مستواي|انا ضعيف|انا قوي|احسب|اشرح.*درس|اشرح.*معادل|حل.*مساله|my (?:score|grade|name|performance)|analyse me|analyze me|teach me|calculate|solve/.test(query)) return null;
  const followUp = /^(?:طب|طيب|تمام|كمل|اشرحلي ده|اشرح ده)|tell me more|explain (?:it|that)|continue/.test(query);
  const previous = followUp ? history.filter(item => item.role === 'user').slice(-2).map(item => normalized(item.content)).join(' ') : '';
  const topic = `${query} ${previous}`;
  const ar = /[\u0600-\u06ff]/.test(message);
  const text = (arabic: string, english: string) => ar ? arabic : english;
  const reviewed = knowledge.trim() === DEFAULT_PLATFORM_KNOWLEDGE.trim();
  const access = text('إتاحة كل مقرر أو درس بتعتمد على نشره وصلاحيات حسابك؛ وجود المسار ضمن المنصة مش معناه إن كل محتواه متاح للجميع.', 'Each course or lesson depends on publication and account permissions. A pathway being in scope does not mean every course is available to everyone.');
  const pricing = /بكام|فلوس|اسعار|تكلف|اشتراك|مجاني|ببلاش|subscription|pricing|price|cost|free/.test(topic);
  const recognition = /شهاد|جوائز|جوايز|مكافات|مسابق|نقاط|شارات|certificate|reward|prize|competition|badge|leaderboard/.test(topic);
  if (pricing || recognition) {
    if (!reviewed) return null;
    return [
      pricing ? text('**الأسعار والاشتراك:** مفيش أسعار أو باقات أو فترة مجانية مؤكدة في المعلومات المعتمدة المتاحة لي. اسأل مدرستك أو إدارة المنصة عن خيارات حسابك وتكلفتها.', '**Pricing and access:** The approved reference does not confirm prices, plans or a free trial. Ask your school or platform administrator about the options and cost for your account.') : '',
      recognition ? text('**المسابقات والجوائز والشهادات:** وفق حالة الإتاحة المعتمدة، المسابقات والشهادات والنقاط والمكافآت والجوائز والشارات ولوحات الصدارة قيد التطوير. مفيش موعد إطلاق مؤكد أو وعد بجوائز مالية أو شهادات إكمال متاحة حاليًا.', '**Competitions, rewards and certificates:** The approved availability registry lists competitions, certificates, points, rewards, prizes, badges and leaderboards as under development. No launch date, cash prize or available completion certificate is confirmed.') : '',
    ].filter(Boolean).join('\n\n');
  }
  const navigation = /ازاي|كيف|فين|اين|ادخل|ابدا|حساب جديد|نسيت|دروسي|نتيجتي|نتائجي|how|where|sign.?in|log.?in|sign.?up|password/.test(query);
  const site = /منص|موقع|موقه|كليفرو|كليڤرو|كليفروا|klevro|platform|website/.test(query);
  const overview = site && /عرفني|عرنفي|تفصيل|تصفيل|تفاصيل|ايه|ما هي|اشرح|مميزات|ميزات|مزايا|بتقدم|offer|overview|explain|what|about|detail/.test(query);
  const tracksRequest = /مسارات|برامج|tracks|pathways|programs/.test(query);
  const selected = programs.filter(([name]) => {
    if (name.startsWith('Pre-')) return /pre.?sat|psat|قبل.*سات/.test(topic);
    if (name === 'SAT') return /\bsat\b|\bسات\b/.test(topic.replace(/pre.?sat|psat/g, ''));
    if (name.startsWith('GAT')) return /\bgat\b|القدرات/.test(topic);
    if (name.startsWith('SAAT')) return /\bsaat\b|التحصيلي/.test(topic);
    if (name.startsWith('NAFS')) return /\bnafs\b|نافس/.test(topic);
    return /skills? hub|تنميه المهارات|تنمية المهارات/.test(topic);
  });
  const programQuestion = /ايه|ما هو|ما هي|اشرح|عرفني|يناسب|صف|مواد|what|explain|cover|subject|grade|suitable/.test(topic) || followUp;
  const steps = text(
    '1. افتح [تسجيل الدخول](/login)، واستخدم اسم المستخدم وكلمة المرور اللي وفّرتهم المدرسة أو الإدارة. لو معندكش بيانات أو نسيتها، تواصل معاهم؛ صفحة دخول الطالب الحالية مفيهاش إنشاء حساب عام أو استعادة ذاتية لكلمة المرور.\n2. من [مقرراتي](/courses)، افتح المقرر المتاح لحسابك ثم اختار الدرس من داخله.\n3. هتلاقي الاختبارات المفعلة لحسابك في [الامتحانات](/exams)، والمواعيد المنشورة في [الجدول الزمني](/calendar).\n4. راجع [لوحة التحكم](/dashboard) لملخص تقدّمك، و[تقارير الأداء](/reports) لنتائجك والتفاصيل المسموح بعرضها. ظهور الدرجة والإجابات والشروح بيخضع لإعدادات التقييم.',
    '1. Open [Log in](/login) and use the username and password supplied by your school or administrator. If you do not have them or have forgotten them, contact that administrator. The current student login page has no public signup or self-service password reset.\n2. Open [Courses](/courses), choose a course available to your account, then open a lesson inside it.\n3. Find enabled assessments in [Exams](/exams) and published dates in [Calendar](/calendar).\n4. Use [Dashboard](/dashboard) for your progress overview and [Reports](/reports) for released results. Scores, answers and explanations depend on assessment visibility settings.',
  );
  if (overview || tracksRequest || (selected.length && programQuestion)) {
    if (!reviewed) return null;
    const list = overview || tracksRequest ? programs : selected;
    const description = list.map(([name, arabic, english]) => `- **${name}**: ${ar ? arabic : english}`).join('\n');
    if (!overview) return `${text('**المسارات التعليمية**', '**Educational pathways**')}\n\n${description}\n\n${access}\n\n${text('ابدأ من [مقرراتي](/courses) بعد تسجيل الدخول، وافتح المقرر اللي أتاحته لك مدرستك.', 'After signing in, open [Courses](/courses) and choose the course your school has made available.')}`;
    return text('Klevro منصة تعليمية بالعربي والإنجليزي بتجمع التعلّم والتدريب والواجبات والاختبارات وتنمية المهارات ومتابعة التقدّم في مكان واحد.', 'Klevro is a bilingual learning platform combining lessons, practice, assignments, assessments, skills development and progress feedback.')
      + `\n\n${text('**المسارات التعليمية**', '**Educational pathways**')}\n\n${description}`
      + `\n\n${text('**رحلتك على المنصة**', '**Your learning journey**')}\n\n${text('تتعلّم من الشرح والأمثلة المتاحة، تطبّق في التدريبات والتقييمات المنشورة، وتراجع النتائج والتلميحات والشروحات اللي تسمح إعدادات حسابك بعرضها.', 'Learn from available explanations and examples, practise with published activities and assessments, then review the results, hints and explanations enabled for your account.')}`
      + `\n\n${text('**تبدأ إزاي؟**', '**How to get started**')}\n\n${steps}`
      + `\n\n${text('**مساعد Klevro**', '**Klevro assistant**')}\n\n${text('في الرئيسية يشرح المنصة وطريقة استخدامها. داخل حساب الطالب، عند تفعيله، يساعدك تفهم الدرس ويربط نصائح المراجعة بنتائجك وتقدّمك المسموحين. تقدر تكتب له أو تستخدم الميكروفون لتحويل كلامك لنص حسب دعم المتصفح والإذن، وتكبّر الشات داخل الصفحة. المساعد مش بيظهر أثناء الاختبارات والتقييمات والمهارات والألعاب.', 'On the homepage it explains the platform. In a student account, when enabled, it helps explain accessible lessons and bases study advice on permitted results and progress. You can type or use supported browser dictation with permission, and expand the chat on the same page. It is hidden during exams, assessments, skills and games.')}`
      + `\n\n${access}`;
  }
  if (navigation && (site || /دروسي|نتيجتي|نتائجي|حساب|اسم المستخدم|كلمة المرور|lessons|results|account|password/.test(query))) return `${steps}\n\n${text('لو مقرر أو نتيجة مش ظاهرين، ممكن يكون السبب النشر أو صلاحيات الحساب أو موعد الإتاحة أو عدم وجود محاولة مسجلة. إدارة المدرسة تقدر تتأكد من إعدادات حسابك.', 'A missing course or result may relate to publication, account permissions, availability dates or no recorded attempt. Your school administrator can check your access settings.')}`;
  return null;
}
