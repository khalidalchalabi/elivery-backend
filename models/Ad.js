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
    isGlobal: {
      type: Boolean,
      default: true,
    },
    targetLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [Longitude, Latitude]
        default: null,
      },
      address: {
        type: String,
        default: '',
      },
    },
    targetRadiusKm: {
      type: Number,
      default: 0,
    },
    zoneName: {
      type: String,
      default: 'جميع المناطق',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Ad', AdSchema);
