const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'الرجاء إدخال الاسم'],
      trim: true,
    },
    email: {
      type: String,
      unique: true,
      sparse: true, // يسمح بوجود قيم null متعددة دون خطأ تكرار
      lowercase: true,
      trim: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        'الرجاء إدخال بريد إلكتروني صالح',
      ],
    },
    password: {
      type: String,
      default: null,
    },
    phone: {
      type: String,
      required: [true, 'الرجاء إدخال رقم الهاتف'],
      unique: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ['customer', 'driver', 'admin', 'owner', 'accountant', 'merchant'],
      default: 'customer',
    },
    shop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // تفاصيل إضافية خاصة بالسائقين فقط
    driverDetails: {
      vehicleType: {
        type: String,
        enum: ['car', 'motorcycle', 'bicycle', 'truck'],
      },
      plateNumber: {
        type: String,
        trim: true,
      },
      isAvailable: {
        type: Boolean,
        default: false,
      },
      // الموقع الحالي للسائق لتحديث التتبع اللحظي
      currentLocation: {
        type: {
          type: String,
          enum: ['Point'],
          default: 'Point',
        },
        // الترتيب في GeoJSON: [Longitude, Latitude]
        coordinates: {
          type: [Number],
          default: [0, 0],
        },
      },
    },
    otpCode: {
      type: String,
      default: null,
    },
    otpExpires: {
      type: Date,
      default: null,
    },
    googleId: {
      type: String,
      default: null,
    },
    appleId: {
      type: String,
      default: null,
    },
    savedAddresses: [
      {
        label: { type: String, required: true }, // المنزل، العمل، بيت الأهل...
        address: { type: String, required: true },
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true },
      }
    ],
  },
  {
    timestamps: true, // تضيف حقول createdAt و updatedAt تلقائياً
  }
);

// إنشاء فهرس جغرافي لموقع السائق لتسريع عمليات البحث الجغرافي (مثل إيجاد أقرب سائق)
UserSchema.index({ 'driverDetails.currentLocation': '2dsphere' });

module.exports = mongoose.model('User', UserSchema);
