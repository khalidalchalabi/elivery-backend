const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Order = require('../models/Order');
const PromoCode = require('../models/PromoCode');
const Ad = require('../models/Ad');
const Shop = require('../models/Shop');
const AuditLog = require('../models/AuditLog');

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
      };
    });

    res.status(200).json({ success: true, count: customersWithStats.length, data: customersWithStats });
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
          shopStats[shopId].commission += itemsPrice * 0.05;
        }
      }
    });

    Object.keys(shopStats).forEach(id => {
      // 30% من المبيعات تذهب للتاجر، أو 5% عمولة للمنصة (حسب ما هو معتمد)
      // التاجر يستحق 95% من مبيعاته (أي مبيعاته ناقص 5% عمولة المنصة)
      shopStats[id].unpaidBalance = Math.round(shopStats[id].totalSales * 0.95);
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

module.exports = router;
