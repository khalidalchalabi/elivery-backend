const express = require('express');
const router = Router = express.Router();
const Ad = require('../models/Ad');
const fs = require('fs');
const path = require('path');

// دالة مساعدة لحفظ الصورة المرفوعة كـ base64 كملف محلي
function saveBase64Image(base64Str, req) {
  if (!base64Str || !base64Str.startsWith('data:image/')) {
    return base64Str; // إرجاع الرابط كما هو إذا كان رابطاً بالفعل
  }

  const matches = base64Str.match(/^data:image\/([A-Za-z0-9+-]+);base64,([\s\S]+)$/);
  if (!matches || matches.length !== 3) {
    return base64Str;
  }

  const ext = matches[1];
  const data = matches[2];
  const buffer = Buffer.from(data, 'base64');

  // التأكد من وجود مجلد الرفع
  const dir = path.join(__dirname, '../public/uploads');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filename = `ad_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, buffer);

  // إرجاع الرابط الكامل للوصول للصورة
  const host = req.headers.host;
  return `${req.protocol}://${host}/uploads/${filename}`;
}

// @desc    جلب كافة الإعلانات النشطة
// @route   GET /api/ads
router.get('/', async (req, res) => {
  try {
    const ads = await Ad.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: ads.length, data: ads });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    إضافة إعلان جديد (خاص بالمالك والمدير)
// @route   POST /api/ads
router.post('/', async (req, res) => {
  try {
    const { title, subtitle, actionText, imagePath, userRole, type } = req.body;

    // التحقق من الصلاحيات
    if (userRole !== 'owner' && userRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بإدارة الإعلانات. المالك والمدير فقط!' });
    }

    const isBanner = (!type || type === 'banner');
    if (!title || (isBanner && !imagePath)) {
      return res.status(400).json({ success: false, message: 'الرجاء إدخال عنوان الإعلان. وللإعلانات الرئيسية يجب إرفاق صورة.' });
    }

    // حفظ الصورة إذا كانت base64
    const resolvedImagePath = saveBase64Image(imagePath, req);

    const ad = new Ad({
      title,
      subtitle,
      actionText: actionText || 'اطلب الآن',
      imagePath: resolvedImagePath,
      type: type || 'banner',
    });

    await ad.save();

    res.status(201).json({
      success: true,
      message: 'تم إضافة الإعلان بنجاح',
      data: ad,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تعديل إعلان موجود (خاص بالمالك والمدير)
// @route   PUT /api/ads/:id
router.put('/:id', async (req, res) => {
  try {
    const { title, subtitle, actionText, imagePath, userRole, type } = req.body;

    // التحقق من الصلاحيات
    if (userRole !== 'owner' && userRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بإدارة الإعلانات. المالك والمدير فقط!' });
    }

    const ad = await Ad.findById(req.params.id);
    if (!ad) {
      return res.status(404).json({ success: false, message: 'الإعلان غير موجود' });
    }

    if (title) ad.title = title;
    if (subtitle !== undefined) ad.subtitle = subtitle;
    if (actionText !== undefined) ad.actionText = actionText;
    if (type) ad.type = type;
    if (imagePath) {
      ad.imagePath = saveBase64Image(imagePath, req);
    }

    await ad.save();

    res.status(200).json({
      success: true,
      message: 'تم تعديل الإعلان بنجاح',
      data: ad,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    حذف إعلان معين (خاص بالمالك والمدير)
// @route   DELETE /api/ads/:id
router.delete('/:id', async (req, res) => {
  try {
    const { userRole } = req.body;

    // التحقق من الصلاحيات
    if (userRole !== 'owner' && userRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بإدارة الإعلانات. المالك والمدير فقط!' });
    }

    const ad = await Ad.findById(req.params.id);
    if (!ad) {
      return res.status(404).json({ success: false, message: 'الإعلان غير موجود' });
    }

    await ad.deleteOne();

    res.status(200).json({
      success: true,
      message: 'تم حذف الإعلان بنجاح',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

