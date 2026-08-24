const { randomUUID } = require('crypto');
const { getStorage } = require('firebase-admin/storage');
const { initFirebaseAdmin } = require('../config/firebaseAdmin');

const DATA_URI_RE = /^data:image\/(\w+);base64,(.+)$/;

// يرفع صورة base64 إلى Firebase Storage ويرجّع رابط عام دائم بدلها.
// إذا كان النص أصلاً رابط (http) أو إيموجي (مو صورة base64)، يرجّعه كما هو.
// إذا فشل الرفع لأي سبب (مفتاح غير مهيّأ، مشكلة شبكة...) يرجع النص الأصلي
// كخطة احتياطية حتى ما توقف عملية إضافة/تعديل المنتج أو المحل.
async function saveBase64Image(base64Str, folder = 'misc') {
  if (!base64Str || typeof base64Str !== 'string') return base64Str;
  if (base64Str.startsWith('http')) return base64Str;

  const match = base64Str.match(DATA_URI_RE);
  if (!match) return base64Str;

  try {
    if (!initFirebaseAdmin()) return base64Str;

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');
    const bucket = getStorage().bucket();
    const filename = `${folder}/${Date.now()}-${randomUUID()}.${ext}`;
    const file = bucket.file(filename);

    await file.save(buffer, {
      metadata: {
        contentType: `image/${match[1]}`,
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
    await file.makePublic();

    return `https://storage.googleapis.com/${bucket.name}/${filename}`;
  } catch (error) {
    console.error('فشل رفع الصورة لـ Firebase Storage:', error.message);
    return base64Str;
  }
}

module.exports = { saveBase64Image };
