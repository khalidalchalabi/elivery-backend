const mongoose = require('mongoose');

// زون فرعي داخل منطقة (مثال: "حي العصري" داخل منطقة "الخالص") — شكل حر مرسوم
// على الخريطة، بسعر توصيل ثابت خاص فيه (على عكس المنطقة، السعر هنا إلزامي
// لأن وجود الزون بالأساس هو تحديد سعر أدق من سعر المنطقة العام)
const ZoneSchema = new mongoose.Schema(
  {
    region: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Region',
      required: [true, 'الرجاء تحديد المنطقة التابع لها الزون'],
    },
    name: {
      type: String,
      required: [true, 'الرجاء إدخال اسم الزون'],
      trim: true,
    },
    // حدود الزون، بصيغة GeoJSON Polygon — [[[lng,lat], [lng,lat], ...]] (حلقة مغلقة)
    polygon: {
      type: {
        type: String,
        enum: ['Polygon'],
        default: 'Polygon',
      },
      coordinates: {
        type: [[[Number]]],
        required: [true, 'الرجاء رسم حدود الزون على الخريطة'],
      },
    },
    // مركز تقريبي (متوسط النقاط) — للعرض وترتيب "الأقرب" عند تطابق أكثر من زون
    center: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [Longitude, Latitude]
        required: true,
      },
    },
    deliveryFee: {
      type: Number,
      required: [true, 'الرجاء تحديد سعر التوصيل لهذا الزون'],
      min: [0, 'يجب أن يكون السعر صفر أو أكبر'],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

ZoneSchema.index({ polygon: '2dsphere' });
ZoneSchema.index({ region: 1 });
ZoneSchema.index({ region: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Zone', ZoneSchema);
