const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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
      trim: true,
    },
    role: {
      type: String,
      enum: ['customer', 'driver', 'admin', 'owner', 'accountant', 'merchant', 'support'],
      default: 'customer',
    },
    shop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      default: null,
    },
    // منطقة عمل السائق (إلزامية للسائقين) — يحددها الإدارة، تقيّد أي طلب يقدر يستلمه
    region: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Region',
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    profilePicture: {
      type: String,
      default: null,
    },
    // رصيد نقاط الولاء (تُمنح عند إكمال الطلبات، وتُستبدل بأكواد خصم)
    loyaltyPoints: {
      type: Number,
      default: 0,
    },
    // رمز إحالة فريد خاص بكل زبون — يشاركه مع أصدقائه حتى يسجلوا فيه.
    // ملاحظة: بدون "default" عمداً — لو حطينا default:null فكل حساب كادر
    // (سائق/تاجر/دعم...) ما يولّد له رمز بيصير عنده الحقل = null صراحة، وبما
    // إن sparse index يستثني بس الحقول الغائبة تماماً (مو null صراحة)، أول
    // حساب بس ياخذ null بنجاح وأي حساب ثاني بعده يفشل بخطأ تكرار مفتاح فريد
    referralCode: {
      type: String,
      unique: true,
      sparse: true,
    },
    // مين دعا هذا الحساب (لو سجّل برمز إحالة شخص ثاني)
    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // يمنع منح مكافأة الإحالة أكثر من مرة لنفس الحساب المُحال
    referralRewardGiven: {
      type: Boolean,
      default: false,
    },
    // رمز جهاز Firebase Cloud Messaging لإرسال إشعارات Push حقيقية
    fcmToken: {
      type: String,
      default: null,
    },
    // نسخة على السيرفر من المحلات المفضلة (لإرسال إشعار عند زيادة خصم محل مفضل)
    favoriteShops: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
    }],
    // تفاصيل إضافية خاصة بالسائقين فقط
    driverDetails: {
      vehicleType: {
        type: String,
        default: 'motorcycle',
      },
      plateNumber: {
        type: String,
        trim: true,
      },
      address: {
        type: String,
        trim: true,
        default: '',
      },
      rating: {
        type: Number,
        default: 5.0,
      },
      numReviews: {
        type: Number,
        default: 0,
      },
      ratingSum: {
        type: Number,
        default: 0,
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
    assignedSupport: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    assignedSupportName: {
      type: String,
      default: null,
    },
    savedAddresses: [
      {
        label: { type: String, required: true }, // المنزل، العمل، بيت الأهل...
        address: { type: String, required: true },
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true },
        region: { type: String, default: 'inside_khalis' }
      }
    ],
  },
  {
    timestamps: true, // تضيف حقول createdAt و updatedAt تلقائياً
  }
);

// إنشاء فهرس جغرافي لموقع السائق لتسريع عمليات البحث الجغرافي (مثل إيجاد أقرب سائق)
UserSchema.index({ 'driverDetails.currentLocation': '2dsphere' });

// فريد على مستوى (الهاتف + الدور) وليس الهاتف وحده، حتى يقدر نفس الشخص
// (مثلاً موظف بالكادر) يملك حساب زبون منفصل بنفس رقم هاتفه لأغراض العمل
UserSchema.index({ phone: 1, role: 1 }, { unique: true });

// يشفّر كلمة المرور تلقائياً بأي حفظ (تسجيل جديد، تغيير كلمة مرور، إنشاء
// موظف...) قبل تخزينها — يتحقق أولاً من عدم كونها مشفّرة أصلاً (تبدأ بـ $2،
// بصمة bcrypt المميزة) حتى ما يعيد تشفير قيمة مشفّرة أصلاً بالخطأ لو انحفظ
// المستند مرة ثانية بدون تعديل كلمة المرور فعلياً
// ملاحظة: ماخذ next كمعامل ولا نستدعيه — Mongoose 9 ما يمرر دالة next حقيقية
// للـ hooks غير المتزامنة (async)، ويكتفي بانتظار الـ Promise المرجوعة تلقائياً
UserSchema.pre('save', async function () {
  if (this.isModified('password') && this.password && !this.password.startsWith('$2')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
});

module.exports = mongoose.model('User', UserSchema);
