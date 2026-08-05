const mongoose = require('mongoose');

const PromoCodeSchema = new mongoose.Schema({
  code: { 
    type: String, 
    required: true, 
    unique: true, 
    uppercase: true, 
    trim: true 
  },
  discountPercentage: { 
    type: Number, 
    default: 0,
    min: 0,
    max: 100
  },
  isFreeDelivery: {
    type: Boolean,
    default: false
  },
  expirationDate: { 
    type: Date, 
    required: true 
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  minOrderAmount: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

module.exports = mongoose.model('PromoCode', PromoCodeSchema);
