const express = require('express');
const router = express.Router();
const Shop = require('../models/Shop');
const Product = require('../models/Product');
const fs = require('fs');
const path = require('path');

// دالة مساعدة لحفظ الصورة المرفوعة كـ base64 كملف محلي
function saveBase64Image(base64Str, req) {
  if (!base64Str || !base64Str.startsWith('data:image/')) {
    return base64Str; // إرجاع الرابط كما هو إذا كان رابطاً أو إيموجي
  }

  const matches = base64Str.match(/^data:image\/([A-Za-z0-9+-]+);base64,([\s\S]+)$/);
  if (!matches || matches.length !== 3) {
    return base64Str;
  }

  const ext = matches[1];
  const data = matches[2];
  const buffer = Buffer.from(data, 'base64');

  // التأكد من وجود مجلد الرفع
  const dir = path.join(__dirname, '../public/uploads');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filename = `img_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, buffer);

  const host = req.headers.host;
  return `${req.protocol}://${host}/uploads/${filename}`;
}

// @desc    جلب كافة المحلات من قاعدة البيانات
// @route   GET /api/shops
router.get('/', async (req, res) => {
  try {
    const shops = await Shop.find().lean().sort({ createdAt: -1 });
    
    // جلب المنتجات لكل محل وإرفاقها كـ menu لتسهيل البحث بالزبون
    const Product = require('../models/Product');
    const shopsWithMenu = await Promise.all(
      shops.map(async (shop) => {
        const products = await Product.find({ shop: shop._id }).lean();
        return {
          ...shop,
          menu: products,
        };
      })
    );

    res.status(200).json({ success: true, count: shopsWithMenu.length, data: shopsWithMenu });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    إضافة محل جديد (خاص بالمسؤول)
// @route   POST /api/shops
router.post('/', async (req, res) => {
  try {
    const { name, description, imagePath, rating, deliveryTime, deliveryFee, categories } = req.body;

    let shopExists = await Shop.findOne({ name });
    if (shopExists) {
      return res.status(400).json({ success: false, message: 'هذا المحل مسجل بالفعل' });
    }

    const resolvedImagePath = saveBase64Image(imagePath, req);

    const shop = new Shop({
      name,
      description,
      imagePath: resolvedImagePath,
      rating,
      deliveryTime,
      deliveryFee,
      categories,
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
    const { name, description, imagePath, deliveryFee, deliveryTime, categories } = req.body;
    const shop = await Shop.findById(req.params.id);
    if (!shop) {
      return res.status(404).json({ success: false, message: 'المحل غير موجود' });
    }

    if (name) shop.name = name;
    if (description !== undefined) shop.description = description;
    if (imagePath) shop.imagePath = saveBase64Image(imagePath, req);
    if (deliveryFee !== undefined) shop.deliveryFee = deliveryFee;
    if (deliveryTime) shop.deliveryTime = deliveryTime;
    if (categories) shop.categories = categories;

    await shop.save();
    res.status(200).json({ success: true, message: 'تم تحديث بيانات المحل بنجاح', data: shop });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب كافة بضائع محل معين
// @route   GET /api/shops/:shopId/products
router.get('/:shopId/products', async (req, res) => {
  try {
    const products = await Product.find({ shop: req.params.shopId }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: products.length, data: products });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    إضافة منتج/بضاعة جديدة لمحل معين (خاص بالمسؤول)
// @route   POST /api/shops/:shopId/products
router.post('/:shopId/products', async (req, res) => {
  try {
    const { name, description, price, category, imagePath, rating } = req.body;

    const shop = await Shop.findById(req.params.shopId);
    if (!shop) {
      return res.status(404).json({ success: false, message: 'المحل غير موجود لإضافة البضائع إليه' });
    }

    const resolvedImagePath = saveBase64Image(imagePath, req);

    const product = new Product({
      shop: req.params.shopId,
      name,
      description,
      price,
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
    const { name, description, price, category, imagePath } = req.body;
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'المنتج غير موجود' });
    }

    if (name) product.name = name;
    if (description !== undefined) product.description = description;
    if (price !== undefined) product.price = price;
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

    const currentRating = shop.rating || 4.5;
    const newRating = parseFloat(((currentRating * 4 + rating) / 5).toFixed(1));

    shop.rating = newRating;
    await shop.save();

    res.status(200).json({
      success: true,
      message: 'تم تسجيل تقييمك بنجاح',
      data: { rating: newRating },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
