const express = require('express');
const router = Router = express.Router();
const Ad = require('../models/Ad');
const fs = require('fs');
const path = require('path');

// دالة مساعدة لحفظ الصورة المرفوعة كـ base64 (نحفظها مباشرة في قاعدة البيانات للعمل على السيرفرات المجانية مثل Render/Vercel)
function saveBase64Image(base64Str, req) {
  return base64Str;
}

// دالة مساعدة لحساب المسافة بالكيلومتر بين نقطتين (Haversine formula)
function getDistanceKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// @desc    جلب كافة الإعلانات النشطة (مع تصفية جغرافية حسب موقع الزبون)
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
    const ads = await Ad.find(query).sort({ createdAt: -1 });

    const userLat = lat ? parseFloat(lat) : null;
    const userLng = lng ? parseFloat(lng) : null;

    // تصفية الإعلانات حسب النطاق الجغرافي للزبون
    const filteredAds = ads.filter(ad => {
      const zoneType = ad.targetZoneType || 'all';
      if (zoneType === 'all') return true;

      // إذا لم تتوفر إحداثيات الزبون، نعرض الإعلانات العامة فقط
      if (userLat == null || userLng == null || isNaN(userLat) || isNaN(userLng)) {
        return false;
      }

      if (zoneType === 'circle') {
        const dist = getDistanceKm(ad.centerLat, ad.centerLng, userLat, userLng);
        const radius = ad.radiusKm || 5;
        return dist <= radius;
      }

      if (zoneType === 'box') {
        if (ad.minLat == null || ad.maxLat == null || ad.minLng == null || ad.maxLng == null) return true;
        const insideLat = userLat >= Math.min(ad.minLat, ad.maxLat) && userLat <= Math.max(ad.minLat, ad.maxLat);
        const insideLng = userLng >= Math.min(ad.minLng, ad.maxLng) && userLng <= Math.max(ad.minLng, ad.maxLng);
        return insideLat && insideLng;
      }

      return true;
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
      title, subtitle, actionText, imagePath, userRole, type, shopId,
      targetZoneType, centerLat, centerLng, radiusKm, minLat, maxLat, minLng, maxLng
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

    const ad = new Ad({
      title,
      subtitle,
      actionText: actionText || 'اطلب الآن',
      imagePath: resolvedImagePath,
      type: type || 'banner',
      shopId: shopId || null,
      targetZoneType: targetZoneType || 'all',
      centerLat: centerLat != null ? parseFloat(centerLat) : null,
      centerLng: centerLng != null ? parseFloat(centerLng) : null,
      radiusKm: radiusKm != null ? parseFloat(radiusKm) : 5,
      minLat: minLat != null ? parseFloat(minLat) : null,
      maxLat: maxLat != null ? parseFloat(maxLat) : null,
      minLng: minLng != null ? parseFloat(minLng) : null,
      maxLng: maxLng != null ? parseFloat(maxLng) : null,
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
      title, subtitle, actionText, imagePath, userRole, type, shopId,
      targetZoneType, centerLat, centerLng, radiusKm, minLat, maxLat, minLng, maxLng
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
    if (targetZoneType) ad.targetZoneType = targetZoneType;
    if (centerLat !== undefined) ad.centerLat = centerLat != null ? parseFloat(centerLat) : null;
    if (centerLng !== undefined) ad.centerLng = centerLng != null ? parseFloat(centerLng) : null;
    if (radiusKm !== undefined) ad.radiusKm = radiusKm != null ? parseFloat(radiusKm) : 5;
    if (minLat !== undefined) ad.minLat = minLat != null ? parseFloat(minLat) : null;
    if (maxLat !== undefined) ad.maxLat = maxLat != null ? parseFloat(maxLat) : null;
    if (minLng !== undefined) ad.minLng = minLng != null ? parseFloat(minLng) : null;
    if (maxLng !== undefined) ad.maxLng = maxLng != null ? parseFloat(maxLng) : null;

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

