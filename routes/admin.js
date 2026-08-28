const express = require('express');
const mongoose = require('mongoose');
const Jimp = require('jimp');
const router = express.Router();
const User = require('../models/User');
const Order = require('../models/Order');
const PromoCode = require('../models/PromoCode');
const Ad = require('../models/Ad');
const Shop = require('../models/Shop');
const Product = require('../models/Product');
const Category = require('../models/Category');
const AuditLog = require('../models/AuditLog');
const { sendPushToUser, sendPushToTopic } = require('../utils/sendPushNotification');
const { saveBase64Image } = require('../utils/imageUpload');
const { initFirebaseAdmin } = require('../config/firebaseAdmin');

// دالة مساعدة لضغط صورة base64 كبيرة (مستخدمة بمهمة تنظيف الصور القديمة أدناه فقط)
async function compressExistingImage(dataUri, maxDimension = 800, quality = 70) {
  const commaIdx = dataUri.indexOf(',');
  const base64Data = commaIdx >= 0 ? dataUri.slice(commaIdx + 1) : dataUri;
  const buffer = Buffer.from(base64Data, 'base64');
  const image = await Jimp.read(buffer);
  if (image.bitmap.width > maxDimension || image.bitmap.height > maxDimension) {
    if (image.bitmap.width >= image.bitmap.height) {
      image.resize(maxDimension, Jimp.AUTO);
    } else {
      image.resize(Jimp.AUTO, maxDimension);
    }
  }
  image.quality(quality);
  const outBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
  return `data:image/jpeg;base64,${outBuffer.toString('base64')}`;
}

// @desc    ضغط الصور الكبيرة الموجودة مسبقاً بقاعدة البيانات (مهمة تنظيف تُشغّل مرة واحدة، بالدفعات)
// @route   POST /api/admin/optimize-images
// يعالج حتى limit عنصر بكل نوع بكل استدعاء (تجنباً لانتهاء مهلة الطلب) — يُستدعى بشكل متكرر
// حتى تصير remainingEstimate كلها صفر
router.post('/optimize-images', async (req, res) => {
  try {
    const { confirm, limit = 20, minSizeKb = 300, maxSizeKb = 4000 } = req.body;
    if (confirm !== 'yes-migrate-images') {
      return res.status(400).json({ success: false, message: 'يجب تأكيد العملية بإرسال confirm=yes-migrate-images' });
    }

    const minSizeBytes = Number(minSizeKb) * 1024;
    const maxSizeBytes = Number(maxSizeKb) * 1024;

    const results = {
      products: { compressed: 0, skipped: 0, tooLarge: 0 },
      shops: { compressed: 0, skipped: 0, tooLarge: 0 },
      ads: { compressed: 0, skipped: 0, tooLarge: 0 },
      categories: { compressed: 0, skipped: 0, tooLarge: 0 },
    };
    const debugErrors = [];

    function fieldFilter(field) {
      return {
        [field]: { $regex: '^data:image' },
        $expr: { $gt: [{ $strLenBytes: `$${field}` }, minSizeBytes] },
      };
    }

    async function processCollection(Model, key, field = 'imagePath') {
      const filter = fieldFilter(field);
      const docs = await Model.find(filter).limit(Number(limit) * 3);
      // نبدأ بالأصغر حجماً (ضمن النطاق المطلوب) تجنباً لخطر انهيار الذاكرة
      // مع أكبر الصور دفعة واحدة على خطة Render المجانية المحدودة
      const withSize = docs.map((doc) => ({ doc, sizeBytes: Buffer.byteLength(doc[field], 'utf8') }));
      withSize.sort((a, b) => a.sizeBytes - b.sizeBytes);

      let processedCount = 0;
      for (const { doc, sizeBytes } of withSize) {
        if (processedCount >= Number(limit)) break;
        if (sizeBytes > maxSizeBytes) {
          results[key].tooLarge++;
          continue;
        }
        processedCount++;
        try {
          const compressed = await compressExistingImage(doc[field]);
          const newSizeBytes = Buffer.byteLength(compressed, 'utf8');
          if (newSizeBytes < sizeBytes) {
            doc[field] = compressed;
            await doc.save();
            results[key].compressed++;
          } else {
            results[key].skipped++;
          }
        } catch (e) {
          results[key].skipped++;
          if (debugErrors.length < 5) {
            debugErrors.push({ id: doc._id.toString(), header: doc[field].slice(0, 30), sizeKb: Math.round(sizeBytes / 1024), error: e.message });
          }
        }
      }
    }

    await processCollection(Product, 'products');
    await processCollection(Shop, 'shops');
    await processCollection(Ad, 'ads');
    await processCollection(Category, 'categories', 'backgroundImage');

    const remainingEstimate = {
      products: await Product.countDocuments(fieldFilter('imagePath')),
      shops: await Shop.countDocuments(fieldFilter('imagePath')),
      ads: await Ad.countDocuments(fieldFilter('imagePath')),
      categories: await Category.countDocuments(fieldFilter('backgroundImage')),
    };

    res.status(200).json({ success: true, results, remainingEstimate, debugErrors });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    نقل الصور القديمة المخزونة base64 داخل قاعدة البيانات إلى Firebase Storage
//          (مهمة هجرة تُشغّل مرة واحدة، بالدفعات، تستبدل نص base64 برابط عام)
// @route   POST /api/admin/migrate-images-to-storage
// يعالج حتى limit عنصر بكل نوع بكل استدعاء (تجنباً لانتهاء مهلة الطلب) — يُستدعى بشكل متكرر
// حتى تصير remainingEstimate كلها صفر
router.post('/migrate-images-to-storage', async (req, res) => {
  try {
    const { confirm, limit = 15 } = req.body;
    if (confirm !== 'yes-migrate-images-to-storage') {
      return res.status(400).json({ success: false, message: 'يجب تأكيد العملية بإرسال confirm=yes-migrate-images-to-storage' });
    }

    const results = {
      products: { migrated: 0, failed: 0 },
      shops: { migrated: 0, failed: 0 },
      ads: { migrated: 0, failed: 0 },
    };
    const debugErrors = [];

    function base64Filter(field) {
      return { [field]: { $regex: '^data:image' } };
    }

    async function processCollection(Model, key, folder, field = 'imagePath') {
      const docs = await Model.find(base64Filter(field)).limit(Number(limit));
      for (const doc of docs) {
        try {
          const url = await saveBase64Image(doc[field], folder);
          if (url.startsWith('http')) {
            doc[field] = url;
            await doc.save();
            results[key].migrated++;
          } else {
            results[key].failed++;
          }
        } catch (e) {
          results[key].failed++;
          if (debugErrors.length < 5) {
            debugErrors.push({ id: doc._id.toString(), error: e.message });
          }
        }
      }
    }

    await processCollection(Product, 'products', 'products');
    await processCollection(Shop, 'shops', 'shops');
    await processCollection(Ad, 'ads', 'ads');

    const remainingEstimate = {
      products: await Product.countDocuments(base64Filter('imagePath')),
      shops: await Shop.countDocuments(base64Filter('imagePath')),
      ads: await Ad.countDocuments(base64Filter('imagePath')),
    };

    res.status(200).json({ success: true, results, remainingEstimate, debugErrors });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    فهرس phone كان فريداً على مستوى قاعدة البيانات كلها (كل الأدوار)،
//          فيمنع مثلاً موظف الدعم من إنشاء حساب زبون منفصل بنفس رقمه.
//          هذه مهمة هجرة تُشغّل مرة واحدة: تحذف الفهرس القديم phone_1 وتنشئ
//          بدلاً عنه فهرساً مركباً فريداً على (phone + role)
// @route   POST /api/admin/fix-phone-index
router.post('/fix-phone-index', async (req, res) => {
  try {
    const { confirm } = req.body;
    if (confirm !== 'yes-fix-phone-index') {
      return res.status(400).json({ success: false, message: 'يجب تأكيد العملية بإرسال confirm=yes-fix-phone-index' });
    }

    const collection = User.collection;
    const existingIndexes = await collection.indexes();
    const droppedIndexes = [];

    for (const idx of existingIndexes) {
      // أي فهرس فريد قديم على phone وحده (بغض النظر عن اسمه الفعلي)
      if (idx.unique && idx.key && Object.keys(idx.key).length === 1 && idx.key.phone === 1) {
        await collection.dropIndex(idx.name);
        droppedIndexes.push(idx.name);
      }
    }

    await collection.createIndex({ phone: 1, role: 1 }, { unique: true });

    res.status(200).json({ success: true, droppedIndexes, message: 'تم تحديث فهرس رقم الهاتف بنجاح' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تفعيل CORS على Firebase Storage حتى تقدر متصفحات نسخ الويب (تطبيق
//          الزبون والكادر) تحمّل صور المحلات/المنتجات المرفوعة كروابط.
//          بدونها يمنع المتصفح تحميل الصورة رغم إنها تشتغل عادي بالموبايل
// @route   POST /api/admin/configure-storage-cors
router.post('/configure-storage-cors', async (req, res) => {
  try {
    if (!initFirebaseAdmin()) {
      return res.status(500).json({ success: false, message: 'Firebase Admin غير مهيّأ' });
    }
    const { getStorage } = require('firebase-admin/storage');
    const bucket = getStorage().bucket();
    await bucket.setCorsConfiguration([
      {
        origin: ['*'],
        method: ['GET', 'HEAD'],
        responseHeader: ['Content-Type', 'Cache-Control', 'ETag'],
        maxAgeSeconds: 3600,
      },
    ]);
    res.status(200).json({ success: true, message: 'تم تفعيل CORS على Firebase Storage بنجاح' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب إحصائيات لوحة التحكم
// @route   GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalCustomers = await User.countDocuments({ role: 'customer' });
    const totalDrivers = await User.countDocuments({ role: 'driver' });
    const totalSupport = await User.countDocuments({ role: 'support' });
    
    // حساب الأرباح الكلية وعدد الطلبات
    const orders = await Order.find({ status: 'completed' });
    let totalRevenue = 0;
    orders.forEach(order => {
      totalRevenue += (order.totalPaid || 0);
    });

    res.status(200).json({
      success: true,
      data: {
        totalUsers,
        totalCustomers,
        totalDrivers,
        totalSupport,
        totalOrders: orders.length,
        totalRevenue
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب قائمة أفضل الزبائن
// @route   GET /api/admin/top-customers
router.get('/top-customers', async (req, res) => {
  try {
    const customers = await User.aggregate([
      { $match: { role: 'customer' } },
      {
        $lookup: {
          from: 'orders',
          let: { userId: '$_id' },
          pipeline: [
            { 
              $match: { 
                $expr: { $eq: ['$customer', '$$userId'] },
                status: 'completed'
              }
            }
          ],
          as: 'completedOrders'
        }
      },
      {
        $project: {
          name: 1,
          phone: 1,
          email: 1,
          createdAt: 1,
          totalOrders: { $size: '$completedOrders' },
          totalSpent: { $sum: '$completedOrders.priceDetails.totalPrice' }
        }
      },
      { $sort: { totalOrders: -1, totalSpent: -1 } },
      { $limit: 50 } // نجلب أفضل 50 زبون فقط
    ]);
    res.status(200).json({ success: true, data: customers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب قائمة جميع الزبائن مع إحصائياتهم المالية والطلبات
// @route   GET /api/admin/customers-list
router.get('/customers-list', async (req, res) => {
  try {
    const customers = await User.find({ role: 'customer' }).sort({ createdAt: -1 }).select('-password');
    const orders = await Order.find({ customer: { $in: customers.map(c => c._id) } });

    const customersWithStats = customers.map(c => {
      const custOrders = orders.filter(o => o.customer && o.customer.toString() === c._id.toString());
      const completed = custOrders.filter(o => o.status === 'completed');
      const cancelled = custOrders.filter(o => o.status === 'cancelled');
      let spent = 0;
      completed.forEach(o => {
        spent += (o.priceDetails?.totalPrice || o.totalPaid || ((o.priceDetails?.itemsPrice || 0) + (o.priceDetails?.deliveryFee || 0)) || 0);
      });

      return {
        _id: c._id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        createdAt: c.createdAt,
        isActive: c.isActive,
        totalOrdersCount: custOrders.length,
        completedOrdersCount: completed.length,
        cancelledOrdersCount: cancelled.length,
        totalSpent: spent,
        completionRate: custOrders.length > 0 ? Math.round((completed.length / custOrders.length) * 100) : 100,
        loyaltyPoints: c.loyaltyPoints || 0,
      };
    });

    res.status(200).json({ success: true, count: customersWithStats.length, data: customersWithStats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تعديل رصيد نقاط الولاء لزبون يدوياً (إضافة أو خصم من قبل الإدارة)
// @route   PUT /api/admin/users/:id/loyalty-points
router.put('/users/:id/loyalty-points', async (req, res) => {
  try {
    const delta = Number(req.body.delta);
    if (!delta || isNaN(delta)) {
      return res.status(400).json({ success: false, message: 'الرجاء إدخال قيمة تعديل صحيحة' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    user.loyaltyPoints = Math.max(0, (user.loyaltyPoints || 0) + delta);
    await user.save();

    res.status(200).json({
      success: true,
      message: 'تم تعديل رصيد نقاط الولاء بنجاح',
      data: { loyaltyPoints: user.loyaltyPoints },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب البروفايل الإحصائي والمالي الشامل لزبون معين
// @route   GET /api/admin/customer-profile/:id
router.get('/customer-profile/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    let customer = await User.findById(userId).select('-password');
    if (!customer) {
      // البحث برقم الهاتف إذا لم يكن ID
      customer = await User.findOne({ phone: userId, role: 'customer' }).select('-password');
    }
    if (!customer) {
      return res.status(404).json({ success: false, message: 'الزبون غير موجود' });
    }

    const orders = await Order.find({ customer: customer._id })
      .populate('shop', 'name imagePath')
      .populate('driver', 'name phone')
      .sort({ createdAt: -1 });

    const totalOrdersCount = orders.length;
    const completedOrders = orders.filter(o => o.status === 'completed');
    const completedOrdersCount = completedOrders.length;
    const cancelledOrdersCount = orders.filter(o => o.status === 'cancelled').length;
    const inProgressOrdersCount = orders.filter(o => ['pending', 'preparing', 'ready', 'accepted', 'picking_up', 'delivering'].includes(o.status)).length;

    let totalSpent = 0;
    completedOrders.forEach(o => {
      totalSpent += (o.priceDetails?.totalPrice || o.totalPaid || ((o.priceDetails?.itemsPrice || 0) + (o.priceDetails?.deliveryFee || 0)) || 0);
    });

    const averageOrderValue = completedOrdersCount > 0 ? Math.round(totalSpent / completedOrdersCount) : 0;
    const completionRate = totalOrdersCount > 0 ? Math.round((completedOrdersCount / totalOrdersCount) * 100) : 100;

    res.status(200).json({
      success: true,
      data: {
        customer,
        stats: {
          totalOrdersCount,
          completedOrdersCount,
          cancelledOrdersCount,
          inProgressOrdersCount,
          totalSpent,
          averageOrderValue,
          completionRate,
          customerRating: 4.9,
        },
        recentOrders: orders.slice(0, 20),
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    إضافة كود خصم جديد
// @route   POST /api/admin/promo
router.post('/promo', async (req, res) => {
  try {
    const { code, discountPercentage, expirationDate, assignedToPhone, minOrderAmount, isFreeDelivery } = req.body;
    if (!code || !expirationDate) {
      return res.status(400).json({ success: false, message: 'يرجى توفير جميع البيانات المطلوبة' });
    }

    let assignedTo = null;
    if (assignedToPhone && assignedToPhone.trim() !== '') {
      const user = await User.findOne({ phone: assignedToPhone.trim(), role: 'customer' });
      if (!user) {
        return res.status(404).json({ success: false, message: 'لم يتم العثور على زبون بهذا الرقم' });
      }
      assignedTo = user._id;
    }

    const promo = new PromoCode({
      code,
      discountPercentage: discountPercentage ? Number(discountPercentage) : 0,
      isFreeDelivery: Boolean(isFreeDelivery),
      expirationDate,
      assignedTo,
      minOrderAmount: minOrderAmount ? Number(minOrderAmount) : 0
    });

    await promo.save();

    // إرسال إشعار تلقائي للزبون المهدى له الخصم
    if (assignedToPhone && assignedToPhone.trim() !== '') {
      try {
        const descText = isFreeDelivery ? 'توصيل مجاني 🚚' : `خصم بقيمة ${discountPercentage}%`;
        const notif = new Ad({
          title: '🎁 هدية خصم خاصة لك!',
          subtitle: `لقد تم إهداؤك كود خصم (${descText}). رمز الخصم هو: ${code}`,
          actionText: 'استخدم الكوبون',
          type: 'notification',
          targetPhone: assignedToPhone.trim()
        });
        await notif.save();
      } catch (err) {
        console.error('Failed to create notification for promo code:', err);
      }
    }

    res.status(201).json({ success: true, data: promo });

    // إشعار Push: مباشر للزبون المهدى له، أو بث جماعي لكل الزبائن إذا كان الكوبون عاماً
    const descText = isFreeDelivery ? 'توصيل مجاني 🚚' : `خصم بقيمة ${discountPercentage}%`;
    if (assignedTo) {
      User.findById(assignedTo)
        .then((user) => sendPushToUser(user, {
          title: '🎁 هدية خصم خاصة لك!',
          body: `كود الخصم: ${code} (${descText})`,
          data: { type: 'promo', code },
        }))
        .catch(() => {});
    } else {
      sendPushToTopic('promotions', {
        title: '🎉 كوبون خصم جديد!',
        body: `استخدم الكود ${code} واحصل على ${descText}`,
        data: { type: 'promo', code },
      }).catch(() => {});
    }
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'كود الخصم موجود مسبقاً' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب جميع أكواد الخصم
// @route   GET /api/admin/promo
router.get('/promo', async (req, res) => {
  try {
    const promos = await PromoCode.find()
      .populate('assignedTo', 'name phone')
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: promos });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    حذف كود خصم
// @route   DELETE /api/admin/promo/:id
router.delete('/promo/:id', async (req, res) => {
  try {
    const promo = await PromoCode.findByIdAndDelete(req.params.id);
    if (!promo) {
      return res.status(404).json({ success: false, message: 'الكود غير موجود' });
    }
    res.status(200).json({ success: true, message: 'تم الحذف بنجاح' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب الحسابات المالية للمحلات
// @route   GET /api/admin/financials/shops
router.get('/financials/shops', async (req, res) => {
  try {
    const Shop = require('../models/Shop');
    const shops = await Shop.find().lean();
    
    // جلب جميع الطلبات المكتملة غير المسواة للمحلات
    const orders = await Order.find({ status: 'completed', isSettledShop: { $ne: true } }).lean();
    
    const shopStats = {};
    shops.forEach(s => {
      shopStats[s._id.toString()] = {
        _id: s._id,
        name: s.name,
        totalSales: 0,
        totalOrders: 0,
        commission: 0,
        unpaidBalance: 0,
      };
    });

    orders.forEach(order => {
      if (order.shop) {
        const shopId = order.shop.toString();
        if (shopStats[shopId]) {
          const itemsPrice = order.priceDetails?.itemsPrice || 0;
          shopStats[shopId].totalSales += itemsPrice;
          shopStats[shopId].totalOrders += 1;
        }
      }
    });

    // تم إلغاء عمولة المنصة 5% بالكامل (وأجور التطبيق 5% عن الزبون أيضاً) —
    // المحل يستحق كامل قيمة مبيعاته بدون أي اقتطاع
    Object.keys(shopStats).forEach(id => {
      shopStats[id].unpaidBalance = Math.round(shopStats[id].totalSales);
    });

    res.status(200).json({ success: true, data: Object.values(shopStats) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب الحسابات المالية للسائقين
// @route   GET /api/admin/financials/drivers
router.get('/financials/drivers', async (req, res) => {
  try {
    const drivers = await User.find({ role: 'driver' }).lean();
    const orders = await Order.find({ status: 'completed', isSettledDriver: { $ne: true } }).lean();

    const driverStats = {};
    drivers.forEach(d => {
      driverStats[d._id.toString()] = {
        _id: d._id,
        name: d.name,
        phone: d.phone,
        totalOrders: 0,
        totalDeliveryFees: 0,
        driverEarnings: 0,
        cashCollected: 0,
        netBalance: 0,
      };
    });

    orders.forEach(order => {
      if (order.driver) {
        const driverId = order.driver.toString();
        if (driverStats[driverId]) {
          const deliveryFee = order.priceDetails?.deliveryFee || 0;
          const totalPrice = order.priceDetails?.totalPrice || 0;
          const earnings = deliveryFee * 0.8;
          
          driverStats[driverId].totalOrders += 1;
          driverStats[driverId].totalDeliveryFees += deliveryFee;
          driverStats[driverId].driverEarnings += earnings;
          
          if (order.paymentMethod === 'cash') {
            driverStats[driverId].cashCollected += totalPrice;
            // الإدارة تطلب من السائق المبلغ الكلي للطلب مطروحاً منه مستحقات التوصيل الخاصة به (80% من أجر التوصيل)
            driverStats[driverId].netBalance -= (totalPrice - earnings);
          } else {
            // الدفع عبر الكارت أو المحفظة: السائق يطلب من الإدارة مستحقاته
            driverStats[driverId].netBalance += earnings;
          }
        }
      }
    });

    res.status(200).json({ success: true, data: Object.values(driverStats) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تسوية حساب محل أو سائق
// @route   POST /api/admin/financials/settle/:id
router.post('/financials/settle/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const Shop = require('../models/Shop');
    
    // فحص إذا كان المعرف لمحل
    const shop = await Shop.findById(id);
    if (shop) {
      await Order.updateMany(
        { shop: id, status: 'completed', isSettledShop: { $ne: true } },
        { $set: { isSettledShop: true } }
      );
      return res.status(200).json({ success: true, message: 'تم تسوية حساب المحل بنجاح وتصفير المستحقات' });
    }

    // فحص إذا كان المعرف لمستخدم (كابتن)
    const driver = await User.findById(id);
    if (driver && driver.role === 'driver') {
      await Order.updateMany(
        { driver: id, status: 'completed', isSettledDriver: { $ne: true } },
        { $set: { isSettledDriver: true } }
      );
      return res.status(200).json({ success: true, message: 'تم تسوية حساب السائق بنجاح وتصفير مستحقاته' });
    }

    res.status(404).json({ success: false, message: 'المستلم غير موجود' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب سجلات الأمان والعمليات
// @route   GET /api/admin/security/logs
router.get('/security/logs', async (req, res) => {
  try {
    const { role, action, search, limit } = req.query;
    let query = {};
    if (role && role !== 'all') {
      query.role = role;
    }
    if (action && action !== 'all') {
      query.action = action;
    }
    if (search && search.trim() !== '') {
      query.$or = [
        { username: { $regex: search, $options: 'i' } },
        { action: { $regex: search, $options: 'i' } },
        { details: { $regex: search, $options: 'i' } },
        { ipAddress: { $regex: search, $options: 'i' } }
      ];
    }
    const maxLimit = parseInt(limit) || 100;
    const logs = await AuditLog.find(query)
      .populate('userId', 'name email phone')
      .sort({ createdAt: -1 })
      .limit(maxLimit);
    res.status(200).json({ success: true, count: logs.length, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب مقاييس الأعمال وتحليل المبيعات
// @route   GET /api/admin/business/metrics
router.get('/business/metrics', async (req, res) => {
  try {
    const shops = await Shop.find({});
    const orders = await Order.find({ status: 'completed' });
    const totalRevenue = orders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
    const totalDeliveries = orders.length;

    const totalDeliveryFees = orders.reduce((sum, o) => sum + (o.priceDetails?.deliveryFee || 0), 0);

    const totalCommissions = orders.reduce((sum, o) => {
      const itemsPrice = o.priceDetails?.itemsPrice || 0;
      return sum + (itemsPrice * 0.10); // 10% عمولة
    }, 0);

    const platformNetProfit = totalDeliveryFees + totalCommissions;

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    oneWeekAgo.setHours(0, 0, 0, 0);

    const dailyStats = await Order.aggregate([
      { 
        $match: { 
          status: 'completed',
          createdAt: { $gte: oneWeekAgo }
        } 
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          totalSales: { $sum: "$totalPrice" },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const topShops = await Order.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: "$shop",
          totalSales: { $sum: "$totalPrice" },
          ordersCount: { $sum: 1 }
        }
      },
      { $sort: { totalSales: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "shops",
          localField: "_id",
          foreignField: "_id",
          as: "shopInfo"
        }
      },
      { $unwind: { path: "$shopInfo", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          name: { $ifNull: ["$shopInfo.name", "محل غير معروف"] },
          totalSales: 1,
          ordersCount: 1
        }
      }
    ]);

    const activeCustomers = await User.countDocuments({ role: 'customer' });
    const activeDrivers = await User.countDocuments({ role: 'driver' });
    const activeShops = shops.length;

    res.status(200).json({
      success: true,
      data: {
        metrics: {
          totalRevenue,
          totalDeliveries,
          totalDeliveryFees,
          totalCommissions,
          platformNetProfit,
          averageOrderValue: totalDeliveries > 0 ? (totalRevenue / totalDeliveries) : 0,
        },
        dailySales: dailyStats,
        topShops,
        activeEntities: {
          customers: activeCustomers,
          drivers: activeDrivers,
          shops: activeShops
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب البروفايل الإحصائي الشامل والطلبات المنجزة والمقبولة لسائق معين
// @route   GET /api/admin/driver-profile/:id
router.get('/driver-profile/:id', async (req, res) => {
  try {
    const driverId = req.params.id;
    let driver = null;

    if (mongoose.Types.ObjectId.isValid(driverId)) {
      driver = await User.findById(driverId).select('-password');
    }
    if (!driver) {
      driver = await User.findOne({
        $or: [{ phone: driverId }, { name: driverId }],
        role: 'driver'
      }).select('-password');
    }

    if (!driver || driver.role !== 'driver') {
      return res.status(404).json({ success: false, message: 'السائق غير موجود' });
    }

    const orders = await Order.find({
      $or: [
        { driver: driver._id },
        { driver: driver._id.toString() }
      ]
    })
      .populate('customer', 'name phone')
      .populate('shop', 'name imagePath')
      .sort({ createdAt: -1 });

    const acceptedOrdersCount = orders.filter(o => ['accepted', 'picking_up', 'delivering', 'completed'].includes(o.status)).length;
    const completedOrdersCount = orders.filter(o => o.status === 'completed' || o.status === 'delivered').length;
    const cancelledOrdersCount = orders.filter(o => o.status === 'cancelled').length;

    let totalDeliveryFeeEarned = 0;
    orders.filter(o => o.status === 'completed' || o.status === 'delivered').forEach(o => {
      totalDeliveryFeeEarned += (o.priceDetails?.deliveryFee || 0) * 0.8;
    });

    const ratedOrders = orders.filter(o => o.driverRating != null);
    let avgRating = driver.driverDetails?.rating || 5.0;
    let numReviews = driver.driverDetails?.numReviews || 0;
    if (ratedOrders.length > 0) {
      const sum = ratedOrders.reduce((acc, curr) => acc + (curr.driverRating || 0), 0);
      avgRating = Number((sum / ratedOrders.length).toFixed(1));
      numReviews = ratedOrders.length;
    }

    res.status(200).json({
      success: true,
      data: {
        driver,
        stats: {
          totalOrdersCount: orders.length,
          acceptedOrdersCount,
          completedOrdersCount,
          cancelledOrdersCount,
          totalDeliveryFeeEarned,
          rating: avgRating,
          numReviews,
        },
        orders,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    حذف حساب زبون بالكامل (مع طلباته الوهمية إن وجدت)
// @route   DELETE /api/admin/customer/:id
router.delete('/customer/:id', async (req, res) => {
  try {
    const customer = await User.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'الزبون غير موجود' });
    }
    
    if (customer.role !== 'customer') {
      return res.status(400).json({ success: false, message: 'لا يمكن حذف سوى حسابات الزبائن من هذه الواجهة' });
    }

    // حذف كافة طلبات الزبون أيضاً لمنع بقاء بيانات يتيمة
    await Order.deleteMany({ customer: customer._id });
    
    await User.findByIdAndDelete(req.params.id);

    res.status(200).json({ success: true, message: 'تم حذف حساب الزبون وطلباته بنجاح' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

