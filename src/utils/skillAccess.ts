export function skillSelections(value: unknown): string[] {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = [value]; } }
  return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && !!v.trim()).map(v => v.trim()))] : [];
}
export function clusterSchoolIds(cluster: any): string[] { return [...new Set([...skillSelections(cluster.schoolIds), ...skillSelections(cluster.schoolId)])]; }
export function skillSchoolWhere(schoolId?: string | null): any {
  return schoolId ? { OR: [{ isCentral: true }, { schoolId }, { schoolIds: { contains: JSON.stringify(schoolId) } }] } : { isCentral: true };
}
export function skillGradeWhere(grades: string[]): any {
  return grades.length ? { OR: grades.flatMap(grade => [{ grade }, { grade: { contains: JSON.stringify(grade) } }]) } : {};
}
export function canViewSkillCluster(user: any, cluster: any, grades: string[]): boolean {
  if (user.role === 'SUPER_ADMIN') return true;
  if (!cluster.isCentral && (!user.schoolId || !clusterSchoolIds(cluster).includes(user.schoolId))) return false;
  if (user.role !== 'STUDENT') return true;
  const targets = skillSelections(cluster.grade);
  return grades.length > 0 && targets.some(grade => grades.includes(grade));
}
export function canManageSkillCluster(user: any, cluster: any): boolean {
  if (user.role === 'SUPER_ADMIN') return true;
  // Shared and central content remains under its author's/super admin's control.
  const schools = clusterSchoolIds(cluster);
  return !cluster.isCentral && !!user.schoolId && cluster.schoolId === user.schoolId && schools.length === 1
    && (user.role === 'SCHOOL_ADMIN' || (user.role === 'TEACHER' && cluster.creatorId === user.id));
}
export function canDeleteSkillCluster(user: any, cluster: any): boolean {
  return user.role === 'SUPER_ADMIN' || (!cluster.isCentral && !!user.schoolId && cluster.schoolId === user.schoolId && clusterSchoolIds(cluster).length === 1 && ['SCHOOL_ADMIN','TEACHER'].includes(user.role));
}
function withoutAnswerKeys(value: any): any {
  if (Array.isArray(value)) return value.map(withoutAnswerKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['correctAnswer','correctAnswerEn','correctIndex','isCorrect','solution','answer'].includes(key)).map(([key,v]) => [key,withoutAnswerKeys(v)]));
}
function publicOptions(value: any, type: string): any {
  const options = withoutAnswerKeys(value);
  if (!options || typeof options !== 'object') return options;
  if (type === 'CROSSWORD' && Array.isArray(options.words)) options.words = options.words.map((item: any) => ({clue:item.clue,length:String(item.word || '').length}));
  if (type === 'IMAGE_LABEL' && Array.isArray(options.labels)) options.labels = options.labels.map((item: any) => ({x:item.x,y:item.y}));
  if (type === 'WORD_SCRAMBLE' && options.word) {
    options.letters = String(options.word).toUpperCase().split('').sort(() => Math.random() - .5); delete options.word;
  }
  if (type === 'SENTENCE_REORDER' && Array.isArray(options.words)) options.words.sort(() => Math.random() - .5);
  if (type === 'SEQUENCE_ORDER' && Array.isArray(options.items)) options.items.sort(() => Math.random() - .5);
  if (type === 'MATCHING' && Array.isArray(options.right)) options.right.sort(() => Math.random() - .5);
  return options;
}
function parseJson(value: any) { if (typeof value !== 'string') return value; try { return JSON.parse(value); } catch { return value; } }
export function skillClusterPayload(cluster: any) { return { ...cluster, grades: skillSelections(cluster.grade), schoolIds: clusterSchoolIds(cluster) }; }
export function skillActivityPayload(activity: any, student: boolean) {
  const result = { ...activity, options: parseJson(activity.options), optionsEn: parseJson(activity.optionsEn), correctAnswer: parseJson(activity.correctAnswer), correctAnswerEn: parseJson(activity.correctAnswerEn) };
  if (student) {
    result.options = publicOptions(result.options, activity.type);
    result.optionsEn = publicOptions(result.optionsEn, activity.type);
    for (const key of ['correctAnswer','correctAnswerEn','explanation','explanationEn','keyInsight','keyInsightEn']) delete result[key];
  }
  return result;
}
