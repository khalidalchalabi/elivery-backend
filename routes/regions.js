const express = require('express');
const router = express.Router();
const Region = require('../models/Region');
const Shop = require('../models/Shop');
const User = require('../models/User');
const { findNearestRegion } = require('../utils/regionHelper');

// @desc    جلب كافة المناطق
// @route   GET /api/regions?activeOnly=true
router.get('/', async (req, res) => {
  try {
    const query = req.query.activeOnly === 'true' ? { isActive: true } : {};
    const regions = await Region.find(query).sort({ name: 1 });
    res.json({ success: true, count: regions.length, data: regions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    أقرب منطقة نشطة تحتوي إحداثيات معينة (يفيد اقتراح المنطقة تلقائياً بنموذج إضافة محل)
// @route   GET /api/regions/nearest?lat=&lng=
router.get('/nearest', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    if (lat === undefined || lng === undefined) {
      return res.status(400).json({ success: false, message: 'الرجاء تحديد خط الطول والعرض' });
    }
    const region = await findNearestRegion(parseFloat(lat), parseFloat(lng));
    res.json({ success: true, data: region }); // data: null إذا كانت النقطة خارج كل المناطق
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    إضافة منطقة جديدة
// @route   POST /api/regions
router.post('/', async (req, res) => {
  try {
    const { name, latitude, longitude, radiusKm, isActive } = req.body;
    if (!name || latitude === undefined || longitude === undefined || !radiusKm) {
      return res.status(400).json({ success: false, message: 'الرجاء تعبئة كافة بيانات المنطقة' });
    }
    const exists = await Region.findOne({ name });
    if (exists) {
      return res.status(400).json({ success: false, message: 'هذا الاسم مستخدم بالفعل لمنطقة أخرى' });
    }

    const region = new Region({
      name,
      center: { type: 'Point', coordinates: [parseFloat(longitude), parseFloat(latitude)] },
      radiusKm: parseFloat(radiusKm),
      isActive: isActive !== undefined ? isActive : true,
    });
    await region.save();
    res.status(201).json({ success: true, message: 'تم إضافة المنطقة بنجاح', data: region });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تعديل منطقة
// @route   PUT /api/regions/:id
router.put('/:id', async (req, res) => {
  try {
    const { name, latitude, longitude, radiusKm, isActive } = req.body;
    const region = await Region.findById(req.params.id);
    if (!region) {
      return res.status(404).json({ success: false, message: 'المنطقة غير موجودة' });
    }

    if (name) region.name = name;
    if (radiusKm !== undefined) region.radiusKm = parseFloat(radiusKm);
    if (isActive !== undefined) region.isActive = isActive;
    if (latitude !== undefined && longitude !== undefined) {
      region.center = { type: 'Point', coordinates: [parseFloat(longitude), parseFloat(latitude)] };
    }
    await region.save();
    res.json({ success: true, message: 'تم تحديث المنطقة بنجاح', data: region });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    حذف منطقة — يُرفض لو فيه محلات/سائقين مرتبطين بها (استخدم isActive:false بدلاً منه)
// @route   DELETE /api/regions/:id
router.delete('/:id', async (req, res) => {
  try {
    const [shopCount, driverCount] = await Promise.all([
      Shop.countDocuments({ region: req.params.id }),
      User.countDocuments({ region: req.params.id, role: 'driver' }),
    ]);
    if (shopCount > 0 || driverCount > 0) {
      return res.status(400).json({
        success: false,
        message: `لا يمكن حذف هذه المنطقة (${shopCount} محل، ${driverCount} سائق مرتبطين بها). استخدم إلغاء التفعيل بدلاً من الحذف.`,
      });
    }
    const region = await Region.findByIdAndDelete(req.params.id);
    if (!region) {
      return res.status(404).json({ success: false, message: 'المنطقة غير موجودة' });
    }
    res.json({ success: true, message: 'تم حذف المنطقة بنجاح' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
