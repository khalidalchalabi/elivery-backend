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

// اختبار "نقطة داخل مضلع" بخوارزمية Ray Casting القياسية.
// ring: حلقة GeoJSON الخارجية، مصفوفة [lng, lat] — نفس ترتيب الإحداثيات بمعيار GeoJSON
function pointInPolygon(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// أقرب منطقة نشطة تحتوي فعلياً على هذه الإحداثيات ضمن نطاقها (دائرة أو مضلع)، أو null إن لم توجد
async function findNearestRegion(lat, lng, { activeOnly = true } = {}) {
  if (lat === undefined || lng === undefined || Number.isNaN(lat) || Number.isNaN(lng)) {
    return null;
  }
  const regions = await Region.find(activeOnly ? { isActive: true } : {});
  let nearest = null;
  let nearestDist = Infinity;
  for (const r of regions) {
    const contains =
      r.shape === 'polygon'
        ? Boolean(r.polygon?.coordinates?.[0]) && pointInPolygon(lat, lng, r.polygon.coordinates[0])
        : haversineKm(lat, lng, r.center.coordinates[1], r.center.coordinates[0]) <= r.radiusKm;
    if (!contains) continue;
    const dist = haversineKm(lat, lng, r.center.coordinates[1], r.center.coordinates[0]);
    if (dist < nearestDist) {
      nearest = r;
      nearestDist = dist;
    }
  }
  return nearest;
}

// يبني حلقة GeoJSON Polygon مغلقة من نقاط [{lat,lng}, ...] مرسومة بالتطبيق، مع مركز تقريبي
// (متوسط بسيط للنقاط) يُستخدم فقط للعرض وترتيب "الأقرب" — دقة كافية لهذا الغرض
function buildPolygonFromPoints(points) {
  if (!Array.isArray(points) || points.length < 3) {
    throw new Error('يجب تحديد ٣ نقاط على الأقل لرسم حدود المنطقة');
  }
  const ring = points.map((p) => [parseFloat(p.lng), parseFloat(p.lat)]);
  const [firstLng, firstLat] = ring[0];
  const [lastLng, lastLat] = ring[ring.length - 1];
  if (firstLng !== lastLng || firstLat !== lastLat) ring.push([firstLng, firstLat]);

  const centroidLat = points.reduce((sum, p) => sum + parseFloat(p.lat), 0) / points.length;
  const centroidLng = points.reduce((sum, p) => sum + parseFloat(p.lng), 0) / points.length;

  return { coordinates: [ring], centroid: { lat: centroidLat, lng: centroidLng } };
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

module.exports = {
  haversineKm,
  pointInPolygon,
  findNearestRegion,
  buildPolygonFromPoints,
  getDefaultRegionId,
  DEFAULT_REGION_NAME,
};
