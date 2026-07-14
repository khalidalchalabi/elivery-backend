const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./config/db');

const path = require('path');

// تحميل إعدادات البيئة
dotenv.config();

// الاتصال بقاعدة البيانات MongoDB
connectDB();

const app = express();

// برمجيات وسيطة (Middlewares)
app.use(cors());
app.use(express.json({ limit: '50mb' })); // زيادة الحد لتحميل صور base64
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// خدمة الملفات المرفوعة بشكل استاتيكي
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// المسارات (Routes)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/shops', require('./routes/shops'));
app.use('/api/ads', require('./routes/ads'));

// اختبار تشغيل الخادم
app.get('/', (req, res) => {
  res.json({ message: 'مرحباً بك في الخلفية البرمجية لتطبيق التوصيل!' });
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
