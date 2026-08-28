const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'يجب تحديد العميل صاحب الطلب'],
    },
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null, // يكون فارغاً حتى يتم قبول الطلب من قبل سائق
    },
    shop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      default: null,
    },
    items: [
      {
        name: { type: String, required: true },
        quantity: { type: Number, required: true, default: 1 },
        price: { type: Number, required: true },
      },
    ],
    status: {
      type: String,
      enum: [
        'awaiting_verification', // بانتظار التحقق من الزبون الجديد
        'pending',     // بانتظار قبول السائق أو المحل
        'preparing',   // الطلب قيد التجهيز داخل المحل
        'ready',       // تم التجهيز وبانتظار السائق استلامه
        'accepted',    // تم القبول من السائق
        'picking_up',  // السائق في طريقه لاستلام الطلب
        'delivering',  // السائق استلم الشحنة وفي طريقه للتوصيل
        'completed',   // تم التوصيل بنجاح
        'cancelled',   // تم إلغاء الطلب
      ],
      default: 'pending',
    },
    // موقع الاستلام الجغرافي (Pickup Location)
    pickupLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      // الترتيب في GeoJSON: [Longitude, Latitude]
      coordinates: {
        type: [Number],
        required: [true, 'يجب تحديد إحداثيات موقع الاستلام (الطول والعرض)'],
      },
      address: {
        type: String,
        required: [true, 'يجب تحديد العنوان النصي لموقع الاستلام'],
      },
    },
    // موقع التوصيل الجغرافي (Dropoff Location)
    dropoffLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      // الترتيب في GeoJSON: [Longitude, Latitude]
      coordinates: {
        type: [Number],
        required: [true, 'يجب تحديد إحداثيات موقع التوصيل (الطول والعرض)'],
      },
      address: {
        type: String,
        required: [true, 'يجب تحديد العنوان النصي لموقع التوصيل'],
      },
    },
    paymentMethod: {
      type: String,
      enum: ['cash', 'card', 'wallet'],
      default: 'cash',
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed'],
      default: 'pending',
    },
    // معرّف مشترك يربط الطلبات المنفصلة الناتجة عن سلة واحدة تحتوي أصناف
    // من عدة محلات دفعة وحدة (كل محل له طلب مستقل، لكن كلها تحمل نفس
    // groupOrderId لأنها من نفس عملية الدفع). فارغ للطلبات العادية (محل واحد)
    groupOrderId: { type: String, default: null },
    promoCode: { type: String, default: null },
    discountAmount: { type: Number, default: 0 },
    priceDetails: {
      itemsPrice: { type: Number, required: true, default: 0 },
      deliveryFee: { type: Number, required: true, default: 0 },
      totalPrice: { type: Number, required: true, default: 0 },
    },
    estimatedDeliveryTime: {
      type: String, // مثلاً "25-35 دقيقة"
    },
    replacementPreference: {
      type: String,
      enum: ['call_me', 'closest_price', 'remove'],
      default: 'call_me',
    },
    scheduledFor: {
      type: String,
      default: null, // null for instant delivery
    },
    isSettledShop: {
      type: Boolean,
      default: false,
    },
    isSettledDriver: {
      type: Boolean,
      default: false,
    },
    // منع منح نقاط الولاء أكثر من مرة لنفس الطلب
    pointsAwarded: {
      type: Boolean,
      default: false,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    pickedUpAt: {
      type: Date,
      default: null,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
    shopRating: {
      type: Number,
      default: null,
    },
    driverRating: {
      type: Number,
      default: null,
    },
    shopComment: {
      type: String,
      default: '',
    },
    driverComment: {
      type: String,
      default: '',
    },
    shopRatedAt: {
      type: Date,
      default: null,
    },
    driverRatedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// إنشاء الفهارس الجغرافية لتسهيل الاستعلامات المكانية
OrderSchema.index({ pickupLocation: '2dsphere' });
OrderSchema.index({ dropoffLocation: '2dsphere' });

// فهارس لتسريع أكثر الاستعلامات شيوعاً (سجل طلبات الزبون، أداء السواق، تقارير المحلات)
OrderSchema.index({ customer: 1, createdAt: -1 });
OrderSchema.index({ driver: 1, status: 1 });
OrderSchema.index({ shop: 1, status: 1, createdAt: -1 });
OrderSchema.index({ groupOrderId: 1 });

module.exports = mongoose.model('Order', OrderSchema);
