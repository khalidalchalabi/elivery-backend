const express = require('express');
const router = express.Router();
const Category = require('../models/Category');

// @desc    جلب كافة التصنيفات الرئيسية الفعالة
// @route   GET /api/categories
router.get('/', async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true }).sort({ order: 1, createdAt: 1 });
    res.status(200).json({ success: true, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب كافة التصنيفات (بما فيها غير الفعالة للوحة التحكم)
// @route   GET /api/categories/all
router.get('/all', async (req, res) => {
  try {
    const categories = await Category.find().sort({ order: 1, createdAt: 1 });
    res.status(200).json({ success: true, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    إضافة تصنيف رئيسي جديد
// @route   POST /api/categories
router.post('/', async (req, res) => {
  try {
    const { name, displayName, emoji, tag, backgroundColor, backgroundImage, order } = req.body;

    let exists = await Category.findOne({ name });
    if (exists) {
      return res.status(400).json({ success: false, message: 'هذا التصنيف مسجل بالفعل' });
    }

    const category = new Category({
      name,
      displayName,
      emoji,
      tag,
      backgroundColor,
      backgroundImage,
      order: order ? parseInt(order) : 0
    });

    await category.save();
    res.status(201).json({ success: true, message: 'تم إضافة التصنيف بنجاح', data: category });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تعديل تصنيف رئيسي
// @route   PUT /api/categories/:id
router.put('/:id', async (req, res) => {
  try {
    const { name, displayName, emoji, tag, backgroundColor, backgroundImage, order, isActive } = req.body;
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'التصنيف غير موجود' });
    }

    if (name) category.name = name;
    if (displayName) category.displayName = displayName;
    if (emoji) category.emoji = emoji;
    if (tag !== undefined) category.tag = tag;
    if (backgroundColor) category.backgroundColor = backgroundColor;
    if (backgroundImage !== undefined) category.backgroundImage = backgroundImage;
    if (order !== undefined) category.order = parseInt(order);
    if (isActive !== undefined) category.isActive = isActive;

    await category.save();
    res.status(200).json({ success: true, message: 'تم تحديث بيانات التصنيف بنجاح', data: category });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    حذف تصنيف رئيسي
// @route   DELETE /api/categories/:id
router.delete('/:id', async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'التصنيف غير موجود' });
    }

    await category.deleteOne();
    res.status(200).json({ success: true, message: 'تم حذف التصنيف بنجاح' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
