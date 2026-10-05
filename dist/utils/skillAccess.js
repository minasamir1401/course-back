"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.skillSelections = skillSelections;
exports.clusterSchoolIds = clusterSchoolIds;
exports.skillSchoolWhere = skillSchoolWhere;
exports.skillGradeWhere = skillGradeWhere;
exports.canViewSkillCluster = canViewSkillCluster;
exports.canManageSkillCluster = canManageSkillCluster;
exports.canDeleteSkillCluster = canDeleteSkillCluster;
exports.skillClusterPayload = skillClusterPayload;
exports.skillActivityPayload = skillActivityPayload;
function skillSelections(value) {
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        }
        catch (_a) {
            value = [value];
        }
    }
    return Array.isArray(value) ? [...new Set(value.filter((v) => typeof v === 'string' && !!v.trim()).map(v => v.trim()))] : [];
}
function clusterSchoolIds(cluster) { return [...new Set([...skillSelections(cluster.schoolIds), ...skillSelections(cluster.schoolId)])]; }
function skillSchoolWhere(schoolId) {
    return schoolId ? { OR: [{ isCentral: true }, { schoolId }, { schoolIds: { contains: JSON.stringify(schoolId) } }] } : { isCentral: true };
}
function skillGradeWhere(grades) {
    return grades.length ? { OR: grades.flatMap(grade => [{ grade }, { grade: { contains: JSON.stringify(grade) } }]) } : {};
}
function canViewSkillCluster(user, cluster, grades) {
    if (user.role === 'SUPER_ADMIN')
        return true;
    if (!cluster.isCentral && (!user.schoolId || !clusterSchoolIds(cluster).includes(user.schoolId)))
        return false;
    if (user.role !== 'STUDENT')
        return true;
    const targets = skillSelections(cluster.grade);
    return grades.length > 0 && targets.some(grade => grades.includes(grade));
}
function canManageSkillCluster(user, cluster) {
    if (user.role === 'SUPER_ADMIN')
        return true;
    // Shared and central content remains under its author's/super admin's control.
    const schools = clusterSchoolIds(cluster);
    return !cluster.isCentral && !!user.schoolId && cluster.schoolId === user.schoolId && schools.length === 1
        && (user.role === 'SCHOOL_ADMIN' || (user.role === 'TEACHER' && cluster.creatorId === user.id));
}
function canDeleteSkillCluster(user, cluster) {
    return user.role === 'SUPER_ADMIN' || (!cluster.isCentral && !!user.schoolId && cluster.schoolId === user.schoolId && clusterSchoolIds(cluster).length === 1 && ['SCHOOL_ADMIN', 'TEACHER'].includes(user.role));
}
function withoutAnswerKeys(value) {
    if (Array.isArray(value))
        return value.map(withoutAnswerKeys);
    if (!value || typeof value !== 'object')
        return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !['correctAnswer', 'correctAnswerEn', 'correctIndex', 'isCorrect', 'solution', 'answer'].includes(key)).map(([key, v]) => [key, withoutAnswerKeys(v)]));
}
function publicOptions(value, type) {
    const options = withoutAnswerKeys(value);
    if (!options || typeof options !== 'object')
        return options;
    if (type === 'CROSSWORD' && Array.isArray(options.words))
        options.words = options.words.map((item) => ({ clue: item.clue, length: String(item.word || '').length }));
    if (type === 'IMAGE_LABEL' && Array.isArray(options.labels))
        options.labels = options.labels.map((item) => ({ x: item.x, y: item.y }));
    if (type === 'WORD_SCRAMBLE' && options.word) {
        options.letters = String(options.word).toUpperCase().split('').sort(() => Math.random() - .5);
        delete options.word;
    }
    if (type === 'SENTENCE_REORDER' && Array.isArray(options.words))
        options.words.sort(() => Math.random() - .5);
    if (type === 'SEQUENCE_ORDER' && Array.isArray(options.items))
        options.items.sort(() => Math.random() - .5);
    if (type === 'MATCHING' && Array.isArray(options.right))
        options.right.sort(() => Math.random() - .5);
    return options;
}
function parseJson(value) { if (typeof value !== 'string')
    return value; try {
    return JSON.parse(value);
}
catch (_a) {
    return value;
} }
function skillClusterPayload(cluster) { return Object.assign(Object.assign({}, cluster), { grades: skillSelections(cluster.grade), schoolIds: clusterSchoolIds(cluster) }); }
function skillActivityPayload(activity, student) {
    const result = Object.assign(Object.assign({}, activity), { options: parseJson(activity.options), optionsEn: parseJson(activity.optionsEn), correctAnswer: parseJson(activity.correctAnswer), correctAnswerEn: parseJson(activity.correctAnswerEn) });
    if (student) {
        result.options = publicOptions(result.options, activity.type);
        result.optionsEn = publicOptions(result.optionsEn, activity.type);
        for (const key of ['correctAnswer', 'correctAnswerEn', 'explanation', 'explanationEn', 'keyInsight', 'keyInsightEn'])
            delete result[key];
    }
    return result;
}
