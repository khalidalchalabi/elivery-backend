const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema(
  {
    shop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      required: [true, 'يجب تحديد المحل التابع له المنتج'],
    },
    name: {
      type: String,
      required: [true, 'الرجاء إدخال اسم المنتج/البضاعة'],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    price: {
      type: Number,
      required: [true, 'الرجاء إدخال سعر المنتج د.ع'],
      min: [0, 'لا يمكن أن يكون السعر بالسالب'],
    },
    category: {
      type: String,
      required: [true, 'الرجاء تحديد تصنيف المنتج'],
    },
    imagePath: {
      type: String, // الرمز التعبيري للمنتج (مثل 🥛) أو رابط صورته
      default: '📦',
    },
    rating: {
      type: Number,
      default: 4.5,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    // وقت توفر المنتج خلال اليوم (مثلاً وجبة فطور من 07:00 إلى 11:00). بتوقيت بغداد،
    // ويدعم المدى الليلي (18:00 → 02:00). خارج الوقت يصير المنتج غير متاح تلقائياً
    // بدون ما التاجر يغيّر شي، والزر اليدوي isAvailable يبقى يمنعه بأي وقت
    availability: {
      enabled: { type: Boolean, default: false },
      from: { type: String, default: '08:00' },
      to: { type: String, default: '23:00' },
    },
    originalPrice: {
      type: Number,
      default: 0,
    },
    discountPercentage: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// إنشاء فهرس لتسريع جلب منتجات محل معين
ProductSchema.index({ shop: 1 });

module.exports = mongoose.model('Product', ProductSchema);
