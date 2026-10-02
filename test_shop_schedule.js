// اختبار منطق ساعات دوام المحلات (بدون قاعدة بيانات) — يُشغّل: node test_shop_schedule.js
const assert = require('assert');
const {
  normalizeTime, isScheduledOpen, getEffectiveIsOpen, nextTransitionInstant,
  mergeSchedule, applyScheduleChanges, serializeShop,
} = require('./utils/shopSchedule');

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; } catch (e) { console.error('FAIL:', name, '\n  ', e.message); process.exitCode = 1; }
}

// وقت بتوقيت بغداد (UTC+3) كـ Date. dayOffset لليوم التالي/السابق
const at = (h, m, dayOffset = 0) => new Date(Date.UTC(2026, 8, 24 + dayOffset, h - 3, m, 0));
const fmt = (d) => new Date(d.getTime() + 3 * 3600000).toISOString().slice(0, 16).replace('T', ' ');

const day = { enabled: true, openTime: '09:00', closeTime: '23:00', breakEnabled: true, breakStart: '14:00', breakEnd: '16:00' };

// ---- دوام عادي مع استراحة الظهر ----
const cases = [
  [8, 59, false], [9, 0, true], [13, 59, true], [14, 0, false], [15, 59, false],
  [16, 0, true], [22, 59, true], [23, 0, false], [23, 30, false], [0, 0, false], [3, 0, false],
];
for (const [h, m, expected] of cases) {
  check(`عادي ${h}:${m}`, () => assert.strictEqual(isScheduledOpen(day, at(h, m)), expected));
}

// ---- بدون استراحة ----
check('الاستراحة معطلة تتجاهل أوقاتها', () =>
  assert.strictEqual(isScheduledOpen({ ...day, breakEnabled: false }, at(15, 0)), true));

// ---- دوام ليلي 18:00 → 02:00 ----
const night = { enabled: true, openTime: '18:00', closeTime: '02:00', breakEnabled: false };
for (const [h, m, expected] of [[17, 59, false], [18, 0, true], [23, 59, true], [0, 0, true], [1, 59, true], [2, 0, false], [12, 0, false]]) {
  check(`ليلي ${h}:${m}`, () => assert.strictEqual(isScheduledOpen(night, at(h, m)), expected));
}
// استراحة تعبر منتصف الليل داخل دوام ليلي
const nightBreak = { ...night, breakEnabled: true, breakStart: '23:30', breakEnd: '00:30' };
check('استراحة عابرة لمنتصف الليل', () => {
  assert.strictEqual(isScheduledOpen(nightBreak, at(23, 29)), true);
  assert.strictEqual(isScheduledOpen(nightBreak, at(23, 30)), false);
  assert.strictEqual(isScheduledOpen(nightBreak, at(0, 29)), false);
  assert.strictEqual(isScheduledOpen(nightBreak, at(0, 30)), true);
});

// ---- التوقيت: 21:00 UTC = 00:00 بغداد (اليوم التالي) ----
check('تحويل التوقيت لبغداد', () =>
  assert.strictEqual(isScheduledOpen(night, new Date(Date.UTC(2026, 8, 24, 21, 0))), true));
check('06:00 UTC = 09:00 بغداد = فتح', () =>
  assert.strictEqual(isScheduledOpen(day, new Date(Date.UTC(2026, 8, 24, 6, 0))), true));
check('05:59 UTC = 08:59 بغداد = مغلق', () =>
  assert.strictEqual(isScheduledOpen(day, new Date(Date.UTC(2026, 8, 24, 5, 59))), false));

// ---- بيانات غير صالحة لا تمنع الطلبات ----
check('وقت تالف يفتح', () => assert.strictEqual(isScheduledOpen({ openTime: 'xx', closeTime: '23:00' }, at(3, 0)), true));
check('وقتان متطابقان يفتح', () => assert.strictEqual(isScheduledOpen({ openTime: '09:00', closeTime: '09:00' }, at(3, 0)), true));

// ---- الحالة الفعلية ----
check('بدون جدولة: يتبع isOpen', () => {
  assert.strictEqual(getEffectiveIsOpen({ isOpen: true }, at(3, 0)), true);
  assert.strictEqual(getEffectiveIsOpen({ isOpen: false }, at(12, 0)), false);
  assert.strictEqual(getEffectiveIsOpen({}, at(12, 0)), true);
  assert.strictEqual(getEffectiveIsOpen({ isOpen: true, schedule: { enabled: false } }, at(3, 0)), true);
});
check('جدولة مفعّلة تتجاهل isOpen القديم', () => {
  assert.strictEqual(getEffectiveIsOpen({ isOpen: false, schedule: day }, at(12, 0)), true);
  assert.strictEqual(getEffectiveIsOpen({ isOpen: true, schedule: day }, at(3, 0)), false);
});
check('تجاوز يدوي (إغلاق) ساري ثم منتهي', () => {
  const shop = { schedule: day, overrideIsOpen: false, overrideUntil: at(16, 0) };
  assert.strictEqual(getEffectiveIsOpen(shop, at(12, 0)), false);
  assert.strictEqual(getEffectiveIsOpen(shop, at(15, 59)), false);
  assert.strictEqual(getEffectiveIsOpen(shop, at(16, 0)), true);
});
check('تجاوز يدوي (فتح استثنائي) ساري ثم منتهي', () => {
  const shop = { schedule: day, overrideIsOpen: true, overrideUntil: at(9, 0) };
  assert.strictEqual(getEffectiveIsOpen(shop, at(8, 0)), true);
  assert.strictEqual(getEffectiveIsOpen(shop, at(9, 0)), true); // الجدول نفسه مفتوح
});
check('تجاوز ناقص (بدون until أو قيمة) يُتجاهل', () => {
  assert.strictEqual(getEffectiveIsOpen({ schedule: day, overrideIsOpen: false }, at(12, 0)), true);
  assert.strictEqual(getEffectiveIsOpen({ schedule: day, overrideIsOpen: null, overrideUntil: at(23, 0) }, at(12, 0)), true);
});

// ---- أقرب تغيير بالجدول ----
check('من 22:00 → 23:00 (الإغلاق)', () =>
  assert.strictEqual(fmt(nextTransitionInstant(day, at(22, 0))), '2026-09-24 23:00'));
check('من 11:00 → 14:00 (بداية الاستراحة)', () =>
  assert.strictEqual(fmt(nextTransitionInstant(day, at(11, 0))), '2026-09-24 14:00'));
check('من 14:30 (استراحة) → 16:00', () =>
  assert.strictEqual(fmt(nextTransitionInstant(day, at(14, 30))), '2026-09-24 16:00'));
check('من 03:00 (مغلق) → 09:00', () =>
  assert.strictEqual(fmt(nextTransitionInstant(day, at(3, 0))), '2026-09-24 09:00'));
check('من 23:30 (مغلق) → 09:00 اليوم التالي', () =>
  assert.strictEqual(fmt(nextTransitionInstant(day, at(23, 30))), '2026-09-25 09:00'));
check('دوام ليلي: من 20:00 → 02:00', () =>
  assert.strictEqual(fmt(nextTransitionInstant(night, at(20, 0))), '2026-09-25 02:00'));
check('تجاهل الثواني', () =>
  assert.strictEqual(fmt(nextTransitionInstant(day, new Date(at(22, 0).getTime() + 45000))), '2026-09-24 23:00'));

// ---- التحقق من المدخلات ----
check('تطبيع الأوقات', () => {
  assert.strictEqual(normalizeTime('9:05'), '09:05');
  assert.strictEqual(normalizeTime('23:59'), '23:59');
  assert.strictEqual(normalizeTime('24:00'), null);
  assert.strictEqual(normalizeTime('12:60'), null);
  assert.strictEqual(normalizeTime('abc'), null);
  assert.strictEqual(normalizeTime(930), null);
});
check('دمج جزئي يحافظ على الباقي', () => {
  const r = mergeSchedule({ openTime: '8:30' }, day);
  assert.strictEqual(r.value.openTime, '08:30');
  assert.strictEqual(r.value.closeTime, '23:00');
  assert.strictEqual(r.value.breakEnabled, true);
});
check('رفض وقتين متطابقين عند التفعيل', () => {
  assert.ok(mergeSchedule({ enabled: true, openTime: '10:00', closeTime: '10:00' }, {}).error);
});
check('رفض استراحة متطابقة', () => {
  assert.ok(mergeSchedule({ enabled: true, breakEnabled: true, breakStart: '14:00', breakEnd: '14:00' }, {}).error);
});
check('رفض صيغة تالفة', () => assert.ok(mergeSchedule({ openTime: '99:99' }, {}).error));
check('وقتان متطابقان مسموحان لو الجدولة معطلة', () =>
  assert.ok(mergeSchedule({ enabled: false, openTime: '10:00', closeTime: '10:00' }, {}).value));

// ---- تطبيق التعديلات (نفس منطق PUT) ----
const fresh = () => ({ isOpen: true, schedule: { ...day }, overrideIsOpen: null, overrideUntil: null });

check('تفعيل الجدولة لأول مرة', () => {
  const shop = { isOpen: true };
  const r = applyScheduleChanges(shop, { schedule: day }, at(12, 0));
  assert.ok(!r.error);
  assert.strictEqual(shop.schedule.enabled, true);
  assert.strictEqual(shop.overrideUntil, null);
});
check('إغلاق وقت الدوام = تجاوز لحد بداية الاستراحة ثم الجدول', () => {
  const shop = fresh();
  applyScheduleChanges(shop, { isOpen: false }, at(11, 0));
  assert.strictEqual(shop.overrideIsOpen, false);
  assert.strictEqual(fmt(shop.overrideUntil), '2026-09-24 14:00');
  assert.strictEqual(getEffectiveIsOpen(shop, at(12, 0)), false);
  assert.strictEqual(getEffectiveIsOpen(shop, at(14, 30)), false); // استراحة
  assert.strictEqual(getEffectiveIsOpen(shop, at(16, 0)), true);   // الجدول يفتح
});
check('إغلاق 22:00 يستمر لصباح اليوم التالي ثم يفتح تلقائياً', () => {
  const shop = fresh();
  applyScheduleChanges(shop, { isOpen: false }, at(22, 0));
  assert.strictEqual(getEffectiveIsOpen(shop, at(22, 30)), false);
  assert.strictEqual(getEffectiveIsOpen(shop, at(8, 59, 1)), false);
  assert.strictEqual(getEffectiveIsOpen(shop, at(9, 0, 1)), true);
});
check('إغلاق مبكر بدون استراحة يبقى لنهاية اليوم', () => {
  const shop = { isOpen: true, schedule: { ...day, breakEnabled: false } };
  applyScheduleChanges(shop, { isOpen: false }, at(11, 0));
  assert.strictEqual(getEffectiveIsOpen(shop, at(22, 59)), false);
  assert.strictEqual(getEffectiveIsOpen(shop, at(9, 0, 1)), true);
});
check('فتح استثنائي قبل الدوام (08:00) يعمل ويسلّم للجدول 09:00', () => {
  const shop = fresh();
  applyScheduleChanges(shop, { isOpen: true }, at(8, 0));
  assert.strictEqual(shop.overrideIsOpen, true);
  assert.strictEqual(getEffectiveIsOpen(shop, at(8, 0)), true);
  assert.strictEqual(getEffectiveIsOpen(shop, at(8, 59)), true);
  assert.strictEqual(getEffectiveIsOpen(shop, at(12, 0)), true);
});
check('فتح استثنائي وقت الاستراحة يتجاوزها ويسلّم للجدول 16:00', () => {
  const shop = fresh();
  applyScheduleChanges(shop, { isOpen: true }, at(15, 0));
  assert.strictEqual(getEffectiveIsOpen(shop, at(15, 30)), true);
  assert.strictEqual(getEffectiveIsOpen(shop, at(16, 30)), true);
  assert.strictEqual(getEffectiveIsOpen(shop, at(23, 30)), false); // الجدول يسكّر بموعده
});
check('فتح بعد الإغلاق 23:30 يبقى لحد فتح الجدول التالي', () => {
  const shop = fresh();
  applyScheduleChanges(shop, { isOpen: true }, at(23, 30));
  assert.strictEqual(getEffectiveIsOpen(shop, at(1, 0, 1)), true);
  assert.strictEqual(getEffectiveIsOpen(shop, at(9, 0, 1)), true);
});
check('فتح يدوي وقت الدوام يلغي إغلاق مؤقت سابق', () => {
  const shop = fresh();
  applyScheduleChanges(shop, { isOpen: false }, at(11, 0));
  assert.strictEqual(getEffectiveIsOpen(shop, at(11, 30)), false);
  applyScheduleChanges(shop, { isOpen: true }, at(11, 30));
  assert.strictEqual(shop.overrideUntil, null);
  assert.strictEqual(getEffectiveIsOpen(shop, at(11, 30)), true);
});
check('إغلاق يدوي خارج الدوام يلغي فتحاً استثنائياً سابقاً', () => {
  const shop = fresh();
  applyScheduleChanges(shop, { isOpen: true }, at(8, 0));
  applyScheduleChanges(shop, { isOpen: false }, at(8, 30));
  assert.strictEqual(shop.overrideUntil, null);
  assert.strictEqual(getEffectiveIsOpen(shop, at(8, 45)), false);
});
check('تعطيل الجدولة يثبّت الحالة الفعلية لحظتها (مفتوح)', () => {
  const shop = { ...fresh(), isOpen: false };
  applyScheduleChanges(shop, { schedule: { enabled: false } }, at(12, 0));
  assert.strictEqual(shop.isOpen, true);
  assert.strictEqual(getEffectiveIsOpen(shop, at(3, 0)), true); // يدوي من الحين
});
check('تعطيل الجدولة خارج الدوام يثبّت مغلق', () => {
  const shop = fresh();
  applyScheduleChanges(shop, { schedule: { enabled: false } }, at(3, 0));
  assert.strictEqual(shop.isOpen, false);
});
check('تعطيل الجدولة أثناء إغلاق مؤقت يثبّت مغلق', () => {
  const shop = fresh();
  applyScheduleChanges(shop, { isOpen: false }, at(11, 0));
  applyScheduleChanges(shop, { schedule: { enabled: false } }, at(12, 0));
  assert.strictEqual(shop.isOpen, false);
  assert.strictEqual(shop.overrideUntil, null);
});
check('بدون جدولة الزر اليدوي كالسابق', () => {
  const shop = { isOpen: true };
  applyScheduleChanges(shop, { isOpen: false }, at(12, 0));
  assert.strictEqual(shop.isOpen, false);
  applyScheduleChanges(shop, { isOpen: true }, at(12, 0));
  assert.strictEqual(shop.isOpen, true);
  assert.strictEqual(shop.overrideUntil, undefined);
});
check('تعديل أوقات الدوام يمسح التجاوز', () => {
  const shop = fresh();
  applyScheduleChanges(shop, { isOpen: false }, at(11, 0));
  applyScheduleChanges(shop, { schedule: { closeTime: '22:00' } }, at(12, 0));
  assert.strictEqual(shop.overrideUntil, null);
  assert.strictEqual(shop.overrideIsOpen, null);
  assert.strictEqual(shop.schedule.closeTime, '22:00');
});
check('خطأ تحقق لا يعدّل المحل', () => {
  const shop = fresh();
  const r = applyScheduleChanges(shop, { schedule: { openTime: 'bad' }, isOpen: false }, at(12, 0));
  assert.ok(r.error);
  assert.strictEqual(shop.schedule.openTime, '09:00');
  assert.strictEqual(shop.overrideUntil, null);
});

// ---- الإرسال للتطبيقات ----
check('serializeShop يضع isOpen الفعلي', () => {
  const shop = { name: 'x', isOpen: true, schedule: day };
  assert.strictEqual(serializeShop(shop, at(3, 0)).isOpen, false);
  assert.strictEqual(serializeShop(shop, at(12, 0)).isOpen, true);
  assert.strictEqual(serializeShop(shop, at(12, 0)).name, 'x');
});

console.log(process.exitCode ? 'بعض الاختبارات فشلت' : `كل الاختبارات نجحت (${passed})`);
