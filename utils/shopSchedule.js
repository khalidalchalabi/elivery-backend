// ساعات دوام المحل (فتح/إغلاق تلقائي + استراحة الظهر).
// كل الأوقات بصيغة 'HH:mm' بتوقيت بغداد (UTC+3 ثابت — العراق بلا توقيت صيفي).
// الحالة الفعلية (مفتوح/مغلق) تُحسب لحظة الطلب من الجدول نفسه، مو بمؤقت خلفي —
// لأن السيرفر قد يكون نايم (Render) وقت حدود الفتح/الإغلاق فمؤقت خلفي يفوّتها.

const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const SCAN_LIMIT_MINUTES = 49 * 60;

const DEFAULT_SCHEDULE = {
  enabled: false,
  openTime: '09:00',
  closeTime: '23:00',
  breakEnabled: false,
  breakStart: '14:00',
  breakEnd: '16:00',
};

// يقبل 'H:mm' أو 'HH:mm' ويرجّع 'HH:mm' موحّدة، أو null لو غير صالح
function normalizeTime(value) {
  if (typeof value !== 'string') return null;
  const m = TIME_RE.exec(value.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function toMinutes(value) {
  const t = normalizeTime(value);
  if (!t) return null;
  return parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3), 10);
}

function baghdadMinutes(date) {
  const d = new Date(date.getTime() + BAGHDAD_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

// هل الدقيقة m ضمن [start, end)؟ يدعم المدى الليلي (مثلاً 18:00 → 02:00)
function inRange(m, start, end) {
  if (start === end) return false;
  return start < end ? m >= start && m < end : m >= start || m < end;
}

// هل الجدول يعتبر المحل مفتوح بهذا الوقت؟ (يتجاهل التجاوز اليدوي)
function isScheduledOpen(schedule, date = new Date()) {
  const open = toMinutes(schedule.openTime);
  const close = toMinutes(schedule.closeTime);
  // بيانات غير صالحة أو متطابقة: ما نقدر نحكم، فنفتح بدل ما نمنع طلبات حقيقية
  if (open === null || close === null || open === close) return true;

  const m = baghdadMinutes(date);
  if (!inRange(m, open, close)) return false;

  if (schedule.breakEnabled) {
    const bs = toMinutes(schedule.breakStart);
    const be = toMinutes(schedule.breakEnd);
    if (bs !== null && be !== null && inRange(m, bs, be)) return false;
  }
  return true;
}

// الحالة الفعلية للمحل: الجدولة (لو مفعّلة) مع التجاوز اليدوي المؤقت (إغلاق أو فتح
// استثنائي) لو ساري، وإلا الزر اليدوي القديم
function getEffectiveIsOpen(shop, now = new Date()) {
  const s = shop.schedule;
  if (!s || !s.enabled) return shop.isOpen !== false;
  if (
    typeof shop.overrideIsOpen === 'boolean' &&
    shop.overrideUntil &&
    now < new Date(shop.overrideUntil)
  ) {
    return shop.overrideIsOpen;
  }
  return isScheduledOpen(s, now);
}

// أقرب لحظة يتغير فيها حكم الجدول (مفتوح→مغلق أو العكس) بعد from. تُستخدم لتحديد
// نهاية التجاوز اليدوي: الزر اليدوي يتجاوز الجدول لحد أقرب تغيير قادم فيه، وبعدها
// يرجع الجدول يمشي لوحده. null لو ما لقينا خلال يومين (ما يصير مع جدول صالح)
function nextTransitionInstant(schedule, from = new Date()) {
  const start = new Date(Math.floor(from.getTime() / 60000) * 60000);
  const current = isScheduledOpen(schedule, start);
  for (let i = 1; i <= SCAN_LIMIT_MINUTES; i++) {
    const t = new Date(start.getTime() + i * 60000);
    if (isScheduledOpen(schedule, t) !== current) return t;
  }
  return null;
}

function toBool(v) {
  return v === true || v === 'true';
}

// يدمج تعديلاً جزئياً على الجدول الحالي ويتحقق منه. يرجّع { value } أو { error }
function mergeSchedule(patch, current) {
  if (!patch || typeof patch !== 'object') return { error: 'بيانات ساعات الدوام غير صالحة' };
  const cur = current || {};
  const base = {
    enabled: !!cur.enabled,
    openTime: cur.openTime || DEFAULT_SCHEDULE.openTime,
    closeTime: cur.closeTime || DEFAULT_SCHEDULE.closeTime,
    breakEnabled: !!cur.breakEnabled,
    breakStart: cur.breakStart || DEFAULT_SCHEDULE.breakStart,
    breakEnd: cur.breakEnd || DEFAULT_SCHEDULE.breakEnd,
  };

  const next = { ...base };
  if (patch.enabled !== undefined) next.enabled = toBool(patch.enabled);
  if (patch.breakEnabled !== undefined) next.breakEnabled = toBool(patch.breakEnabled);

  const timeFields = [
    ['openTime', 'وقت الفتح'],
    ['closeTime', 'وقت الإغلاق'],
    ['breakStart', 'بداية الاستراحة'],
    ['breakEnd', 'نهاية الاستراحة'],
  ];
  for (const [field, label] of timeFields) {
    if (patch[field] === undefined) continue;
    const t = normalizeTime(patch[field]);
    if (!t) return { error: `${label} غير صالح، استخدم صيغة مثل 09:30` };
    next[field] = t;
  }

  if (next.enabled && next.openTime === next.closeTime) {
    return { error: 'وقت الفتح ووقت الإغلاق متطابقان — حدد وقتين مختلفين' };
  }
  if (next.enabled && next.breakEnabled && next.breakStart === next.breakEnd) {
    return { error: 'بداية ونهاية الاستراحة متطابقتان — حدد وقتين مختلفين' };
  }
  return { value: next };
}

// يطبّق تعديلات الدوام/الزر اليدوي على كائن المحل (mongoose doc أو كائن عادي).
// يرجّع { error } عند فشل التحقق، أو {} عند النجاح — لا يحفظ، الحفظ على المُستدعي
function applyScheduleChanges(shop, { schedule, isOpen }, now = new Date()) {
  const wasEnabled = !!(shop.schedule && shop.schedule.enabled);
  const effectiveBefore = getEffectiveIsOpen(shop, now);

  if (schedule !== undefined) {
    const result = mergeSchedule(schedule, shop.schedule);
    if (result.error) return { error: result.error };
    shop.schedule = result.value;
    // أي تعديل بالدوام يبدأ صفحة جديدة
    shop.overrideIsOpen = null;
    shop.overrideUntil = null;
    // عند تعطيل الجدولة نثبّت الحالة اللي كانت فعلية لحظتها حتى ما ينقلب المحل فجأة
    if (wasEnabled && !result.value.enabled) shop.isOpen = effectiveBefore;
  }

  if (isOpen !== undefined) {
    const wantOpen = toBool(isOpen);
    if (shop.schedule && shop.schedule.enabled) {
      // بوضع الجدولة الزر اليدوي يشتغل بالاتجاهين: لو طلبك يخالف حكم الجدول هذي اللحظة
      // (إغلاق وقت الدوام، أو فتح خارجه/وقت الاستراحة) يصير تجاوز مؤقت لحد أقرب تغيير
      // قادم بالجدول. لو يطابق الجدول فنلغي أي تجاوز سابق ونرجع للجدول
      if (wantOpen === isScheduledOpen(shop.schedule, now)) {
        shop.overrideIsOpen = null;
        shop.overrideUntil = null;
      } else {
        shop.overrideIsOpen = wantOpen;
        shop.overrideUntil =
          nextTransitionInstant(shop.schedule, now) || new Date(now.getTime() + 12 * 60 * 60 * 1000);
      }
    } else {
      shop.isOpen = wantOpen;
    }
  }
  return {};
}

// نسخة للإرسال للتطبيقات: نفس الحقل isOpen لكن بقيمته الفعلية — فتشتغل التطبيقات
// القديمة بدون أي تحديث لأنها أصلاً تقرأ isOpen
function serializeShop(shop, now = new Date()) {
  const obj = typeof shop.toObject === 'function' ? shop.toObject() : { ...shop };
  obj.isOpen = getEffectiveIsOpen(shop, now);
  return obj;
}

module.exports = {
  DEFAULT_SCHEDULE,
  normalizeTime,
  isScheduledOpen,
  getEffectiveIsOpen,
  nextTransitionInstant,
  mergeSchedule,
  applyScheduleChanges,
  serializeShop,
};
