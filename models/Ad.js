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
    imagePath: {
      type: String, // رابط الصورة الخلفية للإعلان
      required: [true, 'الرجاء إدخال رابط الصورة الخلفية للإعلان'],
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Ad', AdSchema);
