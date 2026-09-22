const jwt = require('jsonwebtoken');

// لازم يُضاف متغير بيئة JWT_SECRET حقيقي على Render (لوحة التحكم → Environment)
// — هذا الاحتياطي هنا بس حتى السيرفر ما ينهار لو نسينا نضبطه، مو للاعتماد
// عليه بالإنتاج الفعلي
const JWT_SECRET = process.env.JWT_SECRET || 'daqeqa-dev-fallback-secret-change-me';
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET غير مضبوط بمتغيرات البيئة — يستخدم السيرفر مفتاح احتياطي غير آمن للإنتاج. أضف JWT_SECRET بلوحة تحكم Render فوراً.');
}

const TOKEN_EXPIRY = '30d';

function signToken(user) {
  const payload = { id: user._id.toString(), role: user.role };
  // نحفظ متجر التاجر بالتوكن نفسه — يغني عن استعلام قاعدة بيانات إضافي
  // بكل طلب حتى نتحقق هل هذا المحل فعلاً محله
  if (user.shop) payload.shop = user.shop.toString();
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

// يتحقق من توكن Authorization: Bearer <token> ويضيف req.user = {id, role}
function verifyToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ success: false, message: 'يجب تسجيل الدخول للوصول لهذا المسار' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { id: decoded.id, role: decoded.role, shop: decoded.shop || null };
    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: 'جلسة الدخول منتهية أو غير صالحة، الرجاء تسجيل الدخول من جديد' });
  }
}

// يُستخدم بعد verifyToken — يتأكد إن دور المستخدم ضمن الأدوار المسموحة
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'ليس لديك صلاحية الوصول لهذا المسار' });
    }
    next();
  };
}

// يسمح للإدارة/الدعم بأي محل، وللتاجر بمحله الخاص بس — يقارن معامل المسار
// المحدد (افتراضياً :shopId) بمتجر المستخدم المسجّل بالتوكن. لازم تجي بعد verifyToken.
function requireShopAccess(paramName = 'shopId') {
  return (req, res, next) => {
    if (['admin', 'owner', 'accountant', 'support'].includes(req.user.role)) return next();
    if (req.user.role === 'merchant' && req.user.shop && req.user.shop === req.params[paramName]) {
      return next();
    }
    return res.status(403).json({ success: false, message: 'ليس لديك صلاحية على هذا المحل' });
  };
}

module.exports = { signToken, verifyToken, requireRole, requireShopAccess, JWT_SECRET };
