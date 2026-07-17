const mongoose = require('mongoose');

const CategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'الرجاء إدخال اسم القسم الفريد برمجياً'],
    unique: true,
    trim: true,
  },
  displayName: {
    type: String,
    required: [true, 'الرجاء إدخال اسم القسم الذي يظهر للزبون'],
    trim: true,
  },
  emoji: {
    type: String,
    default: '📦',
  },
  tag: {
    type: String,
    default: '',
  },
  backgroundColor: {
    type: String,
    default: '#FFFFFF',
  },
  backgroundImage: {
    type: String, // يحفظ رابط الصورة الخلفية أو كود Base64 للقسم
    default: '',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  order: {
    type: Number,
    default: 0,
  }
}, { timestamps: true });

module.exports = mongoose.model('Category', CategorySchema);
