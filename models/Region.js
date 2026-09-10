const mongoose = require('mongoose');

const RegionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'الرجاء إدخال اسم المنطقة'],
      trim: true,
      unique: true,
    },
    // شكل المنطقة: دائرة (مركز + نصف قطر) أو شكل حر مرسوم على الخريطة (مضلع).
    // المناطق القديمة كلها بدون هذا الحقل، وتُعامل تلقائياً كـ 'circle' (القيمة الافتراضية)
    shape: {
      type: String,
      enum: ['circle', 'polygon'],
      default: 'circle',
    },
    // نفس بنية GeoJSON Point المستخدمة أصلاً بـ Shop.location وdriverDetails.currentLocation.
    // مطلوبة دائماً (حتى لمناطق polygon، وين تُحسب تلقائياً كمركز تقريبي للشكل) لأنها
    // تُستخدم لترتيب "أقرب منطقة" عند تطابق أكثر من منطقة لنفس النقطة
    center: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [Longitude, Latitude]
        required: [true, 'الرجاء تحديد مركز المنطقة الجغرافي'],
      },
    },
    radiusKm: {
      type: Number,
      // نصف القطر مطلوب فقط للمناطق الدائرية — المناطق المرسومة (polygon) تعتمد على حدودها الفعلية
      required: [function () { return this.shape !== 'polygon'; }, 'الرجاء تحديد نطاق المنطقة بالكيلومتر'],
      default: 15.0,
      min: [0.1, 'يجب أن يكون النطاق أكبر من صفر'],
    },
    // حدود الشكل الحر، بصيغة GeoJSON Polygon — [[[lng,lat], [lng,lat], ...]] (الحلقة مغلقة:
    // أول نقطة = آخر نقطة). موجودة فقط لما shape === 'polygon'
    polygon: {
      type: {
        type: String,
        enum: ['Polygon'],
        default: 'Polygon',
      },
      coordinates: {
        type: [[[Number]]],
        default: undefined,
      },
    },
    // سعر توصيل ثابت لهذه المنطقة. null يعني الاعتماد على حساب المسافة الافتراضي بتطبيق الزبون
    deliveryFee: {
      type: Number,
      default: null,
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

RegionSchema.index({ center: '2dsphere' });
RegionSchema.index({ polygon: '2dsphere' }, { sparse: true });

module.exports = mongoose.model('Region', RegionSchema);
