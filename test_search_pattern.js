const assert = require('assert');
const { flexibleArabicPattern, escapeRegex } = require('./utils/searchPattern');

const matches = (query, text) => new RegExp(flexibleArabicPattern(query), 'i').test(text);

assert(matches('اناناس', 'أناناس طازج'));
assert(matches('أناناس', 'اناناس'));
assert(matches('مانجة', 'مانجه'));
assert(matches('مانجه', 'مانجة'));
assert(matches('بقالى', 'بقالي'));
assert(matches('تفّاح', 'تفاح احمر'), 'التشكيل يُتجاهل');
assert(matches('عنب', 'عنب اخضر'));
assert(!matches('عنب', 'تفاح'));
assert(matches('Pepsi', 'pepsi 1L'), 'غير حساس لحالة الأحرف');
// رموز regex تُعامل كنص عادي (بدون كسر أو حقن)
assert(matches('1.5L', '1.5L بيبسي'));
assert(!matches('1.5L', '1x5L'));
assert(matches('a+b', 'a+b'));
assert.doesNotThrow(() => new RegExp(flexibleArabicPattern('(((')));
assert.strictEqual(escapeRegex('a.b'), 'a\\.b');
console.log('كل اختبارات نمط البحث نجحت');
