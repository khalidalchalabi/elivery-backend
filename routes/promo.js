const express = require('express');
const router = express.Router();
const PromoCode = require('../models/PromoCode');

// @desc    التحقق من كود الخصم وتطبيقه
// @route   POST /api/promo/apply
router.post('/apply', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, message: 'الرجاء إدخال كود الخصم' });
    }

    const promo = await PromoCode.findOne({ code: code.trim().toUpperCase() });
    
    if (!promo) {
      return res.status(404).json({ success: false, message: 'كود الخصم غير موجود' });
    }

    if (!promo.isActive) {
      return res.status(400).json({ success: false, message: 'كود الخصم غير مفعل' });
    }

    if (new Date() > new Date(promo.expirationDate)) {
      return res.status(400).json({ success: false, message: 'كود الخصم منتهي الصلاحية' });
    }

    res.status(200).json({
      success: true,
      data: {
        code: promo.code,
        discountPercentage: promo.discountPercentage
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
