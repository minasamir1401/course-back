require('ts-node/register/transpile-only');
const { metadataTranslations, metadataForDisplay } = require('../../../src/utils/bilingualMetadata');
const { snapshotQuestion, historicalSubmission } = require('../../../src/utils/submissionSnapshot');
const { planMetadataTranslation } = require('../../../src/utils/metadataTranslationPlan');
const { maskSpecialContent, restoreSpecialContent, translateSingleText } = require('../../../src/services/translation.service');
test('metadata persistence preserves omissions, sanitizes values and permits explicit clears',()=>{
 expect(metadataTranslations({skill:'مهارة'})).toEqual({});
 expect(metadataTranslations({skillEn:'',domainEn:'Algebra'},x=>x.toUpperCase())).toEqual({skillEn:null,domainEn:'ALGEBRA'});
});
test('snapshots keep bilingual labels and enrich identical legacy labels without regrading or mutating snapshots',()=>{
 const original={id:'q',skill:'Algebra',points:2}; const current={...original,skill:'الجبر',skillEn:'Algebra',points:999};
 const answer={questionSnapshot:original,question:current,isCorrect:true};
 const before=JSON.stringify(answer);
 const result=historicalSubmission({answers:[answer],totalScore:2,percentage:50,reportSnapshot:{totalQuestions:2,correctAnswers:1,totalPoints:4}});
 expect(result.totalScore).toBe(2);expect(result.percentage).toBe(50);expect(result.totalPoints).toBe(4);expect(result.answers[0].question.points).toBe(2);expect(result.answers[0].question.skill).toBe('الجبر');expect(JSON.stringify(answer)).toBe(before);
 expect(metadataForDisplay(original,{...current,skill:'الهندسة',skillEn:'Geometry'}).skill).toBe('Algebra');
 expect(snapshotQuestion(current).skillEn).toBe('Algebra');
});
test('backfill retains original English, fills missing Arabic, and never overwrites a reviewed bilingual pair',async()=>{
 const translate=jest.fn(async(text,from)=>from==='en'?'حل المعادلات':'Solving equations');
 expect(await planMetadataTranslation({skill:'Solving equations'},['skill'],translate)).toEqual({skillEn:'Solving equations',skill:'حل المعادلات'});
 translate.mockClear();expect(await planMetadataTranslation({skill:'حل المعادلات',skillEn:'Reviewed wording'},['skill'],translate)).toEqual({});expect(translate).not.toHaveBeenCalled();
 expect(await planMetadataTranslation({skill:'Solving equations'},['skill'],async text=>text)).toEqual({skillEn:'Solving equations'});
});
test('all LaTeX delimiters and complete rendered trees are masked atomically and restored literally',()=>{
 const expressions=[String.raw`\(x^2-y^2=\frac{1}{4}\)`,String.raw`\[x<y\]`, '$x+y$', '$$x-y$$', '<span class="math-tex" data-latex="x^2"><span class="katex"><math><mtext>rate $&amp;</mtext></math></span></span>'];
 for (const expression of expressions) {
  const masked=maskSpecialContent('أوجد '+expression+' الآن');
  expect(masked.tokens).toContain(expression); expect(masked.maskedText).not.toContain(expression);
  expect(restoreSpecialContent(masked.maskedText,masked.tokens)).toContain(expression);
 }
 expect(restoreSpecialContent('__MATH_0__',['$& __HTML_1__'])).toContain('$& __HTML_1__');
});
test('a translation provider dropping math placeholders cannot corrupt the saved content',async()=>{
 const old=global.fetch;global.fetch=jest.fn(async()=>({ok:true,json:async()=>[[['Translated without math']]]}));
 try { const text=String.raw`ترجم \(x^2-y^2\)`;expect(await translateSingleText(text,'ar','en')).toBe(text); }
 finally {global.fetch=old;}
});

test('reviewed math glossary disambiguates Arabic operations and preserves standard identifiers',async()=>{
 const {translateMetadataTerm}=require('../../../src/utils/metadataGlossary');
 expect(translateMetadataTerm('الجمع','en')).toBe('Addition');expect(translateMetadataTerm('الطرح','en')).toBe('Subtraction');
 expect(translateMetadataTerm('MATH.7.NS.3','ar')).toBe('MATH.7.NS.3');
 const translate=jest.fn();expect(await planMetadataTranslation({standard:'MATH.7.NS.3'},['standard'],translate)).toEqual({standardEn:'MATH.7.NS.3'});expect(translate).not.toHaveBeenCalled();
});
