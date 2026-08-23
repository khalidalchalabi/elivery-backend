const express = require('express');
const router = express.Router();
const Shop = require('../models/Shop');
const Product = require('../models/Product');
const User = require('../models/User');
const fs = require('fs');
const path = require('path');
const { sendPushToUser } = require('../utils/sendPushNotification');

function saveBase64Image(base64Str, req) {
  // للعمل على سيرفرات مجانية مثل Vercel، سنحفظ الصورة كنص Base64 مباشرة في قاعدة البيانات
  // بدلاً من حفظها كملف فعلي لتجنب مشاكل الصلاحيات (Read-only filesystem)
  return base64Str;
}

// @desc    جلب كافة المحلات من قاعدة البيانات
// @route   GET /api/shops
router.get('/', async (req, res) => {
  try {
    // كانت هذه الاستجابة سابقاً تضم كامل قائمة منتجات كل محل (menu) عبر $lookup
    // لأغراض احتياطية بتطبيق الزبون، مما يجعل حمولة الشاشة الرئيسية ضخمة جداً
    // (مئات الكيلوبايتات) بمجرد ما يصير عند أي محل عدد منتجات كبير. الشاشة
    // الرئيسية لا تحتاج فعلياً غير بيانات المحل نفسه
    const shops = await Shop.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: shops.length, data: shops });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    إضافة محل جديد (خاص بالمسؤول)
// @route   POST /api/shops
router.post('/', async (req, res) => {
  try {
    const { name, description, imagePath, rating, deliveryTime, deliveryFee, categories, latitude, longitude, discountPercentage, minOrderAmountForDiscount } = req.body;

    let shopExists = await Shop.findOne({ name });
    if (shopExists) {
      return res.status(400).json({ success: false, message: 'هذا المحل مسجل بالفعل' });
    }

    const resolvedImagePath = saveBase64Image(imagePath, req);

    let location = undefined;
    if (latitude !== undefined && longitude !== undefined) {
      location = {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)]
      };
    }

    const shop = new Shop({
      name,
      description,
      imagePath: resolvedImagePath,
      rating,
      deliveryTime,
      deliveryFee,
      categories,
      discountPercentage: discountPercentage ? parseFloat(discountPercentage) : 0,
      minOrderAmountForDiscount: minOrderAmountForDiscount ? parseFloat(minOrderAmountForDiscount) : 0,
      ...(location && { location })
    });

    await shop.save();
    res.status(201).json({ success: true, message: 'تم إضافة المحل بنجاح', data: shop });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    حذف محل مع كافة البضائع التابعة له (خاص بالمسؤول)
// @route   DELETE /api/shops/:id
router.delete('/:id', async (req, res) => {
  try {
    const shop = await Shop.findById(req.params.id);
    if (!shop) {
      return res.status(404).json({ success: false, message: 'المحل غير موجود' });
    }

    // حذف جميع المنتجات المرتبطة بالمحل أولاً
    await Product.deleteMany({ shop: req.params.id });

    // حذف المحل نفسه
    await shop.deleteOne();

    res.status(200).json({ success: true, message: 'تم حذف المحل والبضائع التابعة له بنجاح' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تعديل بيانات محل معين (خاص بالمسؤول)
// @route   PUT /api/shops/:id
router.put('/:id', async (req, res) => {
  try {
    const { name, description, imagePath, deliveryFee, deliveryTime, categories, latitude, longitude, isOpen, discountPercentage, minOrderAmountForDiscount } = req.body;
    const shop = await Shop.findById(req.params.id);
    if (!shop) {
      return res.status(404).json({ success: false, message: 'المحل غير موجود' });
    }

    const previousDiscount = shop.discountPercentage || 0;

    if (name) shop.name = name;
    if (description !== undefined) shop.description = description;
    if (imagePath) shop.imagePath = saveBase64Image(imagePath, req);
    if (deliveryFee !== undefined) shop.deliveryFee = deliveryFee;
    if (deliveryTime) shop.deliveryTime = deliveryTime;
    if (categories) shop.categories = categories;
    if (isOpen !== undefined) shop.isOpen = isOpen;
    if (discountPercentage !== undefined) shop.discountPercentage = parseFloat(discountPercentage);
    if (minOrderAmountForDiscount !== undefined) shop.minOrderAmountForDiscount = parseFloat(minOrderAmountForDiscount);

    if (latitude !== undefined && longitude !== undefined) {
      shop.location = {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)]
      };
    }

    await shop.save();
    res.status(200).json({ success: true, message: 'تم تحديث بيانات المحل بنجاح', data: shop });

    // إشعار من فضّل هذا المحل عند زيادة نسبة الخصم
    if (shop.discountPercentage > previousDiscount) {
      User.find({ favoriteShops: shop._id })
        .then((users) => Promise.all(users.map((user) => sendPushToUser(user, {
          title: `خصم جديد بمحلك المفضل ${shop.name} 🎉`,
          body: `صار عليه خصم ${shop.discountPercentage}% الحين!`,
          data: { type: 'favorite_shop_discount', shopId: shop._id.toString() },
        }))))
        .catch(() => {});
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب كافة بضائع محل معين
// @route   GET /api/shops/:shopId/products
router.get('/:shopId/products', async (req, res) => {
  try {
    // withImages=false تُرجع بيانات المنتجات بدون صور (حمولة صغيرة جداً وسريعة)،
    // تُستخدم لعرض القائمة فوراً بمحلات المنتجات الكثيرة، ثم تُجلب الصور لاحقاً
    // بدفعات صغيرة عبر GET /:shopId/products/images
    const withImages = req.query.withImages !== 'false';
    let query = Product.find({ shop: req.params.shopId }).sort({ createdAt: -1 });
    if (!withImages) {
      query = query.select('-imagePath');
    }
    const products = await query;
    res.status(200).json({ success: true, count: products.length, data: products });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب صور دفعة من المنتجات فقط (id -> imagePath)، للتحميل التدريجي بالخلفية
// @route   GET /api/shops/:shopId/products/images?ids=id1,id2,id3
router.get('/:shopId/products/images', async (req, res) => {
  try {
    const ids = (req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 40);
    if (ids.length === 0) {
      return res.status(200).json({ success: true, data: {} });
    }
    const products = await Product.find({ shop: req.params.shopId, _id: { $in: ids } }).select('imagePath');
    const map = {};
    products.forEach((p) => { map[p._id.toString()] = p.imagePath; });
    res.status(200).json({ success: true, data: map });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    إضافة منتج/بضاعة جديدة لمحل معين (خاص بالمسؤول)
// @route   POST /api/shops/:shopId/products
function normalizeDiscount(price, origP, discP) {
  let p = parseFloat(price) || 0;
  let orig = parseFloat(origP) || 0;
  let disc = parseFloat(discP) || 0;

  if (orig > 0 && orig <= 99 && !disc) {
    disc = orig;
    orig = Math.round(p / (1 - (disc / 100)));
  } else if (orig > 0 && orig < p && (orig * 10) > p) {
    orig = orig * 10;
  }

  if (orig > p && !disc) {
    disc = Math.round(((orig - p) / orig) * 100);
  } else if (disc > 0 && (!orig || orig <= p)) {
    orig = Math.round(p / (1 - (disc / 100)));
  }

  return { originalPrice: orig, discountPercentage: disc };
}

// @desc    إضافة منتج/بضاعة جديدة لمحل معين (خاص بالمسؤول)
// @route   POST /api/shops/:shopId/products
router.post('/:shopId/products', async (req, res) => {
  try {
    const { name, description, price, originalPrice, discountPercentage, category, imagePath, rating } = req.body;

    const shop = await Shop.findById(req.params.shopId);
    if (!shop) {
      return res.status(404).json({ success: false, message: 'المحل غير موجود لإضافة البضائع إليه' });
    }

    const resolvedImagePath = saveBase64Image(imagePath, req);
    const parsedPrice = parseFloat(price) || 0;
    const { originalPrice: origP, discountPercentage: discP } = normalizeDiscount(parsedPrice, originalPrice, discountPercentage);

    const product = new Product({
      shop: req.params.shopId,
      name,
      description,
      price: parsedPrice,
      originalPrice: origP,
      discountPercentage: discP,
      category,
      imagePath: resolvedImagePath,
      rating,
    });

    await product.save();

    // إضافة تصنيف المنتج الجديد تلقائياً إلى قائمة تصنيفات المحل إذا لم يكن موجوداً
    if (!shop.categories.includes(category)) {
      shop.categories.push(category);
      await shop.save();
    }

    res.status(201).json({ success: true, message: 'تم إضافة المنتج بنجاح', data: product });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    حذف منتج معين (خاص بالمسؤول)
// @route   DELETE /api/shops/products/:id
router.delete('/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'المنتج غير موجود' });
    }

    await product.deleteOne();
    res.status(200).json({ success: true, message: 'تم حذف المنتج بنجاح' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تعديل بضاعة/منتج معين (خاص بالمسؤول)
// @route   PUT /api/shops/products/:id
router.put('/products/:id', async (req, res) => {
  try {
    const { name, description, price, originalPrice, discountPercentage, category, imagePath, isAvailable } = req.body;
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'المنتج غير موجود' });
    }

    if (name) product.name = name;
    if (description !== undefined) product.description = description;
    if (price !== undefined) product.price = parseFloat(price);

    const rawOrig = originalPrice !== undefined ? originalPrice : product.originalPrice;
    const rawDisc = discountPercentage !== undefined ? discountPercentage : product.discountPercentage;
    const { originalPrice: origP, discountPercentage: discP } = normalizeDiscount(product.price, rawOrig, rawDisc);

    product.originalPrice = origP;
    product.discountPercentage = discP;

    if (isAvailable !== undefined) product.isAvailable = isAvailable;
    if (category) {
      product.category = category;
      const shop = await Shop.findById(product.shop);
      if (shop && !shop.categories.includes(category)) {
        shop.categories.push(category);
        await shop.save();
      }
    }
    if (imagePath) product.imagePath = saveBase64Image(imagePath, req);

    await product.save();
    res.status(200).json({ success: true, message: 'تم تحديث بيانات المنتج بنجاح', data: product });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تقييم محل أو مطعم
// @route   POST /api/shops/:id/rate
router.post('/:id/rate', async (req, res) => {
  try {
    const { rating } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'الرجاء إدخال تقييم صحيح بين 1 و 5 نجوم' });
    }

    const shop = await Shop.findById(req.params.id);
    if (!shop) {
      return res.status(404).json({ success: false, message: 'المحل غير موجود' });
    }

    // Initialize rating fields if they do not exist
    if (shop.numReviews === undefined || shop.numReviews === null || shop.numReviews === 0) {
      const initialRating = shop.rating || 4.5;
      shop.numReviews = 10;
      shop.ratingSum = parseFloat((initialRating * 10).toFixed(1));
    }

    shop.numReviews += 1;
    shop.ratingSum += rating;
    shop.rating = parseFloat((shop.ratingSum / shop.numReviews).toFixed(1));

    await shop.save();

    res.status(200).json({
      success: true,
      message: 'تم تسجيل تقييمك بنجاح',
      data: { 
        rating: shop.rating,
        numReviews: shop.numReviews
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const Payout = require('../models/Payout');
const Order = require('../models/Order');

// @desc    تسجيل دفعة مالية جديدة للمحل (خاص بالمسؤول/المالك)
// @route   POST /api/shops/:shopId/payouts
router.post('/:shopId/payouts', async (req, res) => {
  try {
    const { amount, notes } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'الرجاء إدخال مبلغ صحيح' });
    }

    const shop = await Shop.findById(req.params.shopId);
    if (!shop) {
      return res.status(404).json({ success: false, message: 'المحل غير موجود' });
    }

    const payout = new Payout({
      shop: req.params.shopId,
      amount,
      notes: notes || '',
    });

    await payout.save();
    res.status(201).json({ success: true, message: 'تم تسجيل الدفعة بنجاح', data: payout });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب كافة الدفعات المالية المسجلة للمحل
// @route   GET /api/shops/:shopId/payouts
router.get('/:shopId/payouts', async (req, res) => {
  try {
    const payouts = await Payout.find({ shop: req.params.shopId }).sort({ paidAt: -1 });
    res.status(200).json({ success: true, count: payouts.length, data: payouts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب ملخص مالي كامل للمحل (المبيعات الكلية، المدفوعات، المستحقات المتبقية)
// @route   GET /api/shops/:shopId/financials
router.get('/:shopId/financials', async (req, res) => {
  try {
    const shopId = req.params.shopId;
    const shop = await Shop.findById(shopId);
    if (!shop) {
      return res.status(404).json({ success: false, message: 'المحل غير موجود' });
    }

    // 1. حساب مبيعات المحل الكلية من الطلبات المكتملة
    const completedOrders = await Order.find({ shop: shopId, status: 'completed' });
    let totalEarnings = 0;
    completedOrders.forEach(order => {
      totalEarnings += order.priceDetails?.itemsPrice || 0;
    });

    // 2. حساب مجموع المدفوعات المسلمة كاش (المؤكدة فقط)
    const payouts = await Payout.find({ shop: shopId, status: 'confirmed' });
    let totalPaid = 0;
    payouts.forEach(payout => {
      totalPaid += payout.amount || 0;
    });

    // 3. المستحقات المتبقية
    const remainingDues = totalEarnings - totalPaid;

    res.status(200).json({
      success: true,
      data: {
        totalEarnings,
        totalPaid,
        remainingDues,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تحديث حالة الدفعة المالية (موافقة/رفض من قبل التاجر)
// @route   PUT /api/shops/:shopId/payouts/:payoutId
router.put('/:shopId/payouts/:payoutId', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['confirmed', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'الحالة المرسلة غير صالحة' });
    }

    const payout = await Payout.findOne({ _id: req.params.payoutId, shop: req.params.shopId });
    if (!payout) {
      return res.status(404).json({ success: false, message: 'الدفعة المالية غير موجودة' });
    }

    payout.status = status;
    await payout.save();
    res.status(200).json({ success: true, message: 'تم تحديث حالة الدفعة بنجاح', data: payout });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
