const Zone = require('../models/Zone');
const { haversineKm, pointInPolygon } = require('./regionHelper');

// أخص زون نشط يحتوي فعلياً على هذه الإحداثيات ضمن حدوده، أو null إن لم يوجد.
// يفيد بتطبيق سعر توصيل أدق من سعر المنطقة العام لما الزبون داخل حي محدد بالضبط
async function findZoneForPoint(lat, lng) {
  if (lat === undefined || lng === undefined || Number.isNaN(lat) || Number.isNaN(lng)) {
    return null;
  }
  const zones = await Zone.find({ isActive: true });
  let nearest = null;
  let nearestDist = Infinity;
  for (const z of zones) {
    if (!z.polygon?.coordinates?.[0]) continue;
    if (!pointInPolygon(lat, lng, z.polygon.coordinates[0])) continue;
    const dist = haversineKm(lat, lng, z.center.coordinates[1], z.center.coordinates[0]);
    if (dist < nearestDist) {
      nearest = z;
      nearestDist = dist;
    }
  }
  return nearest;
}

module.exports = { findZoneForPoint };
