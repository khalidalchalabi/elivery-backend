const mongoose = require('mongoose');

const RegionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'الرجاء إدخال اسم المنطقة'],
      trim: true,
      unique: true,
    },
    // نفس بنية GeoJSON Point المستخدمة أصلاً بـ Shop.location وdriverDetails.currentLocation
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
      required: [true, 'الرجاء تحديد نطاق المنطقة بالكيلومتر'],
      default: 15.0,
      min: [0.1, 'يجب أن يكون النطاق أكبر من صفر'],
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

module.exports = mongoose.model('Region', RegionSchema);
