const { randomUUID } = require('crypto');
const Jimp = require('jimp');
const { getStorage } = require('firebase-admin/storage');
const { initFirebaseAdmin } = require('../config/firebaseAdmin');

const DATA_URI_RE = /^data:image\/(\w+);base64,(.+)$/;

// يضغط الصورة قبل الرفع (تصغير الأبعاد + ضغط الجودة) — صور كاميرا الهاتف
// توصل أحياناً بأبعاد 3000-4000 بكسل وحجم عدة ميجابايت، وهذا يستهلك مساحة
// تخزين ونقل بيانات (bandwidth) حقيقي على Firebase Storage بلا داعي، خصوصاً
// إنها تترفع من كل زبون يفتح التطبيق ويشوف صور المحلات/المنتجات. لو فشل
// الضغط لأي سبب (صيغة غير مدعومة مثلاً)، نرفع الصورة الأصلية بدون تعديل
// بدل ما نوقف عملية الإضافة/التعديل كاملة
async function compressImageBuffer(buffer, maxDimension = 1000, quality = 75) {
  try {
    const image = await Jimp.read(buffer);
    if (image.bitmap.width > maxDimension || image.bitmap.height > maxDimension) {
      if (image.bitmap.width >= image.bitmap.height) {
        image.resize(maxDimension, Jimp.AUTO);
      } else {
        image.resize(Jimp.AUTO, maxDimension);
      }
    }
    image.quality(quality);
    const outBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
    return { buffer: outBuffer, contentType: 'image/jpeg', ext: 'jpg' };
  } catch (error) {
    console.error('فشل ضغط الصورة، سترفع كما هي:', error.message);
    return null;
  }
}

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

    let ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    let buffer = Buffer.from(match[2], 'base64');
    let contentType = `image/${match[1]}`;

    const compressed = await compressImageBuffer(buffer);
    if (compressed) {
      buffer = compressed.buffer;
      contentType = compressed.contentType;
      ext = compressed.ext;
    }

    const bucket = getStorage().bucket();
    const filename = `${folder}/${Date.now()}-${randomUUID()}.${ext}`;
    const file = bucket.file(filename);

    await file.save(buffer, {
      metadata: {
        contentType,
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
