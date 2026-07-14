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
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Ad', AdSchema);
