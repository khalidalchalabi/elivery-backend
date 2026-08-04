const mongoose = require('mongoose');

const AdSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'الرجاء إدخال عنوان الإعلان الرئيسي'],
      trim: true,
    },
    subtitle: {
      type: String,
      trim: true,
    },
    actionText: {
      type: String,
      trim: true,
      default: 'اطلب الآن',
    },
    type: {
      type: String,
      enum: ['banner', 'notification'],
      default: 'banner',
    },
    imagePath: {
      type: String, // رابط الصورة الخلفية للإعلان
      required: false, // لم يعد إلزامياً لأن الإشعارات قد لا تحتوي على صورة
    },
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      required: false,
    },
    targetPhone: {
      type: String,
      default: null,
      trim: true,
    },
    // النطاق الجغرافي للاعلان
    targetZoneType: {
      type: String,
      enum: ['all', 'circle', 'box'],
      default: 'all',
    },
    centerLat: {
      type: Number,
      default: null,
    },
    centerLng: {
      type: Number,
      default: null,
    },
    radiusKm: {
      type: Number,
      default: 5,
    },
    minLat: {
      type: Number,
      default: null,
    },
    maxLat: {
      type: Number,
      default: null,
    },
    minLng: {
      type: Number,
      default: null,
    },
    maxLng: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Ad', AdSchema);
