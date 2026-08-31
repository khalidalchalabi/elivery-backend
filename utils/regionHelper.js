const Region = require('../models/Region');

const DEFAULT_REGION_NAME = 'الخالص (منطقة افتراضية)';
let _cachedDefaultRegionId = null;

// نفس صيغة Haversine المستخدمة أصلاً بتطبيق الزبون (api_service.dart)، نسخة
// واحدة موثوقة بالسيرفر بدل الاعتماد على حساب العميل لأي قرار يخص الأهلية
function haversineKm(lat1, lon1, lat2, lon2) {
  const p = 0.017453292519943295; // Math.PI / 180
  const a =
    0.5 -
    Math.cos((lat2 - lat1) * p) / 2 +
    (Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lon2 - lon1) * p))) / 2;
  return 12742 * Math.asin(Math.sqrt(a)); // 2 * نصف قطر الأرض بالكم (6371)
}

// أقرب منطقة نشطة تحتوي فعلياً على هذه الإحداثيات ضمن نطاقها، أو null إن لم توجد
async function findNearestRegion(lat, lng, { activeOnly = true } = {}) {
  if (lat === undefined || lng === undefined || Number.isNaN(lat) || Number.isNaN(lng)) {
    return null;
  }
  const regions = await Region.find(activeOnly ? { isActive: true } : {});
  let nearest = null;
  let nearestDist = Infinity;
  for (const r of regions) {
    const [rLng, rLat] = r.center.coordinates;
    const dist = haversineKm(lat, lng, rLat, rLng);
    if (dist <= r.radiusKm && dist < nearestDist) {
      nearest = r;
      nearestDist = dist;
    }
  }
  return nearest;
}

// معرّف المنطقة الافتراضية (تُنشأ عند إقلاع السيرفر عبر seedDefaultRegionAndBackfill)
async function getDefaultRegionId() {
  if (_cachedDefaultRegionId) return _cachedDefaultRegionId;
  const region = await Region.findOne({ name: DEFAULT_REGION_NAME }).select('_id');
  if (region) {
    _cachedDefaultRegionId = region._id;
    return region._id;
  }
  return null; // نادراً — فقط إذا لم يشتغل seed الخاص بـ server.js بعد
}

module.exports = { haversineKm, findNearestRegion, getDefaultRegionId, DEFAULT_REGION_NAME };
