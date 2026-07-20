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

const app = express();

// برمجيات وسيطة (Middlewares)
app.use(cors());
app.use(express.json({ limit: '50mb' })); // زيادة الحد لتحميل صور base64
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// خدمة الملفات المرفوعة بشكل استاتيكي
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// تقديم موقع الزبون (Flutter Web)
app.use('/customer', express.static(path.join(__dirname, 'public/customer')));

// صفحة سياسة الخصوصية الرسمية لمتجر جوجل بلاي
app.get('/privacy.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/privacy.html'));
});

// تقديم موقع الكادر (Flutter Web) من المجلد الرئيسي
app.use(express.static(path.join(__dirname, 'public/web')));

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

// اختبار تشغيل الخادم
app.get('/', (req, res) => {
  res.json({ message: 'مرحباً بك في الخلفية البرمجية لتطبيق التوصيل!' });
});

// التوجيه لدعم روابط SPA لتطبيق الزبون (باستخدام RegExp لتفادي أخطاء المترجم)
app.get(/^\/customer($|\/.*)/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/customer', 'index.html'));
});

// التعامل مع المسارات غير الموجودة (404)
app.use((req, res, next) => {
  res.status(404).json({ success: false, message: 'المسار غير موجود' });
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
