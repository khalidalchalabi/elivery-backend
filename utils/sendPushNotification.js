const { getMessaging } = require('firebase-admin/messaging');
const { initFirebaseAdmin } = require('../config/firebaseAdmin');

// يرسل إشعار Push لمستخدم واحد عبر رمز جهازه (FCM token) المخزّن على حسابه
// يفشل بصمت (يسجّل بس بالـ console) بدل ما يوقف أي طلب API، حتى لو Firebase مو مهيّأ
async function sendPushToUser(user, { title, body, data = {} } = {}) {
  try {
    if (!user || !user.fcmToken) return { sent: false, reason: 'no_token' };
    if (!initFirebaseAdmin()) return { sent: false, reason: 'not_configured' };

    await getMessaging().send({
      token: user.fcmToken,
      notification: { title, body },
      // priority: high + صوت افتراضي صريح، حتى توصل الإشعارات فوراً وبصوت
      // حتى لو التطبيق مسكر بالكامل بالخلفية (وليس بس مفتوح بالمقدمة)
      android: { priority: 'high', notification: { sound: 'default' } },
      apns: { payload: { aps: { sound: 'default' } } },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
    });
    return { sent: true };
  } catch (error) {
    console.error('فشل إرسال إشعار Push:', error.message);
    return { sent: false, reason: error.message };
  }
}

// يرسل إشعار Push لكل الأجهزة المشتركة بموضوع معيّن (broadcast جماعي)
// كل أجهزة الزبائن تشترك بموضوع "promotions" تلقائياً عند تسجيل رمزها
async function sendPushToTopic(topic, { title, body, data = {} } = {}) {
  try {
    if (!initFirebaseAdmin()) return { sent: false, reason: 'not_configured' };

    await getMessaging().send({
      topic,
      notification: { title, body },
      android: { priority: 'high', notification: { sound: 'default' } },
      apns: { payload: { aps: { sound: 'default' } } },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
    });
    return { sent: true };
  } catch (error) {
    console.error('فشل إرسال إشعار Push للموضوع:', error.message);
    return { sent: false, reason: error.message };
  }
}

module.exports = { sendPushToUser, sendPushToTopic };
