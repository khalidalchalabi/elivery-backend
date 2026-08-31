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
  seedDefaultRegionAndBackfill();
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

// دالة idempotent تشتغل كل إقلاع: تضمن وجود منطقة افتراضية واحدة (بنفس مركز
// الخالص الافتراضي القديم ونفس قيمة delivery_radius الحالية)، وتهاجر أي محل/
// سائق/طلب بلا منطقة إليها — آمنة تشتغل بالتوازي مع حركة حية بدون أي نافذة صيانة
async function seedDefaultRegionAndBackfill() {
  try {
    const Region = require('./models/Region');
    const Shop = require('./models/Shop');
    const User = require('./models/User');
    const Order = require('./models/Order');
    const Setting = require('./models/Setting');
    const { DEFAULT_REGION_NAME } = require('./utils/regionHelper');

    let defaultRegion = await Region.findOne({ name: DEFAULT_REGION_NAME });
    if (!defaultRegion) {
      const radiusSetting = await Setting.findOne({ key: 'delivery_radius' });
      const radiusKm = radiusSetting && typeof radiusSetting.value === 'number' ? radiusSetting.value : 15.0;
      defaultRegion = await Region.create({
        name: DEFAULT_REGION_NAME,
        center: { type: 'Point', coordinates: [44.5241, 33.8245] }, // نفس Shop.location الافتراضي
        radiusKm,
        isActive: true,
      });
      console.log('[region-migration] created default region:', defaultRegion._id.toString());
    }

    const [shopResult, driverResult, orderResult] = await Promise.all([
      Shop.updateMany({ region: null }, { $set: { region: defaultRegion._id } }),
      User.updateMany({ role: 'driver', region: null }, { $set: { region: defaultRegion._id } }),
      Order.updateMany({ region: null }, { $set: { region: defaultRegion._id } }),
    ]);
    if (shopResult.modifiedCount || driverResult.modifiedCount || orderResult.modifiedCount) {
      console.log(
        `[region-migration] backfilled: ${shopResult.modifiedCount} shops, ${driverResult.modifiedCount} drivers, ${orderResult.modifiedCount} orders`
      );
    }
  } catch (err) {
    console.error('[region-migration] error:', err);
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
app.use('/api/complaints', require('./routes/complaints'));
app.use('/api/regions', require('./routes/regions'));

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
