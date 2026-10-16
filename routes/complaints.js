const express = require('express');
const router = express.Router();
const Complaint = require('../models/Complaint');
const Order = require('../models/Order');
const User = require('../models/User');
const { sendPushToUser } = require('../utils/sendPushNotification');
const { verifyToken, requireRole } = require('../middleware/auth');

// كادر الدعم والإدارة: يشوفون كل الشكاوى ويعالجونها. الزبون يشوف ويسجّل شكاواه على طلباته فقط
const STAFF_ROLES = ['support', 'admin', 'owner'];
router.use(verifyToken);

const CATEGORY_LABELS = {
  late_delivery: 'تأخر التوصيل',
  wrong_item: 'مادة خاطئة',
  damaged_item: 'مادة تالفة',
  missing_item: 'مادة ناقصة',
  rude_behavior: 'سوء تعامل',
  quality_issue: 'مشكلة بالجودة',
  other: 'أخرى',
};

const STATUS_NOTIFICATIONS = {
  in_review: { title: 'شكواك قيد المراجعة 🔎', body: 'فريق الدعم بدأ مراجعة شكواك.' },
  resolved: { title: 'تم حل شكواك ✅', body: 'تم حل شكواك، افتح "شكاواي" لمعرفة التفاصيل.' },
  rejected: { title: 'تحديث على شكواك', body: 'تمت مراجعة شكواك، افتح "شكاواي" لمعرفة التفاصيل.' },
};

// @desc    جلب كل الشكاوى (مع فلترة اختيارية بالحالة أو السائق أو الزبون)
// @route   GET /api/complaints
router.get('/', async (req, res) => {
  try {
    const isStaff = STAFF_ROLES.includes(req.user.role);
    if (!isStaff && req.user.role !== 'customer') {
      return res.status(403).json({ success: false, message: 'ليس لديك صلاحية الوصول لهذا المسار' });
    }
    const { status, driverId, customerId } = req.query;
    const query = {};
    if (status) query.status = status;
    if (isStaff) {
      if (driverId) query.targetDriver = driverId;
      if (customerId) query.customer = customerId;
    } else {
      // الزبون يرى شكاواه فقط — نتجاهل أي customerId يمرره بالطلب
      query.customer = req.user.id;
    }

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
    const isStaff = STAFF_ROLES.includes(req.user.role);
    if (!isStaff && req.user.role !== 'customer') {
      return res.status(403).json({ success: false, message: 'ليس لديك صلاحية تسجيل شكوى' });
    }
    const { orderId, category, description, targetDriverId, targetShopId } = req.body;

    if (!orderId || !category || !description) {
      return res.status(400).json({ success: false, message: 'الرجاء تعبئة الطلب والتصنيف والوصف' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    }

    // الزبون يشتكي على طلباته فقط، والمحل/السائق المستهدف يُؤخذ من الطلب نفسه ولا يُقبل من الزبون
    if (!isStaff && String(order.customer) !== req.user.id) {
      return res.status(403).json({ success: false, message: 'هذا الطلب ليس طلبك' });
    }

    const complaint = await Complaint.create({
      order: orderId,
      customer: order.customer,
      category,
      description: description.trim(),
      targetDriver: (isStaff && targetDriverId) || order.driver || null,
      targetShop: (isStaff && targetShopId) || order.shop || null,
      // الموظف الذي سجّلها يدوياً يُسجَّل كمعالج (من التوكن لا من الطلب)؛ شكوى الزبون تنتظر الاستلام
      handledBy: isStaff ? req.user.id : null,
    });

    res.status(201).json({ success: true, message: 'تم تسجيل الشكوى بنجاح', data: complaint });

    // إشعار فوري لكادر الدعم والإدارة بوصول شكوى جديدة (لا يؤخر الاستجابة، ويفشل بصمت)
    const shortId = complaint._id.toString().slice(-6).toUpperCase();
    User.find({ role: { $in: ['support', 'admin', 'owner'] }, isActive: { $ne: false } })
      .then((staff) => staff.forEach((member) =>
        sendPushToUser(member, {
          title: 'شكوى جديدة ⚠️',
          body: `شكوى #${shortId} — ${CATEGORY_LABELS[category] || category}`,
          data: { type: 'new_complaint', complaintId: complaint._id.toString(), orderId: String(orderId) },
        })
      ))
      .catch((err) => console.error('فشل إشعار الكادر بالشكوى الجديدة:', err.message));
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تحديث حالة شكوى (قيد المراجعة / محلولة / مرفوضة) مع ملاحظة توثيقية
// @route   PUT /api/complaints/:id
router.put('/:id', requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const { status, resolutionNote } = req.body;
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ success: false, message: 'الشكوى غير موجودة' });
    }

    const previousStatus = complaint.status;
    if (status) complaint.status = status;
    if (resolutionNote !== undefined) complaint.resolutionNote = resolutionNote.trim();
    // المعالج هو الموظف المسجّل بالتوكن، لا قيمة يرسلها العميل
    complaint.handledBy = req.user.id;
    if (status === 'resolved' || status === 'rejected') {
      complaint.resolvedAt = new Date();
    }

    await complaint.save();
    res.status(200).json({ success: true, message: 'تم تحديث الشكوى بنجاح', data: complaint });

    // إشعار الزبون عند تغيّر حالة شكواه (قيد المراجعة / محلولة / مرفوضة)
    if (status && status !== previousStatus && STATUS_NOTIFICATIONS[status]) {
      User.findById(complaint.customer)
        .then((customer) => sendPushToUser(customer, {
          ...STATUS_NOTIFICATIONS[status],
          data: { type: 'complaint_update', complaintId: complaint._id.toString(), status },
        }))
        .catch(() => {});
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    إحصائيات أداء السائقين (طلبات منجزة، ملغاة بعد القبول، متوسط وقت التوصيل، التقييم، الشكاوى)
// @route   GET /api/complaints/driver-performance
router.get('/stats/driver-performance', requireRole(...STAFF_ROLES), async (req, res) => {
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
