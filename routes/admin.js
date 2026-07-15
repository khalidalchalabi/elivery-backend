const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Order = require('../models/Order');
const PromoCode = require('../models/PromoCode');

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
          totalOrders: { $size: '$completedOrders' },
          totalSpent: { $sum: '$completedOrders.totalPaid' }
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

// @desc    إضافة كود خصم جديد
// @route   POST /api/admin/promo
router.post('/promo', async (req, res) => {
  try {
    const { code, discountPercentage, expirationDate, assignedToPhone } = req.body;
    if (!code || !discountPercentage || !expirationDate) {
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
      discountPercentage,
      expirationDate,
      assignedTo
    });

    await promo.save();
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

module.exports = router;
