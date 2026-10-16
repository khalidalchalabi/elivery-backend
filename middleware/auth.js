const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// مفتاح توقيع التوكن: يُفضَّل ضبط JWT_SECRET بمتغيرات بيئة Render. لو غير مضبوط نشتق
// مفتاحاً ثابتاً وسرياً من MONGO_URI (موجود أصلاً بالإنتاج وسري) بدل مفتاح ثابت
// معروف بالكود، لأن أي مفتاح معروف يخلّي أي شخص يزوّر توكن مالك ويفتح القفل بالكامل
function resolveSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.MONGO_URI) {
    console.warn('⚠️  JWT_SECRET غير مضبوط — يُشتق مفتاح التوقيع من MONGO_URI. أضف JWT_SECRET بلوحة تحكم Render.');
    return crypto.createHmac('sha256', process.env.MONGO_URI).update('daqeqa-jwt-v1').digest('hex');
  }
  console.warn('⚠️  لا JWT_SECRET ولا MONGO_URI — مفتاح تطوير محلي فقط، لا تستخدمه بالإنتاج.');
  return 'daqeqa-local-dev-only-secret';
}

const JWT_SECRET = resolveSecret();
const TOKEN_EXPIRY = '30d';

function signToken(user) {
  const payload = { id: user._id.toString(), role: user.role };
  if (user.shop) payload.shop = user.shop.toString();
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

// يتحقق من Authorization: Bearer <token> ثم يقرأ الحساب من قاعدة البيانات، فالدور المعتمد
// هو الدور الحالي بالقاعدة (مو المكتوب بالتوكن)، والحساب المجمّد أو المحذوف يُرفض فوراً
// بدل ما يظل مفتوحاً حتى انتهاء التوكن (30 يوم). accountRevoked يخلّي التطبيقات تسجّل الخروج.
async function verifyToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ success: false, message: 'يجب تسجيل الدخول للوصول لهذا المسار' });
  }
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ success: false, message: 'جلسة الدخول منتهية أو غير صالحة، الرجاء تسجيل الدخول من جديد' });
  }
  try {
    const user = await User.findById(decoded.id).select('role isActive shop');
    if (!user || user.isActive === false) {
      return res.status(401).json({ success: false, message: 'هذا الحساب غير متاح', accountRevoked: true });
    }
    req.user = { id: user._id.toString(), role: user.role, shop: user.shop ? user.shop.toString() : null };
    next();
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

// يُستخدم بعد verifyToken — يسمح فقط للأدوار المذكورة
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'ليس لديك صلاحية الوصول لهذا المسار' });
    }
    next();
  };
}

module.exports = { signToken, verifyToken, requireRole, JWT_SECRET };
