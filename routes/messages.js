const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const User = require('../models/User');
const { sendPushToUser } = require('../utils/sendPushNotification');

// @desc    إرسال رسالة جديدة (سواء من السائق أو الزبون أو الدعم)
// @route   POST /api/messages
router.post('/', async (req, res) => {
  try {
    const userId = req.body.driverId || req.body.userId;
    const { senderRole, text } = req.body;

    if (!userId || !senderRole || !text) {
      return res.status(400).json({ success: false, message: 'يجب توفير معرف المستخدم، دور المرسل ونص الرسالة' });
    }

    const message = new Message({
      driver: userId,
      senderRole,
      text,
    });

    await message.save();

    res.status(201).json({
      success: true,
      message: 'تم إرسال الرسالة بنجاح',
      data: message,
    });

    // إشعار المستخدم بردّ الدعم الفني (بدون تأخير الاستجابة)
    if (senderRole === 'support') {
      User.findById(userId)
        .then((user) => sendPushToUser(user, {
          title: 'رد جديد من الدعم الفني 💬',
          body: text.length > 80 ? `${text.substring(0, 80)}...` : text,
          data: { type: 'support_message' },
        }))
        .catch(() => {});
    } else {
      // رسالة من سائق أو زبون: نشعر موظف الدعم المستلم للمحادثة تحديداً إذا
      // كانت مستلمة، وإلا كل موظفي الدعم (لأي منهم يقدر يستلمها)
      User.findById(userId)
        .then(async (user) => {
          const senderLabel = senderRole === 'driver' ? 'سائق' : 'زبون';
          const body = text.length > 80 ? `${text.substring(0, 80)}...` : text;
          if (user && user.assignedSupport) {
            const agent = await User.findById(user.assignedSupport);
            if (agent) {
              sendPushToUser(agent, {
                title: `رسالة جديدة من ${senderLabel} 💬`,
                body,
                data: { type: 'driver_message', userId: userId.toString() },
              });
            }
            return;
          }
          const supportStaff = await User.find({ role: 'support' });
          supportStaff.forEach((agent) =>
            sendPushToUser(agent, {
              title: `رسالة جديدة من ${senderLabel} 💬`,
              body,
              data: { type: 'driver_message', userId: userId.toString() },
            })
          );
        })
        .catch(() => {});
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب محادثة مستخدم معين
// @route   GET /api/messages/:driverId
router.get('/:driverId', async (req, res) => {
  try {
    const { driverId } = req.params;
    const { role } = req.query;

    const messages = await Message.find({ driver: driverId }).sort({ createdAt: 1 });

    let updateQuery = { driver: driverId, isRead: false };
    if (role === 'support') {
      updateQuery.senderRole = { $ne: 'support' };
    } else {
      updateQuery.senderRole = 'support';
    }
    await Message.updateMany(updateQuery, { $set: { isRead: true } });

    res.status(200).json({
      success: true,
      count: messages.length,
      data: messages,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب عدد الرسائل غير المقروءة لمستخدم معين حسب دوره
// @route   GET /api/messages/:driverId/unread-count
router.get('/:driverId/unread-count', async (req, res) => {
  try {
    const { driverId } = req.params;
    const { role } = req.query;

    let query = { driver: driverId, isRead: false };
    if (role === 'support') {
      query.senderRole = { $ne: 'support' };
    } else {
      query.senderRole = 'support';
    }

    const count = await Message.countDocuments(query);
    res.status(200).json({
      success: true,
      count,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب المحادثات النشطة (لموظفي الدعم)
// @route   GET /api/messages/support/conversations
router.get('/support/conversations', async (req, res) => {
  try {
    // جلب أحدث رسالة لكل مستخدم ومجموع الرسائل غير المقروءة للدعم
    const conversations = await Message.aggregate([
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$driver',
          lastMessage: { $first: '$$ROOT' },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$senderRole', 'support'] },
                    { $eq: ['$isRead', false] }
                  ]
                },
                1,
                0
              ]
            }
          }
        },
      },
    ]);

    // جلب معلومات المستخدمين للمحادثات (سائقين وزبائن)
    const driverIds = conversations.map((conv) => conv._id);
    const drivers = await User.find({ _id: { $in: driverIds } }, 'name phone profilePicture role assignedSupport assignedSupportName');

    const result = conversations.map((conv) => {
      const driverInfo = drivers.find((d) => d._id.toString() === conv._id.toString());
      return {
        driver: driverInfo,
        lastMessage: conv.lastMessage,
        unreadCount: conv.unreadCount || 0,
      };
    }).filter(conv => conv.driver != null); // استبعاد أي رسائل لمستخدم محذوف

    // ترتيب حسب الأحدث
    result.sort((a, b) => new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt));

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    استلام محادثة الدعم من قبل موظف معين
// @route   POST /api/messages/support/claim
router.post('/support/claim', async (req, res) => {
  try {
    const { userId, staffId, staffName } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'يجب تحديد المستخدم' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    user.assignedSupport = staffId || null;
    user.assignedSupportName = staffName || 'موظف الدعم';
    await user.save();

    res.status(200).json({
      success: true,
      message: `تم استلام المحادثة بنجاح بواسطة ${user.assignedSupportName}`,
      data: {
        assignedSupport: user.assignedSupport,
        assignedSupportName: user.assignedSupportName,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    إلغاء استلام المحادثة / إتاحتها لباقي الموظفين
// @route   POST /api/messages/support/release
router.post('/support/release', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'يجب تحديد المستخدم' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    user.assignedSupport = null;
    user.assignedSupportName = null;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'تم إتاحة المحادثة لجميع موظفي الدعم بنجاح',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
