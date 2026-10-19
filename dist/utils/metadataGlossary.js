"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMetadataIdentifier = isMetadataIdentifier;
exports.translateMetadataTerm = translateMetadataTerm;
/** Reviewed educational terms. Codes are identifiers and must never be translated. */
const pairs = [
    [
        "عام",
        "General"
    ],
    [
        "العمليات الحسابية",
        "Arithmetic operations"
    ],
    [
        "الجمع",
        "Addition"
    ],
    [
        "الطرح",
        "Subtraction"
    ],
    [
        "الضرب",
        "Multiplication"
    ],
    [
        "القسمة",
        "Division"
    ],
    [
        "التحقق من ناتج عملية الجمع",
        "Verify the result of addition"
    ],
    [
        "التحقق من ناتج عملية الطرح",
        "Verify the result of subtraction"
    ],
    [
        "التحقق من ناتج عملية الضرب",
        "Verify the result of multiplication"
    ],
    [
        "التحقق من ناتج عملية القسمة",
        "Verify the result of division"
    ],
    [
        "الرياضيات",
        "Mathematics"
    ],
    [
        "الجبر",
        "Algebra"
    ],
    [
        "جمع الأعداد الصحيحة",
        "Integer Addition"
    ],
    [
        "ضرب الأعداد الصحيحة",
        "Integer Multiplication"
    ],
    [
        "المعكوسات الجمعية",
        "Additive Inverses"
    ],
    [
        "الحس العددي وتصنيف الأعداد",
        "Number Sense & Classification"
    ],
    [
        "مسائل لفظية تطبيقية",
        "Contextual Word Problems"
    ],
    [
        "تطبيق جمع الأعداد الصحيحة الموجبة والسالبة",
        "Apply addition of positive and negative integers"
    ],
    [
        "تمييز الأعداد الصحيحة عن الأعداد العشرية النسبية",
        "Identify and distinguish integers from rational decimals"
    ],
    [
        "حل مسائل حياتية تتضمن عمليات على الأعداد الصحيحة",
        "Solve contextual real-world problems involving integer operations"
    ],
    [
        "تحديد الأعداد المتقابلة والمعكوسات الجمعية للأعداد الصحيحة",
        "Determine opposites and additive inverses of integers"
    ],
    [
        "حساب نواتج ضرب الأعداد الصحيحة ذات الإشارة باستخدام قواعد الإشارات",
        "Evaluate products of signed integers using sign rules"
    ],
    [
        "جمع الأعداد الصحيحة ذات الإشارة",
        "Add signed integers"
    ],
    [
        "تصنيف الأعداد إلى أعداد صحيحة وأعداد غير صحيحة",
        "Classify numbers as integers or non-integers"
    ],
    [
        "حل مسائل حياتية",
        "Solve real-world problems"
    ],
    [
        "ترتيب الأعداد الصحيحة ومقارنتها",
        "Order and compare integers"
    ],
    [
        "إيجاد الأعداد المتقابلة",
        "Find opposite values"
    ]
];
function isMetadataIdentifier(text) {
    return /^[A-Z][A-Z0-9]*(?:[._-][A-Z0-9]+)+$/.test(text.trim()) || /^\d+(?:[.:]\d+)*$/.test(text.trim());
}
function translateMetadataTerm(text, to) {
    const value = text.trim();
    if (isMetadataIdentifier(value))
        return text;
    const pair = pairs.find(pair => pair.some(term => term.toLowerCase() === value.toLowerCase()));
    return pair === null || pair === void 0 ? void 0 : pair[to === 'ar' ? 0 : 1];
}
