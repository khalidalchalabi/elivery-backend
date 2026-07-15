const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema(
  {
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'يجب تحديد السائق'],
    },
    senderRole: {
      type: String,
      enum: ['driver', 'support'],
      required: [true, 'يجب تحديد دور المرسل'],
    },
    text: {
      type: String,
      required: [true, 'لا يمكن إرسال رسالة فارغة'],
      trim: true,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Message', MessageSchema);
