const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./config/db');

const path = require('path');

// تحميل إعدادات البيئة
dotenv.config();

// الاتصال بقاعدة البيانات MongoDB
connectDB().then(() => {
  seedDefaultCategories();
});

// دالة لتغذية قاعدة البيانات تلقائياً بالأقسام الافتراضية
async function seedDefaultCategories() {
  try {
    const Category = require('./models/Category');
    const count = await Category.countDocuments();
    if (count === 0) {
      const defaults = [
        { name: 'مطاعم', displayName: 'المطاعم', emoji: '🍔🍟', tag: 'حتى 50%', backgroundColor: '#E6FDF4', order: 0 },
        { name: 'سوبر ماركت', displayName: 'سوبر ماركت', emoji: '🛒🍎', tag: 'سريع', backgroundColor: '#ECFDF5', order: 1 },
        { name: 'خضار وفواكه', displayName: 'البقالة', emoji: '🥦🍊', tag: 'طازج', backgroundColor: '#FEF3C7', order: 2 },
        { name: 'أجهزة إلكترونية', displayName: 'المتاجر', emoji: '🎧🧸', tag: 'منوع', backgroundColor: '#F3E8FF', order: 3 },
      ];
      await Category.insertMany(defaults);
      console.log('Successfully seeded default categories into database.');
    }
  } catch (err) {
    console.error('Error seeding categories:', err);
  }
}

const rateLimit = require('express-rate-limit');
const app = express();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 20, // 20 محاولة كحد أقصى في 15 دقيقة
  message: {
    success: false,
    message: 'تم حظر محاولات الدخول الزائدة مؤقتاً لحماية الحساب. يرجى المحاولة بعد 15 دقيقة.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// برمجيات وسيطة (Middlewares)
app.use('/api/auth/login', loginLimiter);
app.use(cors());
app.use(express.json({ limit: '50mb' })); // زيادة الحد لتحميل صور base64
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// [تشخيص مؤقت] معرفة إصدار الكود المنشور فعلياً على السيرفر
app.get('/api/version', (req, res) => {
  res.json({ commit: process.env.RENDER_GIT_COMMIT || null, bootedAt: new Date().toISOString() });
});

// المسارات (Routes)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/shops', require('./routes/shops'));
app.use('/api/ads', require('./routes/ads'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/promo', require('./routes/promo'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/settings', require('./routes/settings'));

// خدمة الملفات المرفوعة بشكل استاتيكي
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// مسارات التحميل المباشر لملفات الـ APK
app.get('/daqeqa-staff.apk', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/daqeqa-staff.apk'));
});

app.get('/daqeqa-customer.apk', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/daqeqa-customer.apk'));
});

// تقديم ملفات التحميل المباشر والملفات العامة (APKs)
app.use(express.static(path.join(__dirname, 'public')));

// تقديم موقع الزبون (Flutter Web)
app.use('/customer', express.static(path.join(__dirname, 'public/customer')));
app.get(/^\/customer($|\/.*)/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/customer', 'index.html'));
});

// تقديم موقع الكادر لوحة التحكم (Flutter Web) عند / أو /staff أو /admin
app.use('/staff', express.static(path.join(__dirname, 'public/web')));
app.use('/admin', express.static(path.join(__dirname, 'public/web')));
app.use(express.static(path.join(__dirname, 'public/web')));

app.get(/^\/(staff|admin)($|\/.*)/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/web', 'index.html'));
});

// توجيه عام للموقع الرئيسي (توافقية Express 5 الكاملة)
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'المسار غير موجود' });
  }
  res.sendFile(path.join(__dirname, 'public/web', 'index.html'));
});

// معالج الأخطاء العام
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'حدث خطأ في الخادم الداخلي' });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running in development mode on port ${PORT}`);
});
