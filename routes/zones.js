const express = require('express');
const router = express.Router();
const Zone = require('../models/Zone');
const { buildPolygonFromPoints } = require('../utils/regionHelper');

// @desc    جلب زونات منطقة معينة (أو كل الزونات إذا بدون فلتر)
// @route   GET /api/zones?region=<regionId>&activeOnly=true
router.get('/', async (req, res) => {
  try {
    const query = {};
    if (req.query.region) query.region = req.query.region;
    if (req.query.activeOnly === 'true') query.isActive = true;
    const zones = await Zone.find(query).populate('region', 'name').sort({ name: 1 });
    res.json({ success: true, count: zones.length, data: zones });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    إضافة زون جديد داخل منطقة
// @route   POST /api/zones
router.post('/', async (req, res) => {
  try {
    const { name, region, points, deliveryFee, isActive } = req.body;
    if (!name || !region || deliveryFee === undefined || deliveryFee === null || deliveryFee === '') {
      return res.status(400).json({ success: false, message: 'الرجاء تعبئة كافة بيانات الزون' });
    }
    const exists = await Zone.findOne({ region, name });
    if (exists) {
      return res.status(400).json({ success: false, message: 'هذا الاسم مستخدم بالفعل لزون آخر بنفس المنطقة' });
    }

    const { coordinates, centroid } = buildPolygonFromPoints(points);
    const zone = new Zone({
      name,
      region,
      polygon: { type: 'Polygon', coordinates },
      center: { type: 'Point', coordinates: [centroid.lng, centroid.lat] },
      deliveryFee: parseFloat(deliveryFee),
      isActive: isActive !== undefined ? isActive : true,
    });
    await zone.save();
    res.status(201).json({ success: true, message: 'تم إضافة الزون بنجاح', data: zone });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تعديل زون
// @route   PUT /api/zones/:id
router.put('/:id', async (req, res) => {
  try {
    const { name, points, deliveryFee, isActive } = req.body;
    const zone = await Zone.findById(req.params.id);
    if (!zone) {
      return res.status(404).json({ success: false, message: 'الزون غير موجود' });
    }

    if (name) zone.name = name;
    if (isActive !== undefined) zone.isActive = isActive;
    if (deliveryFee !== undefined && deliveryFee !== null && deliveryFee !== '') {
      zone.deliveryFee = parseFloat(deliveryFee);
    }
    if (points !== undefined) {
      const { coordinates, centroid } = buildPolygonFromPoints(points);
      zone.polygon = { type: 'Polygon', coordinates };
      zone.center = { type: 'Point', coordinates: [centroid.lng, centroid.lat] };
    }
    await zone.save();
    res.json({ success: true, message: 'تم تحديث الزون بنجاح', data: zone });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    حذف زون
// @route   DELETE /api/zones/:id
router.delete('/:id', async (req, res) => {
  try {
    const zone = await Zone.findByIdAndDelete(req.params.id);
    if (!zone) {
      return res.status(404).json({ success: false, message: 'الزون غير موجود' });
    }
    res.json({ success: true, message: 'تم حذف الزون بنجاح' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
