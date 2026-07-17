const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const User = require('../models/User');

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
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب محادثة مستخدم معين
// @route   GET /api/messages/:driverId
router.get('/:driverId', async (req, res) => {
  try {
    const { driverId } = req.params;

    const messages = await Message.find({ driver: driverId }).sort({ createdAt: 1 });

    await Message.updateMany(
      { driver: driverId, isRead: false },
      { $set: { isRead: true } }
    );

    res.status(200).json({
      success: true,
      count: messages.length,
      data: messages,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب المحادثات النشطة (لموظفي الدعم)
// @route   GET /api/messages/support/conversations
router.get('/support/conversations', async (req, res) => {
  try {
    // جلب أحدث رسالة لكل مستخدم
    const conversations = await Message.aggregate([
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$driver',
          lastMessage: { $first: '$$ROOT' },
        },
      },
    ]);

    // جلب معلومات المستخدمين للمحادثات (سائقين وزبائن)
    const driverIds = conversations.map((conv) => conv._id);
    const drivers = await User.find({ _id: { $in: driverIds } }, 'name phone profilePicture role');

    const result = conversations.map((conv) => {
      const driverInfo = drivers.find((d) => d._id.toString() === conv._id.toString());
      return {
        driver: driverInfo,
        lastMessage: conv.lastMessage,
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

module.exports = router;
