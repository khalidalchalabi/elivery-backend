const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const User = require('../models/User');

// @desc    جلب كافة الطلبات في النظام
// @route   GET /api/orders
router.get('/', async (req, res) => {
  try {
    const { status, driver, shop, customer, limit = 50, showCompleted = 'false' } = req.query;

    const query = {};

    if (status) {
      if (status.includes(',')) {
        query.status = { $in: status.split(',') };
      } else {
        query.status = status;
      }
    } else if (showCompleted !== 'true') {
      // بشكل افتراضي، لتجنب البطء، نجلب الطلبات النشطة فقط والطلب المنجز/الملغي خلال الـ 24 ساعة الماضية
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      query.$or = [
        { status: { $in: ['pending', 'preparing', 'ready', 'accepted', 'picking_up', 'delivering'] } },
        { status: { $in: ['completed', 'cancelled'] }, createdAt: { $gte: oneDayAgo } }
      ];
    }

    if (driver) {
      query.driver = driver;
    }
    if (shop) {
      query.shop = shop;
    }
    if (customer) {
      query.customer = customer;
    }

    const orders = await Order.find(query)
      .populate('customer', 'name phone email createdAt')
      .populate('driver', 'name phone driverDetails profilePicture')
      .populate('shop', 'name imagePath deliveryFee description location')
      .limit(parseInt(limit))
      .lean()
      .sort({ createdAt: -1 });

    // جلب جميع هواتف التجار في استعلام واحد لتجنب الضغط على قاعدة البيانات
    const shopIds = orders.map(o => o.shop && (o.shop._id || o.shop)).filter(Boolean);
    const merchants = await User.find({ shop: { $in: shopIds } }).select('phone shop role').lean();
    const merchantPhoneMap = {};
    merchants.forEach(m => {
      if (m.shop) {
        merchantPhoneMap[m.shop.toString()] = m.phone;
      }
    });

    const ordersWithMerchant = orders.map((order) => {
      let merchantPhone = null;
      if (order.shop) {
        const sId = (order.shop._id || order.shop).toString();
        merchantPhone = merchantPhoneMap[sId] || (order.shop && order.shop.phone) || null;
      }
      return {
        ...order,
        merchantPhone
      };
    });

    res.status(200).json({ success: true, count: ordersWithMerchant.length, data: ordersWithMerchant });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب كافة الطلبات لمحل معين
// @route   GET /api/orders/shop/:shopId
router.get('/shop/:shopId', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const orders = await Order.find({ shop: req.params.shopId, status: { $ne: 'awaiting_verification' } })
      .populate('customer', 'name phone')
      .populate('driver', 'name phone')
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    إنشاء طلب توصيل جديد
// @route   POST /api/orders
router.post('/', async (req, res) => {
  console.log('Incoming order body:', req.body);
  try {
    let {
      customerId,
      items,
      pickupAddress,
      pickupLat,
      pickupLng,
      dropoffAddress,
      dropoffLat,
      dropoffLng,
      itemsPrice,
      deliveryFee,
      promoCode,
      discountAmount,
      paymentMethod,
      replacementPreference,
      scheduledFor,
      shopId,
    } = req.body;

    // دعم كلا التنسيقين (المتداخل والمسطح) لتجنب أخطاء الإرسال
    if (!pickupAddress && req.body.pickupLocation) {
      pickupAddress = req.body.pickupLocation.address;
      if (Array.isArray(req.body.pickupLocation.coordinates)) {
        pickupLng = req.body.pickupLocation.coordinates[0];
        pickupLat = req.body.pickupLocation.coordinates[1];
      }
    }
    if (!dropoffAddress && req.body.dropoffLocation) {
      dropoffAddress = req.body.dropoffLocation.address;
      if (Array.isArray(req.body.dropoffLocation.coordinates)) {
        dropoffLng = req.body.dropoffLocation.coordinates[0];
        dropoffLat = req.body.dropoffLocation.coordinates[1];
      }
    }

    if (!customerId || !pickupAddress || !dropoffAddress || itemsPrice === undefined || deliveryFee === undefined) {
      return res.status(400).json({ success: false, message: 'الرجاء توفير جميع بيانات الطلب الأساسية' });
    }

    let finalShopId = shopId;
    if (!finalShopId && items && items.length > 0 && items[0].product) {
      const Product = require('../models/Product');
      const firstProduct = await Product.findById(items[0].product);
      if (firstProduct && firstProduct.shop) {
        finalShopId = firstProduct.shop.toString();
      }
    }

    // التحقق من صحة العميل
    let customer = await User.findById(customerId);
    if (!customer) {
      customer = await User.findOne({ role: 'customer' });
    }
    if (!customer) {
      return res.status(404).json({ success: false, message: 'العميل غير موجود' });
    }
    const finalCustomerId = customer._id;

    const discount = discountAmount || 0;
    const itemsPriceNum = parseFloat(itemsPrice);
    const deliveryFeeNum = parseFloat(deliveryFee);
    const totalPrice = itemsPriceNum + deliveryFeeNum - discount;

    const completedOrders = await Order.countDocuments({ customer: finalCustomerId, status: 'completed' });
    const isFirstOrder = completedOrders === 0;

    // إنشاء الطلب بالاحداثيات الجغرافية
    const order = new Order({
      customer: finalCustomerId,
      status: isFirstOrder ? 'awaiting_verification' : 'pending',
      items,
      pickupLocation: {
        type: 'Point',
        coordinates: [parseFloat(pickupLng), parseFloat(pickupLat)], // [Longitude, Latitude]
        address: pickupAddress,
      },
      dropoffLocation: {
        type: 'Point',
        coordinates: [parseFloat(dropoffLng), parseFloat(dropoffLat)], // [Longitude, Latitude]
        address: dropoffAddress,
      },
      paymentMethod,
      replacementPreference: replacementPreference || 'call_me',
      scheduledFor: scheduledFor || null,
      totalPaid: totalPrice,
      promoCode: promoCode || null,
      discountAmount: discount,
      priceDetails: {
        itemsPrice: itemsPriceNum,
        deliveryFee: deliveryFeeNum,
        totalPrice: totalPrice,
      },
      shop: finalShopId || null,
    });

    await order.save();

    res.status(201).json({
      success: true,
      message: 'تم إنشاء الطلب بنجاح وهو بانتظار قبول السائق',
      data: order,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب إحصائيات لوحة التحكم والحسابات المالية للكادر
// @route   GET /api/orders/dashboard/stats
router.get('/dashboard/stats', async (req, res) => {
  try {
    const totalOrdersCount = await Order.countDocuments();
    const pendingCount = await Order.countDocuments({ status: 'pending' });
    const activeCount = await Order.countDocuments({ status: { $in: ['accepted', 'picking_up', 'delivering'] } });
    const completedCount = await Order.countDocuments({ status: 'completed' });
    const cancelledCount = await Order.countDocuments({ status: 'cancelled' });

    const completedOrders = await Order.find({ status: 'completed' });
    
    let totalRevenue = 0;
    let totalItemsPrice = 0;
    let totalDeliveryFees = 0;

    completedOrders.forEach(order => {
      totalRevenue += order.priceDetails?.totalPrice || 0;
      totalItemsPrice += order.priceDetails?.itemsPrice || 0;
      totalDeliveryFees += order.priceDetails?.deliveryFee || 0;
    });

    const driverEarnings = totalDeliveryFees * 0.8;
    const appCommission = totalDeliveryFees * 0.2;

    res.status(200).json({
      success: true,
      data: {
        counts: {
          total: totalOrdersCount,
          pending: pendingCount,
          active: activeCount,
          completed: completedCount,
          cancelled: cancelledCount,
        },
        financials: {
          totalRevenue,
          totalItemsPrice,
          totalDeliveryFees,
          driverEarnings,
          appCommission,
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب تفاصيل طلب معين
// @route   GET /api/orders/:id
// @desc    فحص هل يحتاج الزبون لتقييم المحل أو السائق (أول مرة فقط لكل منهما)
// @route   GET /api/orders/check-rating-eligibility
router.get('/check-rating-eligibility', async (req, res) => {
  try {
    const { customerId, shopId, driverId } = req.query;

    let needsShopRating = false;
    let needsDriverRating = false;

    if (customerId && shopId) {
      const existingShopRating = await Order.findOne({
        customer: customerId,
        shop: shopId,
        shopRating: { $ne: null }
      });
      needsShopRating = !existingShopRating;
    }

    if (customerId && driverId) {
      const existingDriverRating = await Order.findOne({
        customer: customerId,
        driver: driverId,
        driverRating: { $ne: null }
      });
      needsDriverRating = !existingDriverRating;
    }

    res.status(200).json({
      success: true,
      data: {
        needsShopRating,
        needsDriverRating,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('customer', 'name phone email')
      .populate('driver', 'name phone profilePicture avatar driverDetails')
      .populate('shop', 'name categories');

    if (!order) {
      return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    }

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تعيين أو تغيير السائق قسرياً للطلب (خاص بالدعم/المسؤول)
// @route   PUT /api/orders/:id/assign-driver
router.put('/:id/assign-driver', async (req, res) => {
  try {
    const { driverId } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    }

    // إتاحة السائق القديم (إن وجد)
    if (order.driver) {
      await User.findByIdAndUpdate(order.driver, {
        'driverDetails.isAvailable': true,
      });
    }

    // تعيين السائق الجديد
    if (driverId) {
      const driver = await User.findById(driverId);
      if (!driver || driver.role !== 'driver') {
        return res.status(404).json({ success: false, message: 'السائق الجديد غير موجود' });
      }
      order.driver = driverId;
      if (['pending', 'preparing', 'ready'].includes(order.status)) {
        order.status = 'accepted';
        order.acceptedAt = Date.now();
      }
      
      if (!driver.driverDetails) {
        driver.driverDetails = {};
      }
      driver.driverDetails.isAvailable = false;
      await driver.save();
    } else {
      order.driver = null;
      order.status = 'pending';
    }

    await order.save();
    res.status(200).json({ success: true, message: 'تم تعيين السائق للطلب بنجاح', data: order });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تأكيد الطلب للزبون الجديد (بواسطة الدعم الفني)
// @route   PUT /api/orders/:id/verify
router.put('/:id/verify', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    }
    if (order.status !== 'awaiting_verification') {
      return res.status(400).json({ success: false, message: 'هذا الطلب تم تأكيده مسبقاً أو أنه في حالة أخرى' });
    }
    order.status = 'pending';
    await order.save();

    res.status(200).json({
      success: true,
      message: 'تم تأكيد الطلب بنجاح وإرساله للمتجر',
      data: order,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    قبول الطلب من قبل السائق
// @route   PUT /api/orders/:id/accept
router.put('/:id/accept', async (req, res) => {
  try {
    const { driverId } = req.body;
    console.log('Accepting order:', req.params.id, 'by driver:', driverId);

    // التحقق من صحة السائق
    const driver = await User.findById(driverId);
    if (!driver || driver.role !== 'driver') {
      console.log('Driver not found or not driver role');
      return res.status(404).json({ success: false, message: 'السائق غير موجود' });
    }

    // البحث عن الطلب وتحديثه
    const order = await Order.findById(req.params.id);
    if (!order) {
      console.log('Order not found');
      return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    }

    if (!['pending', 'preparing', 'ready'].includes(order.status)) {
      console.log('Order status is invalid:', order.status);
      return res.status(400).json({ success: false, message: 'هذا الطلب تم قبوله بالفعل أو ملغى' });
    }

    if (order.driver) {
      console.log('Order already has a driver assigned:', order.driver);
      return res.status(400).json({ success: false, message: 'تم استلام هذا الطلب من قبل سائق آخر' });
    }

    order.driver = driverId;
    order.status = 'accepted';
    order.acceptedAt = Date.now();
    await order.save();

    // تحديث حالة السائق إلى غير متاح حالياً لاستلام طلبات أخرى
    if (!driver.driverDetails) {
      driver.driverDetails = {};
    }
    driver.driverDetails.isAvailable = false;
    await driver.save();

    res.status(200).json({
      success: true,
      message: 'تم قبول الطلب بنجاح وتعيينه للسائق',
      data: order,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تحديث حالة الطلب (على سبيل المثال: picking_up, delivering, completed)
// @route   PUT /api/orders/:id/status
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;

    const validStatuses = ['preparing', 'ready', 'picking_up', 'delivering', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'حالة الطلب غير صالحة' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    }

    order.status = status;
    
    if (status === 'accepted' || status === 'picking_up' || status === 'delivering') {
      if (!order.acceptedAt) {
        order.acceptedAt = Date.now();
      }
      if ((status === 'picking_up' || status === 'delivering') && !order.pickedUpAt) {
        order.pickedUpAt = Date.now();
      }
    } else if (status === 'completed') {
      order.deliveredAt = Date.now();
    }
    
    // إذا اكتمل الطلب أو ألغي، نعيد السائق متاحاً
    if (status === 'completed' || status === 'cancelled') {
      if (order.driver) {
        await User.findByIdAndUpdate(order.driver, {
          'driverDetails.isAvailable': true,
        });
      }
    }

    await order.save();

    res.status(200).json({
      success: true,
      message: `تم تحديث حالة الطلب إلى ${status}`,
      data: order,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    البحث عن الطلبات النشطة القريبة من السائق (للسائقين للبحث عن طلبات قريبة)
// @route   GET /api/orders/nearby/pending
router.get('/nearby/pending', async (req, res) => {
  try {
    const { longitude, latitude, maxDistance = 10000 } = req.query; // الافتراضي 10 كم

    if (!longitude || !latitude) {
      return res.status(400).json({ success: false, message: 'الرجاء إدخال خط الطول والعرض' });
    }

    const orders = await Order.find({
      status: 'pending',
      pickupLocation: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(longitude), parseFloat(latitude)],
          },
          $maxDistance: parseInt(maxDistance),
        },
      },
    });

    res.status(200).json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});



// @desc    تسجيل تقييم الزبون للمحل و/أو السائق لطلب معين
// @route   POST /api/orders/:id/rate
router.post('/:id/rate', async (req, res) => {
  try {
    const { shopRating, driverRating, shopComment, driverComment } = req.body;
    const Shop = require('../models/Shop');

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    }

    let shopUpdated = false;
    let driverUpdated = false;

    // 1. تقييم المحل
    if (shopRating && shopRating >= 1 && shopRating <= 5) {
      order.shopRating = Number(shopRating);
      order.shopComment = shopComment || '';
      order.shopRatedAt = new Date();
      shopUpdated = true;

      if (order.shop) {
        const shop = await Shop.findById(order.shop);
        if (shop) {
          if (!shop.numReviews) {
            const initialRating = shop.rating || 4.5;
            shop.numReviews = 10;
            shop.ratingSum = parseFloat((initialRating * 10).toFixed(1));
          }
          shop.numReviews += 1;
          shop.ratingSum += Number(shopRating);
          shop.rating = parseFloat((shop.ratingSum / shop.numReviews).toFixed(1));
          await shop.save();
        }
      }
    }

    // 2. تقييم السائق
    if (driverRating && driverRating >= 1 && driverRating <= 5) {
      order.driverRating = Number(driverRating);
      order.driverComment = driverComment || '';
      order.driverRatedAt = new Date();
      driverUpdated = true;

      if (order.driver) {
        const driver = await User.findById(order.driver);
        if (driver && driver.role === 'driver') {
          if (!driver.driverDetails) driver.driverDetails = {};
          let numRev = driver.driverDetails.numReviews || 0;
          let rSum = driver.driverDetails.ratingSum || 0;

          if (numRev === 0) {
            numRev = 5;
            rSum = 25.0; // البداية بـ 5 تقييمات بمعدل 5 نجوم
          }

          numRev += 1;
          rSum += Number(driverRating);
          driver.driverDetails.numReviews = numRev;
          driver.driverDetails.ratingSum = rSum;
          driver.driverDetails.rating = parseFloat((rSum / numRev).toFixed(1));
          await driver.save();
        }
      }
    }

    await order.save();

    res.status(200).json({
      success: true,
      message: 'تم حفظ تقييمك بنجاح. شكراً لك!',
      data: order
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب كافة التقييمات والأرشيف للطلبات (خاص بالدعم الفني والمالك والإدارة)
// @route   GET /api/orders/ratings/all
router.get('/ratings/all', async (req, res) => {
  try {
    const ratedOrders = await Order.find({
      $or: [
        { shopRating: { $ne: null } },
        { driverRating: { $ne: null } },
        { status: { $in: ['completed', 'delivered', 'cancelled'] } }
      ]
    })
      .populate('customer', 'name phone')
      .populate('driver', 'name phone profilePicture avatar driverDetails')
      .populate('shop', 'name imagePath rating')
      .sort({ updatedAt: -1 })
      .limit(100);

    res.status(200).json({
      success: true,
      count: ratedOrders.length,
      data: ratedOrders
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

