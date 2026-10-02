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
    // ساعات الدوام التلقائية — الأوقات 'HH:mm' بتوقيت بغداد (انظر utils/shopSchedule.js).
    // معطّلة افتراضياً: المحلات الحالية تبقى على الزر اليدوي isOpen كما هي
    schedule: {
      enabled: { type: Boolean, default: false },
      openTime: { type: String, default: '09:00' },
      closeTime: { type: String, default: '23:00' },
      // استراحة الظهر (أو أي استراحة): المحل يتسكّر خلالها ويرجع يفتح تلقائياً بنهايتها
      breakEnabled: { type: Boolean, default: false },
      breakStart: { type: String, default: '14:00' },
      breakEnd: { type: String, default: '16:00' },
    },
    // تجاوز يدوي مؤقت لحكم الجدول (إغلاق أو فتح استثنائي بالزر اليدوي): المحل يتبع
    // overrideIsOpen لحد overrideUntil (أقرب تغيير قادم بالجدول) ثم يرجع يتبع الجدول
    overrideIsOpen: {
      type: Boolean,
      default: null,
    },
    overrideUntil: {
      type: Date,
      default: null,
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
