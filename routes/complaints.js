const express = require('express');
const router = express.Router();
const Complaint = require('../models/Complaint');
const Order = require('../models/Order');
const User = require('../models/User');

// @desc    جلب كل الشكاوى (مع فلترة اختيارية بالحالة أو السائق)
// @route   GET /api/complaints
router.get('/', async (req, res) => {
  try {
    const { status, driverId } = req.query;
    const query = {};
    if (status) query.status = status;
    if (driverId) query.targetDriver = driverId;

    const complaints = await Complaint.find(query)
      .populate('customer', 'name phone')
      .populate('targetDriver', 'name phone')
      .populate('targetShop', 'name')
      .populate('handledBy', 'name')
      .populate('order', 'createdAt status')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: complaints.length, data: complaints });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تسجيل شكوى جديدة (من قبل الدعم يدوياً)
// @route   POST /api/complaints
router.post('/', async (req, res) => {
  try {
    const { orderId, category, description, targetDriverId, targetShopId, handledById } = req.body;

    if (!orderId || !category || !description) {
      return res.status(400).json({ success: false, message: 'الرجاء تعبئة الطلب والتصنيف والوصف' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    }

    const complaint = await Complaint.create({
      order: orderId,
      customer: order.customer,
      category,
      description: description.trim(),
      targetDriver: targetDriverId || order.driver || null,
      targetShop: targetShopId || order.shop || null,
      handledBy: handledById || null,
    });

    res.status(201).json({ success: true, message: 'تم تسجيل الشكوى بنجاح', data: complaint });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تحديث حالة شكوى (قيد المراجعة / محلولة / مرفوضة) مع ملاحظة توثيقية
// @route   PUT /api/complaints/:id
router.put('/:id', async (req, res) => {
  try {
    const { status, resolutionNote, handledById } = req.body;
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ success: false, message: 'الشكوى غير موجودة' });
    }

    if (status) complaint.status = status;
    if (resolutionNote !== undefined) complaint.resolutionNote = resolutionNote.trim();
    if (handledById) complaint.handledBy = handledById;
    if (status === 'resolved' || status === 'rejected') {
      complaint.resolvedAt = new Date();
    }

    await complaint.save();
    res.status(200).json({ success: true, message: 'تم تحديث الشكوى بنجاح', data: complaint });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    إحصائيات أداء السائقين (طلبات منجزة، ملغاة بعد القبول، متوسط وقت التوصيل، التقييم، الشكاوى)
// @route   GET /api/complaints/driver-performance
router.get('/stats/driver-performance', async (req, res) => {
  try {
    const drivers = await User.find({ role: 'driver' }).select('name phone driverDetails isActive');
    const driverIds = drivers.map(d => d._id);

    const orders = await Order.find({ driver: { $in: driverIds } }).select('driver status acceptedAt deliveredAt');
    const complaintCounts = await Complaint.aggregate([
      { $match: { targetDriver: { $in: driverIds } } },
      { $group: { _id: '$targetDriver', count: { $sum: 1 } } },
    ]);
    const complaintMap = {};
    complaintCounts.forEach(c => { complaintMap[c._id.toString()] = c.count; });

    const performance = drivers.map(driver => {
      const driverOrders = orders.filter(o => o.driver && o.driver.toString() === driver._id.toString());
      const completed = driverOrders.filter(o => o.status === 'completed');
      const cancelledAfterAccepted = driverOrders.filter(o => o.status === 'cancelled' && o.acceptedAt);

      let totalMinutes = 0;
      let timedCount = 0;
      completed.forEach(o => {
        if (o.acceptedAt && o.deliveredAt) {
          totalMinutes += (new Date(o.deliveredAt) - new Date(o.acceptedAt)) / 60000;
          timedCount += 1;
        }
      });
      const avgDeliveryMinutes = timedCount > 0 ? Math.round(totalMinutes / timedCount) : null;

      const totalHandled = driverOrders.length;
      const reliabilityRate = totalHandled > 0
        ? Math.round(((totalHandled - cancelledAfterAccepted.length) / totalHandled) * 100)
        : 100;

      return {
        _id: driver._id,
        name: driver.name,
        phone: driver.phone,
        isActive: driver.isActive,
        rating: driver.driverDetails?.rating || 0,
        numReviews: driver.driverDetails?.numReviews || 0,
        totalOrders: totalHandled,
        completedOrders: completed.length,
        cancelledAfterAccepted: cancelledAfterAccepted.length,
        reliabilityRate,
        avgDeliveryMinutes,
        complaintsCount: complaintMap[driver._id.toString()] || 0,
      };
    });

    performance.sort((a, b) => b.completedOrders - a.completedOrders);

    res.status(200).json({ success: true, data: performance });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
