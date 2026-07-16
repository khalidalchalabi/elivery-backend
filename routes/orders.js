const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const User = require('../models/User');

// @desc    جلب كافة الطلبات في النظام
// @route   GET /api/orders
router.get('/', async (req, res) => {
  try {
    const orders = await Order.find()
      .populate('customer', 'name phone')
      .populate('driver', 'name phone')
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب كافة الطلبات لمحل معين
// @route   GET /api/orders/shop/:shopId
router.get('/shop/:shopId', async (req, res) => {
  try {
    const orders = await Order.find({ shop: req.params.shopId })
      .populate('customer', 'name phone')
      .populate('driver', 'name phone')
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

    // إنشاء الطلب بالاحداثيات الجغرافية
    const order = new Order({
      customer: finalCustomerId,
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
router.get('/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('customer', 'name phone email')
      .populate('driver', 'name phone driverDetails.vehicleType driverDetails.plateNumber')
      .populate('shop', 'name categories');

    if (!order) {
      return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    }

    res.status(200).json({ success: true, data: order });
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
    await order.save();

    // تحديث حالة السائق إلى غير متاح حالياً لاستلام طلبات أخرى
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

module.exports = router;
