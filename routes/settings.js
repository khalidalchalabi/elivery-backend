const express = require('express');
const router = express.Router();
const Setting = require('../models/Setting');

// الحصول على كافة الإعدادات
router.get('/', async (req, res) => {
  try {
    const list = await Setting.find();
    
    // تحويل القائمة لكائن key-value بسيط لسهولة القراءة
    const settingsObj = {};
    list.forEach(s => {
      settingsObj[s.key] = s.value;
    });

    // تأكيد وجود الإعدادات الافتراضية
    if (!settingsObj.hasOwnProperty('delivery_radius')) {
      settingsObj['delivery_radius'] = 15.0; // القيمة الافتراضية 15 كم
    }

    res.json({ success: true, data: settingsObj });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء جلب الإعدادات', error: err.message });
  }
});

// الحصول على قيمة إعداد معين
router.get('/:key', async (req, res) => {
  try {
    const key = req.params.key;
    const item = await Setting.findOne({ key });
    if (item) {
      return res.json({ success: true, key, value: item.value });
    }
    
    // قيم افتراضية إذا لم تكن مخزنة بقاعدة البيانات
    let defaultValue = null;
    if (key === 'delivery_radius') {
      defaultValue = 15.0;
    }

    res.json({ success: true, key, value: defaultValue });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ في السيرفر', error: err.message });
  }
});

// تحديث أو إضافة إعداد
router.post('/', async (req, res) => {
  try {
    const { key, value, description } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ success: false, message: 'المفتاح والقيمة مطلوبان' });
    }

    let item = await Setting.findOne({ key });
    if (item) {
      item.value = value;
      if (description) item.description = description;
      await item.save();
    } else {
      item = new Setting({ key, value, description });
      await item.save();
    }

    res.json({ success: true, message: 'تم حفظ الإعداد بنجاح', data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشل حفظ الإعداد', error: err.message });
  }
});

module.exports = router;
