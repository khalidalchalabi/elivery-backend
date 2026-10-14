// يحوّل نص بحث المستخدم لنمط RegExp آمن ومتسامح مع اختلافات الكتابة العربية الشائعة
// (أ/إ/آ/ا، ى/ي، ة/ه) بحيث "تفاح" و"تفّاح" و"اناناس" و"أناناس" تتطابق
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function flexibleArabicPattern(input) {
  const cleaned = String(input || '')
    .trim()
    // نشيل التشكيل والتطويل
    .replace(/[ً-ٰٟـ]/g, '');
  let out = '';
  for (const ch of cleaned) {
    if ('اأإآ'.includes(ch)) out += '[اأإآ]';
    else if ('ىي'.includes(ch)) out += '[ىي]';
    else if ('ةه'.includes(ch)) out += '[ةه]';
    else out += escapeRegex(ch);
  }
  return out;
}

module.exports = { escapeRegex, flexibleArabicPattern };
