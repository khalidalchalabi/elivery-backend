const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Shop = require('./models/Shop');
const Product = require('./models/Product');
const User = require('./models/User');
const Ad = require('./models/Ad');

dotenv.config();

const dummyAds = [
  {
    title: 'عروض يوم الـ pro',
    subtitle: 'خصم لغاية 50% + توصيل مجاني',
    actionText: 'شجع، وافزع، وياك ⚽',
    imagePath: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=600&q=80',
  },
  {
    title: 'مزايا العائلة كلها',
    subtitle: 'توصيل مجاني وعروض حصرية للجميع',
    actionText: 'جرب باقة العائلة مجاناً 💜',
    imagePath: 'https://images.unsplash.com/photo-1547573854-74d2a71d0826?auto=format&fit=crop&w=600&q=80',
  },
];

const dummyShops = [
  {
    name: 'سوبرماركت البركة',
    description: 'كافة المواد الغذائية، الألبان، الأجبان، والمنظفات المنزلية بأسعار مناسبة وتوصيل سريع.',
    imagePath: '🛒',
    rating: 4.8,
    deliveryTime: '15-25 دقيقة',
    deliveryFee: 1000,
    categories: ['غذائيات', 'ألبان', 'منظفات'],
    products: [
      {
        name: 'حليب كامل الدسم 1 لتر',
        description: 'حليب طازج معقم ومبستر كامل الدسم.',
        price: 1500,
        category: 'ألبان',
        imagePath: '🥛',
        rating: 4.9,
      },
      {
        name: 'أرز بسمتي فاخر 5 كغم',
        description: 'أرز حبة طويلة درجة أولى ممتاز للطبخ العراقي.',
        price: 7500,
        category: 'غذائيات',
        imagePath: '🌾',
        rating: 4.8,
      },
      {
        name: 'زيت طبخ نقي 1 لتر',
        description: 'زيت عباد الشمس نقي ومثالي للقلي والطبخ.',
        price: 2500,
        category: 'غذائيات',
        imagePath: '🍾',
        rating: 4.5,
      },
      {
        name: 'جبن موزاريلا 500 غرام',
        description: 'جبنة موزاريلا مبشورة فاخرة للبيتزا والمعجنات.',
        price: 4000,
        category: 'ألبان',
        imagePath: '🧀',
        rating: 4.7,
      },
    ],
  },
  {
    name: 'خضروات وفواكه النرجس',
    description: 'خضار وفواكه طازجة يومية من المزارع المحلية مباشرة إلى باب بيتك.',
    imagePath: '🍎',
    rating: 4.7,
    deliveryTime: '10-20 دقيقة',
    deliveryFee: 1000,
    categories: ['خضار', 'فواكه'],
    products: [
      {
        name: 'طماطم طازجة 1 كغم',
        description: 'طماطم حمراء ناضجة وممتازة للسلطات والطبخ.',
        price: 1000,
        category: 'خضار',
        imagePath: '🍅',
        rating: 4.7,
      },
      {
        name: 'خيار بلدي 1 كغم',
        description: 'خيار بلدي طازج ومقرمش يوم بيومه.',
        price: 1250,
        category: 'خضار',
        imagePath: '🥒',
        rating: 4.6,
      },
      {
        name: 'تفاح أحمر عراقي 1 كغم',
        description: 'تفاح محلي حلو المذاق وطازج.',
        price: 2000,
        category: 'فواكه',
        imagePath: '🍎',
        rating: 4.8,
      },
      {
        name: 'موز صومالي حلو 1 كغم',
        description: 'موز أصفر طازج ذو جودة عالية.',
        price: 2250,
        category: 'فواكه',
        imagePath: '🍌',
        rating: 4.7,
      },
    ],
  },
  {
    name: 'مخبز وصمون الخالص الحديث',
    description: 'صمون حجر حار، خبز عراقي، كيك، ومعجنات طازجة مخبوزة على مدار الساعة.',
    imagePath: '🥖',
    rating: 4.9,
    deliveryTime: '10-15 دقيقة',
    deliveryFee: 750,
    categories: ['صمون', 'مخبوزات', 'حلويات'],
    products: [
      {
        name: 'كيس صمون حجري 10 قطع',
        description: 'صمون حجري عراقي حار وطازج من الفرن.',
        price: 1000,
        category: 'صمون',
        imagePath: '🥖',
        rating: 4.9,
      },
      {
        name: 'خبز تنور عراقي 8 قطع',
        description: 'خبز تنور حار محضر بالطريقة التقليدية.',
        price: 1000,
        category: 'مخبوزات',
        imagePath: '🫓',
        rating: 4.8,
      },
      {
        name: 'كيكة كاكاو صغيرة دائرية',
        description: 'كيكة اسفنجية بالكاكاو والكراميل تكفي 3-4 أشخاص.',
        price: 5000,
        category: 'حلويات',
        imagePath: '🎂',
        rating: 4.6,
      },
    ],
  },
  {
    name: 'ملحمة الرافدين',
    description: 'لحم غنم وعجل عراقي طازج ومقطع حسب الطلب مع دواجن طازجة يومياً.',
    imagePath: '🥩',
    rating: 4.8,
    deliveryTime: '20-30 دقيقة',
    deliveryFee: 1500,
    categories: ['لحوم', 'دواجن'],
    products: [
      {
        name: 'لحم غنم عراقي طازج 1 كغم',
        description: 'لحم غنم بلدي طازج ومقطع (بالعظم وبدون عظم).',
        price: 18000,
        category: 'لحوم',
        imagePath: '🥩',
        rating: 4.9,
      },
      {
        name: 'لحم مفروم عجل بلدي 1 كغم',
        description: 'لحم عجل طازج مفروم بشكل ناعم وخالي من الدهون الزائدة.',
        price: 16000,
        category: 'لحوم',
        imagePath: '🥩',
        rating: 4.8,
      },
      {
        name: 'دجاج طازج كامل 1 كغم',
        description: 'دجاج محلي طازج ومنظف بالكامل وجاهز للطبخ.',
        price: 4500,
        category: 'دواجن',
        imagePath: '🍗',
        rating: 4.7,
      },
    ],
  },
];

const dummyUsers = [
  {
    name: 'عباس الخالصي',
    email: 'abbas@test.com',
    password: 'password123',
    phone: '07700000000',
    role: 'customer',
  },
  {
    name: 'مدير سوق الخالص',
    email: 'admin@test.com',
    password: 'admin123',
    phone: '07700000001',
    role: 'admin',
  },
  {
    name: 'سائق التوصيل الأول',
    email: 'driver@test.com',
    password: 'driver123',
    phone: '07700000002',
    role: 'driver',
    driverDetails: {
      vehicleType: 'motorcycle',
      plateNumber: 'بغداد-54321',
      isAvailable: true,
      currentLocation: {
        type: 'Point',
        coordinates: [44.53, 34.22], // [Longitude, Latitude] الخالص
      },
    },
  },
  {
    name: 'مالك نظام سوق الخالص',
    email: 'owner@test.com',
    password: 'owner123',
    phone: '07700000004',
    role: 'owner',
  },
  {
    name: 'محاسب سوق الخالص',
    email: 'accountant@test.com',
    password: 'accountant123',
    phone: '07700000003',
    role: 'accountant',
  },
];

const seedDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected for seeding shops & users...');

    // مسح المحلات والمنتجات القديمة
    await Shop.deleteMany({});
    await Product.deleteMany({});
    console.log('Old shops and products cleared.');

    // مسح الحسابات القديمة المماثلة للتأكيد
    await User.deleteMany({ email: { $in: ['abbas@test.com', 'admin@test.com', 'driver@test.com', 'owner@test.com', 'accountant@test.com'] } });
    console.log('Old test users cleared.');

    // مسح الإعلانات القديمة وإضافة الافتراضية
    await Ad.deleteMany({});
    console.log('Old ads cleared.');
    for (const a of dummyAds) {
      const ad = new Ad(a);
      await ad.save();
      console.log(`Saved Ad: ${ad.title}`);
    }

    // إضافة الحسابات التجريبية الثلاثة
    for (const u of dummyUsers) {
      const user = new User(u);
      await user.save();
      console.log(`Saved User: ${user.name} (${user.role})`);
    }

    // إضافة المحلات والمنتجات
    for (const s of dummyShops) {
      const shop = new Shop({
        name: s.name,
        description: s.description,
        imagePath: s.imagePath,
        rating: s.rating,
        deliveryTime: s.deliveryTime,
        deliveryFee: s.deliveryFee,
        categories: s.categories,
      });
      await shop.save();
      console.log(`Saved Shop: ${shop.name}`);

      for (const p of s.products) {
        const product = new Product({
          shop: shop._id,
          name: p.name,
          description: p.description,
          price: p.price,
          category: p.category,
          imagePath: p.imagePath,
          rating: p.rating,
        });
        await product.save();
      }
      console.log(`  Saved ${s.products.length} products for ${shop.name}`);
    }

    console.log('Database Seeding Completed Successfully! 🌱');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
};

seedDB();
