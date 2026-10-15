// وقت توفر المنتج خلال اليوم (من ساعة إلى ساعة). كل الأوقات 'HH:mm' بتوقيت بغداد (UTC+3).
// الحالة الفعلية تُحسب لحظة الطلب (مثل ساعات دوام المحل) فلا يلزم مؤقت خلفي.
//
// الفعلي = الزر اليدوي (isAvailable) مفعّل  و  (التوقيت غير مفعّل  أو  الوقت الحالي ضمن [from, to)).
// أي أن الزر اليدوي يمنع المنتج دائماً، والتوقيت يمنعه خارج نافذته فقط.

const { normalizeTime } = require('./shopSchedule');

const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;

const DEFAULT_AVAILABILITY = { enabled: false, from: '08:00', to: '23:00' };

function toMinutes(value) {
  const t = normalizeTime(value);
  if (!t) return null;
  return parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3), 10);
}

function baghdadMinutes(date) {
  const d = new Date(date.getTime() + BAGHDAD_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

// [start, end) مع دعم المدى الليلي
function inRange(m, start, end) {
  if (start === end) return false;
  return start < end ? m >= start && m < end : m >= start || m < end;
}

// هل نافذة التوفر تسمح بالمنتج الآن؟ (بدون النظر للزر اليدوي)
function isWithinWindow(availability, now = new Date()) {
  if (!availability || !availability.enabled) return true;
  const from = toMinutes(availability.from);
  const to = toMinutes(availability.to);
  // بيانات غير صالحة أو متطابقة: ما نقدر نحكم، فنتركه متاحاً بدل ما نخفي منتجاً بالغلط
  if (from === null || to === null || from === to) return true;
  return inRange(baghdadMinutes(now), from, to);
}

function isAvailableNow(product, now = new Date()) {
  if (product.isAvailable === false) return false;
  return isWithinWindow(product.availability, now);
}

// يتحقق من إدخال التاجر ويرجّع { value } أو { error }. undefined = بدون تغيير
function mergeAvailability(patch, current) {
  if (patch === undefined || patch === null) return { value: undefined };
  if (typeof patch !== 'object') return { error: 'بيانات وقت التوفر غير صالحة' };
  const cur = current || {};
  const next = {
    enabled: !!cur.enabled,
    from: cur.from || DEFAULT_AVAILABILITY.from,
    to: cur.to || DEFAULT_AVAILABILITY.to,
  };
  if (patch.enabled !== undefined) next.enabled = patch.enabled === true || patch.enabled === 'true';
  for (const [field, label] of [['from', 'وقت بداية التوفر'], ['to', 'وقت نهاية التوفر']]) {
    if (patch[field] === undefined) continue;
    const t = normalizeTime(patch[field]);
    if (!t) return { error: `${label} غير صالح، استخدم صيغة مثل 07:30` };
    next[field] = t;
  }
  if (next.enabled && next.from === next.to) {
    return { error: 'وقت بداية ونهاية التوفر متطابقان — حدد وقتين مختلفين' };
  }
  return { value: next };
}

// نسخة للإرسال للتطبيقات:
//  - isAvailable: الفعلي الآن (فتشتغل التطبيقات القديمة بدون أي تحديث لأنها تقرأ هذا الحقل)
//  - manualAvailable: الزر اليدوي الخام (لتطبيق الكادر حتى يعرض مفتاح التاجر الحقيقي)
//  - availability: نافذة الوقت للعرض ("متوفر من ... إلى ...")
function serializeProduct(product, now = new Date()) {
  const obj = typeof product.toObject === 'function' ? product.toObject() : { ...product };
  obj.manualAvailable = product.isAvailable !== false;
  obj.isAvailable = isAvailableNow(product, now);
  obj.availability = {
    enabled: !!(product.availability && product.availability.enabled),
    from: (product.availability && product.availability.from) || DEFAULT_AVAILABILITY.from,
    to: (product.availability && product.availability.to) || DEFAULT_AVAILABILITY.to,
  };
  return obj;
}

module.exports = {
  DEFAULT_AVAILABILITY,
  isWithinWindow,
  isAvailableNow,
  mergeAvailability,
  serializeProduct,
};
