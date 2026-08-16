const mongoose = require('mongoose');

const ComplaintSchema = new mongoose.Schema({
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // الجهة المتعلقة بالشكوى (اختياري، تسمح بربطها بسائق أو محل معين لأغراض الإحصائيات)
  targetDriver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  targetShop: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shop',
    default: null,
  },
  category: {
    type: String,
    enum: ['late_delivery', 'wrong_item', 'damaged_item', 'missing_item', 'rude_behavior', 'quality_issue', 'other'],
    required: true,
  },
  description: {
    type: String,
    required: true,
    trim: true,
  },
  status: {
    type: String,
    enum: ['open', 'in_review', 'resolved', 'rejected'],
    default: 'open',
  },
  // ملاحظة توثيقية فقط لما يتم اتخاذه (لا يوجد إجراء تلقائي، الدعم يوثق يدوياً)
  resolutionNote: {
    type: String,
    trim: true,
    default: '',
  },
  handledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  resolvedAt: {
    type: Date,
    default: null,
  },
}, { timestamps: true });

module.exports = mongoose.model('Complaint', ComplaintSchema);
