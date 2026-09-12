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
    numReviews: {
      type: Number,
      default: 0,
    },
    ratingSum: {
      type: Number,
      default: 0,
    },
    deliveryTime: {
      type: String,
      default: '15-25 دقيقة',
    },
    // سعر توصيل مخصص من هذا المحل لكل زون على حدة (بدل سعر توصيل أساسي
    // واحد للمحل كله) — يفيد أكثر شي بمحلات خارج نطاق التسعير الاعتيادي
    // (مثلاً محل من مدينة ثانية يوصل لمنطقة بعيدة بسعر مختلف عن باقي محلات المنطقة).
    // لو الزبون بزون ما إله سعر مخصص هنا، يُعتمد سعر الزون العام كالمعتاد
    zonePricing: [
      {
        zone: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Zone',
          required: true,
        },
        deliveryFee: {
          type: Number,
          required: true,
          min: 0,
        },
        _id: false,
      },
    ],
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
    discountPercentage: {
      type: Number,
      default: 0,
      min: [0, 'لا يمكن أن يكون الخصم بالسالب'],
      max: [100, 'لا يمكن أن يتجاوز الخصم 100%'],
    },
    minOrderAmountForDiscount: {
      type: Number,
      default: 0,
    },
    region: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Region',
      default: null,
    },
    // نسبة عمولة التطبيق من قيمة مواد المحل (اختيارية، افتراضياً معطّلة/صفر) —
    // تُقتطع من سعر المنتجات فقط عند تسوية حساب المحل، ولا تؤثر على سعر
    // التوصيل أو ما يدفعه الزبون
    appCommissionPercent: {
      type: Number,
      default: 0,
      min: [0, 'لا يمكن أن تكون نسبة العمولة بالسالب'],
      max: [100, 'لا يمكن أن تتجاوز نسبة العمولة 100%'],
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Shop', ShopSchema);
