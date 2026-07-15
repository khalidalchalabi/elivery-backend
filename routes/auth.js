const express = require('express');
const router = express.Router();
const User = require('../models/User');

// @desc    إنشاء حساب زبون جديد برقم الهاتف وكلمة المرور
// @route   POST /api/auth/customer/register
router.post('/customer/register', async (req, res) => {
  try {
    const { name, phone, password } = req.body;

    if (!name || !phone || !password) {
      return res.status(400).json({ success: false, message: 'الرجاء إدخال الاسم، رقم الهاتف وكلمة المرور' });
    }

    let userExists = await User.findOne({ phone });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'رقم الهاتف مسجل بالفعل' });
    }

    const user = new User({
      name,
      phone,
      password,
      role: 'customer',
      email: `customer_${phone}_${Date.now()}@local.com` // بريد وهمي لتفادي مشكلة تكرار الإيميل الفارغ في قاعدة البيانات
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: 'تم إنشاء الحساب بنجاح',
      data: user,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تسجيل دخول الزبون برقم الهاتف وكلمة المرور
// @route   POST /api/auth/customer/login
router.post('/customer/login', async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ success: false, message: 'الرجاء إدخال رقم الهاتف وكلمة المرور' });
    }

    const user = await User.findOne({ phone, role: 'customer' });
    if (!user) {
      return res.status(404).json({ success: false, message: 'رقم الهاتف غير مسجل كزبون' });
    }

    if (user.password !== password) {
      return res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'تم إيقاف هذا الحساب' });
    }

    res.status(200).json({
      success: true,
      message: 'تم تسجيل الدخول بنجاح',
      data: user,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    إنشاء مستخدم جديد (زبون، سائق، مسؤول)
// @route   POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone, role, driverDetails, shopId } = req.body;

    // التحقق من وجود البريد الإلكتروني مسبقاً
    let userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'البريد الإلكتروني مسجل بالفعل' });
    }

    // إنشاء مستخدم جديد
    const user = new User({
      name,
      email,
      password, // ملاحظة: في بيئة الإنتاج يجب تشفير كلمة المرور قبل الحفظ
      phone,
      role,
      driverDetails: role === 'driver' ? driverDetails : undefined,
      shop: role === 'merchant' ? shopId : undefined,
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: 'تم تسجيل المستخدم بنجاح',
      data: user,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تسجيل الدخول
// @route   POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // البحث عن المستخدم بالبريد الإلكتروني أو برقم الهاتف
    const user = await User.findOne({
      $or: [{ email: email }, { phone: email }]
    });
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    // التحقق من كلمة المرور
    if (user.password !== password) {
      return res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'تم إيقاف هذا الحساب' });
    }

    res.status(200).json({
      success: true,
      message: 'تم تسجيل الدخول بنجاح',
      data: user,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تحديث موقع السائق اللحظي وتوافره
// @route   PUT /api/auth/driver/location/:id
router.put('/driver/location/:id', async (req, res) => {
  try {
    const { latitude, longitude, isAvailable } = req.body;

    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'driver') {
      return res.status(404).json({ success: false, message: 'السائق غير موجود' });
    }

    // تحديث الموقع الجغرافي والتوفر
    if (longitude && latitude) {
      user.driverDetails.currentLocation = {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)], // [Longitude, Latitude]
      };
    }

    if (typeof isAvailable !== 'undefined') {
      user.driverDetails.isAvailable = isAvailable;
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: 'تم تحديث موقع السائق بنجاح',
      data: user,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب جميع السائقين
// @route   GET /api/auth/drivers
router.get('/drivers', async (req, res) => {
  try {
    const drivers = await User.find({ role: 'driver' }).select('-password');
    res.json({ success: true, data: drivers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب جميع السائقين المتاحين والقريبين من إحداثيات معينة
// @route   GET /api/auth/drivers/nearby
router.get('/drivers/nearby', async (req, res) => {
  try {
    const { longitude, latitude, maxDistance = 5000 } = req.query; // المسافة الافتراضية 5 كم

    if (!longitude || !latitude) {
      return res.status(400).json({ success: false, message: 'الرجاء تحديد خط الطول والعرض' });
    }

    // استعلام للمطالبة بجميع السائقين المتاحين في محيط مسافة معينة
    const nearbyDrivers = await User.find({
      role: 'driver',
      'driverDetails.isAvailable': true,
      'driverDetails.currentLocation': {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(longitude), parseFloat(latitude)],
          },
          $maxDistance: parseInt(maxDistance), // بالامتار
        },
      },
    });

    res.status(200).json({
      success: true,
      count: nearbyDrivers.length,
      data: nearbyDrivers,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    إضافة موظف أو سائق جديد (خاص بالمسؤول)
// @route   POST /api/auth/employee
router.post('/employee', async (req, res) => {
  try {
    const { name, email, password, phone, role, driverDetails, shopId } = req.body;

    const allowedRoles = ['driver', 'admin', 'owner', 'accountant', 'merchant', 'support'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ success: false, message: 'دور الموظف غير صالح. يجب أن يكون سائق، مسؤول، مالك، محاسب، موظف دعم أو صاحب متجر' });
    }

    let userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'هذا البريد الإلكتروني مسجل بالفعل' });
    }

    const user = new User({
      name,
      email,
      password,
      phone,
      role,
      driverDetails: role === 'driver' ? {
        vehicleType: driverDetails?.vehicleType || 'motorcycle',
        plateNumber: driverDetails?.plateNumber || '',
        isAvailable: true,
        currentLocation: { type: 'Point', coordinates: [0, 0] }
      } : undefined,
      shop: role === 'merchant' ? shopId : undefined,
    });

    await user.save();
    res.status(201).json({ success: true, message: 'تم إضافة الموظف/السائق بنجاح', data: user });
  } catch (error) {
    console.error('Error creating employee:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    حذف/إيقاف حساب موظف أو سائق (خاص بالمسؤول)
// @route   DELETE /api/auth/employee/:id
router.delete('/employee/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.role === 'customer') {
      return res.status(404).json({ success: false, message: 'الموظف غير موجود' });
    }

    await user.deleteOne();
    res.status(200).json({ success: true, message: 'تم حذف الموظف بنجاح' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب قائمة بكافة الموظفين والسائقين (خاص بالمسؤول)
// @route   GET /api/auth/employees
router.get('/employees', async (req, res) => {
  try {
    const employees = await User.find({ role: { $in: ['driver', 'admin', 'owner', 'accountant', 'merchant', 'support'] } }).populate('shop', 'name').sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: employees.length, data: employees });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تسجيل الدخول / التسجيل عبر Google
// @route   POST /api/auth/google
router.post('/google', async (req, res) => {
  try {
    const { googleId, name, email, phone } = req.body;

    if (!googleId || !email) {
      return res.status(400).json({ success: false, message: 'معلومات Google غير كاملة' });
    }

    let user = await User.findOne({ $or: [{ googleId }, { email }] });

    if (user) {
      if (!user.googleId) {
        user.googleId = googleId;
        await user.save();
      }
      return res.status(200).json({
        success: true,
        message: 'تم تسجيل الدخول عبر Google بنجاح',
        data: user,
      });
    }

    // إنشاء مستخدم جديد
    user = new User({
      name: name || 'زبون Google',
      email,
      phone: phone || `g-${googleId.substring(0, 8)}`, // رقم هاتف افتراضي إن لم يتوفر
      googleId,
      role: 'customer',
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: 'تم إنشاء حساب زبون جديد عبر Google بنجاح',
      data: user,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تسجيل الدخول / التسجيل عبر Apple ID
// @route   POST /api/auth/apple
router.post('/apple', async (req, res) => {
  try {
    const { appleId, name, email, phone } = req.body;

    if (!appleId || !email) {
      return res.status(400).json({ success: false, message: 'معلومات Apple ID غير كاملة' });
    }

    let user = await User.findOne({ $or: [{ appleId }, { email }] });

    if (user) {
      if (!user.appleId) {
        user.appleId = appleId;
        await user.save();
      }
      return res.status(200).json({
        success: true,
        message: 'تم تسجيل الدخول عبر Apple ID بنجاح',
        data: user,
      });
    }

    // إنشاء مستخدم جديد
    user = new User({
      name: name || 'زبون Apple',
      email,
      phone: phone || `a-${appleId.substring(0, 8)}`,
      appleId,
      role: 'customer',
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: 'تم إنشاء حساب زبون جديد عبر Apple ID بنجاح',
      data: user,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب قائمة العناوين المحفوظة للمستخدم
// @route   GET /api/auth/users/:id/addresses
router.get('/users/:id/addresses', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    res.status(200).json({
      success: true,
      data: user.savedAddresses || [],
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    إضافة عنوان جديد لقائمة العناوين المحفوظة
// @route   POST /api/auth/users/:id/addresses
router.post('/users/:id/addresses', async (req, res) => {
  try {
    const { label, address, latitude, longitude, region } = req.body;

    if (!label || !address || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, message: 'بيانات العنوان غير كاملة' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    user.savedAddresses.push({ 
      label, 
      address, 
      latitude, 
      longitude,
      region: region || 'inside_khalis'
    });
    await user.save();

    res.status(200).json({
      success: true,
      message: 'تم حفظ العنوان بنجاح',
      data: user.savedAddresses,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    حذف عنوان محفوظ
// @route   DELETE /api/auth/users/:id/addresses/:addressId
router.delete('/users/:id/addresses/:addressId', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    user.savedAddresses = user.savedAddresses.filter(
      (addr) => addr._id.toString() !== req.params.addressId
    );
    await user.save();

    res.status(200).json({
      success: true,
      message: 'تم حذف العنوان بنجاح',
      data: user.savedAddresses,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تغيير كلمة المرور للمستخدم
// @route   PUT /api/auth/users/:id/change-password
router.put('/users/:id/change-password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const { id } = req.params;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'الرجاء إدخال كلمة المرور الحالية والجديدة' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    if (user.password !== currentPassword) {
      return res.status(400).json({ success: false, message: 'كلمة المرور الحالية غير صحيحة' });
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'تم تغيير كلمة المرور بنجاح',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تحديث الملف الشخصي للمستخدم
// @route   PUT /api/auth/users/:id/update-profile
router.put('/users/:id/update-profile', async (req, res) => {
  try {
    const { name, phone } = req.body;
    const { id } = req.params;

    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'الرجاء إدخال الاسم ورقم الهاتف' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    // التحقق من عدم تكرار رقم الهاتف
    const existingUser = await User.findOne({ phone, _id: { $ne: id }, role: 'customer' });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'رقم الهاتف هذا مسجل بالفعل لمستخدم آخر' });
    }

    user.name = name;
    user.phone = phone;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'تم تحديث الملف الشخصي بنجاح',
      data: user,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    طلب استعادة كلمة المرور
// @route   POST /api/auth/customer/forgot-password
router.post('/customer/forgot-password', async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ success: false, message: 'الرجاء إدخال رقم الهاتف' });
    }

    const user = await User.findOne({ phone, role: 'customer' });
    if (!user) {
      return res.status(404).json({ success: false, message: 'رقم الهاتف هذا غير مسجل لدينا' });
    }

    // توليد كود من 4 أرقام
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    
    user.otpCode = otp;
    user.otpExpires = Date.now() + 10 * 60 * 1000; // صالح لمدة 10 دقائق
    await user.save();

    // في البيئة الحقيقية نقوم بإرسال SMS هنا
    // حالياً سنعيد الكود في الاستجابة للتجربة فقط
    res.status(200).json({
      success: true,
      message: 'تم إرسال كود الاستعادة بنجاح',
      data: { otp }, // للعرض في واجهة التطبيق حالياً لغياب الـ SMS
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    التحقق من الكود وتغيير كلمة المرور
// @route   POST /api/auth/customer/reset-password
router.post('/customer/reset-password', async (req, res) => {
  try {
    const { phone, otp, newPassword } = req.body;

    if (!phone || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: 'الرجاء إدخال الهاتف والكود وكلمة المرور الجديدة' });
    }

    const user = await User.findOne({ phone, role: 'customer' });
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    if (user.otpCode !== otp) {
      return res.status(400).json({ success: false, message: 'كود التحقق غير صحيح' });
    }

    if (user.otpExpires < Date.now()) {
      return res.status(400).json({ success: false, message: 'انتهت صلاحية الكود، الرجاء طلب كود جديد' });
    }

    // تغيير كلمة المرور وتصفير الكود
    user.password = newPassword;
    user.otpCode = null;
    user.otpExpires = null;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'تم تغيير كلمة المرور بنجاح، يمكنك الآن تسجيل الدخول',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تحديث صورة الملف الشخصي للمستخدم
// @route   PUT /api/auth/profile-picture
router.put('/profile-picture', async (req, res) => {
  try {
    const { userId, base64Image } = req.body;

    if (!userId || !base64Image) {
      return res.status(400).json({ success: false, message: 'الرجاء توفير معرف المستخدم والصورة' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    const fs = require('fs');
    const path = require('path');
    let imageUrl = base64Image;

    // حفظ الصورة مباشرة في قاعدة البيانات لأن Vercel لا يدعم رفع الملفات محلياً
    if (base64Image.startsWith('data:image/')) {
      imageUrl = base64Image;
    }

    user.profilePicture = imageUrl;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'تم تحديث صورة الملف الشخصي بنجاح',
      data: {
        profilePicture: imageUrl
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
