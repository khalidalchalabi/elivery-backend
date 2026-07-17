const mongoose = require('mongoose');

const PayoutSchema = new mongoose.Schema(
  {
    shop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      required: [true, 'يجب تحديد المحل المستلم للدفعة'],
    },
    amount: {
      type: Number,
      required: [true, 'يجب تحديد مبلغ الدفعة'],
      min: [1, 'يجب أن يكون المبلغ أكبر من 0'],
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    paidAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Payout', PayoutSchema);
