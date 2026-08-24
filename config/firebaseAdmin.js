const { initializeApp, cert, getApps } = require('firebase-admin/app');

let initialized = false;

// يهيّئ Firebase Admin SDK من متغير البيئة FIREBASE_SERVICE_ACCOUNT
// (محتوى ملف مفتاح حساب الخدمة كامل بصيغة JSON، مضغوط بسطر واحد)
function initFirebaseAdmin() {
  if (initialized) return getApps().length > 0;
  initialized = true;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.warn('FIREBASE_SERVICE_ACCOUNT غير معرّف — إشعارات Push معطّلة.');
    return false;
  }

  try {
    const serviceAccount = JSON.parse(raw);
    initializeApp({
      credential: cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'sooqalkhalis.firebasestorage.app',
    });
    console.log('Firebase Admin تم تهيئته بنجاح — إشعارات Push وتخزين الصور مفعّلة.');
    return true;
  } catch (error) {
    console.error('فشل تهيئة Firebase Admin:', error.message);
    return false;
  }
}

module.exports = { initFirebaseAdmin };
