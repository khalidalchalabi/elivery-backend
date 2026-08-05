const express = require('express');
const router = Router = express.Router();
const Ad = require('../models/Ad');
const fs = require('fs');
const path = require('path');

// دالة مساعدة لحفظ الصورة المرفوعة كـ base64 (نحفظها مباشرة في قاعدة البيانات للعمل على السيرفرات المجانية مثل Render/Vercel)
function saveBase64Image(base64Str, req) {
  return base64Str;
}

// دالة مساعدة لحساب المسافة بين نقطتين جغرافيتين بالكيلومترات (Haversine formula)
function getDistanceInKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return 0;
  const R = 6371; // نصف قطر الأرض بالكيلومترات
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// @desc    جلب كافة الإعلانات النشطة المخصصة لموقع الزبون
// @route   GET /api/ads
router.get('/', async (req, res) => {
  try {
    const { phone, lat, lng } = req.query;
    let query = {};
    if (phone && phone.trim() !== '') {
      query = {
        $or: [
          { targetPhone: null },
          { targetPhone: phone.trim() }
        ]
      };
    } else {
      query = { targetPhone: null };
    }
    const allAds = await Ad.find(query).sort({ createdAt: -1 });

    const userLat = lat ? parseFloat(lat) : null;
    const userLng = lng ? parseFloat(lng) : null;

    const filteredAds = allAds.filter(ad => {
      // الإعلانات العامة الموجهة لجميع المناطق
      if (ad.isGlobal !== false || !ad.targetLocation || !ad.targetLocation.coordinates || ad.targetLocation.coordinates.length < 2 || !ad.targetRadiusKm || ad.targetRadiusKm <= 0) {
        return true;
      }
      // إذا لم يتوفر موقع الزبون الدقيق نقتصر على الإعلانات المتاحة
      if (userLat === null || userLng === null || isNaN(userLat) || isNaN(userLng)) {
        return true;
      }

      const targetLng = ad.targetLocation.coordinates[0];
      const targetLat = ad.targetLocation.coordinates[1];
      const distance = getDistanceInKm(userLat, userLng, targetLat, targetLng);

      return distance <= ad.targetRadiusKm;
    });

    res.status(200).json({ success: true, count: filteredAds.length, data: filteredAds });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    إضافة إعلان جديد (خاص بالمالك والمدير)
// @route   POST /api/ads
router.post('/', async (req, res) => {
  try {
    const {
      title,
      subtitle,
      actionText,
      imagePath,
      userRole,
      type,
      shopId,
      isGlobal,
      targetLat,
      targetLng,
      targetAddress,
      targetRadiusKm,
      zoneName
    } = req.body;

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

    let targetLocationObj = null;
    if (targetLat !== undefined && targetLng !== undefined && targetLat !== null && targetLng !== null) {
      targetLocationObj = {
        type: 'Point',
        coordinates: [parseFloat(targetLng), parseFloat(targetLat)],
        address: targetAddress || '',
      };
    }

    const ad = new Ad({
      title,
      subtitle,
      actionText: actionText || 'اطلب الآن',
      imagePath: resolvedImagePath,
      type: type || 'banner',
      shopId: shopId || null,
      isGlobal: isGlobal !== undefined ? isGlobal : true,
      targetLocation: targetLocationObj,
      targetRadiusKm: targetRadiusKm ? parseFloat(targetRadiusKm) : 0,
      zoneName: zoneName || 'جميع المناطق',
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
    const {
      title,
      subtitle,
      actionText,
      imagePath,
      userRole,
      type,
      shopId,
      isGlobal,
      targetLat,
      targetLng,
      targetAddress,
      targetRadiusKm,
      zoneName
    } = req.body;

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
    if (shopId !== undefined) ad.shopId = shopId || null;
    if (isGlobal !== undefined) ad.isGlobal = isGlobal;
    if (targetRadiusKm !== undefined) ad.targetRadiusKm = parseFloat(targetRadiusKm);
    if (zoneName !== undefined) ad.zoneName = zoneName;

    if (targetLat !== undefined && targetLng !== undefined && targetLat !== null && targetLng !== null) {
      ad.targetLocation = {
        type: 'Point',
        coordinates: [parseFloat(targetLng), parseFloat(targetLat)],
        address: targetAddress || (ad.targetLocation ? ad.targetLocation.address : ''),
      };
    }

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

