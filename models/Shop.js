const mongoose = require('mongoose');

const ShopSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'الرجاء إدخال اسم المحل'],
      trim: true,
      unique: true,
    },
    description: {
      type: String,
      trim: true,
    },
    imagePath: {
      type: String, // يحفظ الرمز التعبيري (Emoji) أو رابط الصورة البانر للمحل
      default: '🛒',
    },
    rating: {
      type: Number,
      default: 4.5,
    },
    deliveryTime: {
      type: String,
      default: '15-25 دقيقة',
    },
    deliveryFee: {
      type: Number,
      default: 1000,
    },
    categories: {
      type: [String],
      default: ['عام'],
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [Longitude, Latitude]
        default: [44.5241, 33.8245], // مركز الخالص الافتراضي
      },
    },
    isOpen: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Shop', ShopSchema);
