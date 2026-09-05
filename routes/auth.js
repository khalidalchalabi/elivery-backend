const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const PromoCode = require('../models/PromoCode');
const { getDefaultRegionId } = require('../utils/regionHelper');

// يتحقق من كلمة المرور بما يتوافق مع الحسابات القديمة غير المشفّرة (قبل
// إضافة bcrypt) — لو كانت مشفّرة يقارنها بالطريقة الآمنة، ولو نص صريح
// يقارنها مباشرة ويشفّرها فوراً عند التطابق (ترقية تدريجية دون تجميد أي حساب)
async function verifyPassword(user, plainPassword) {
  if (!user.password || !plainPassword) return false;
  if (user.password.startsWith('$2')) {
    return bcrypt.compare(plainPassword, user.password);
  }
  const matches = user.password === plainPassword;
  if (matches) {
    // نشفّرها هنا مباشرة (بدل الاعتماد على isModified بالـ pre-save hook)
    // لأن إسناد نفس القيمة الصريحة اللي كانت موجودة أصلاً قد لا يُعتبر
    // "تعديلاً" بنظر Mongoose، فتضل كلمة المرور غير مشفّرة رغم نجاح الحفظ
    user.password = await bcrypt.hash(plainPassword, 10);
    await user.save();
  }
  return matches;
}

async function logSecurityEvent(userId, username, role, action, details, req) {
  try {
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';
    await AuditLog.create({
      userId,
      username,
      role,
      action,
      details,
      ipAddress,
      userAgent,
    });
  } catch (e) {
    console.error('Error saving security audit log:', e);
  }
}

// @desc    إنشاء حساب زبون جديد برقم الهاتف وكلمة المرور
// @route   POST /api/auth/customer/register
router.post('/customer/register', async (req, res) => {
  try {
    const { name, phone, password } = req.body;

    if (!name || !phone || !password) {
      return res.status(400).json({ success: false, message: 'الرجاء إدخال الاسم، رقم الهاتف وكلمة المرور' });
    }

    // نتحقق من التكرار ضمن حسابات الزبائن فقط، لأن نفس رقم الهاتف قد
    // يكون مسجلاً أصلاً كحساب موظف (دعم/تاجر/إدارة...) بتطبيق الكادر،
    // وهذا مسموح به (حسابان منفصلان بدورين مختلفين لنفس الرقم)
    let userExists = await User.findOne({ phone, role: 'customer' });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'رقم الهاتف مسجل بالفعل كحساب زبون' });
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

    if (!(await verifyPassword(user, password))) {
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

// @desc    حذف حساب الزبون
// @route   DELETE /api/auth/customer/:id
router.delete('/customer/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let user = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      user = await User.findById(id);
    }
    if (!user) {
      return res.status(200).json({ success: true, message: 'تم حذف الحساب بنجاح' });
    }

    if (user.role !== 'customer') {
      return res.status(403).json({ success: false, message: 'هذا الحساب ليس حساب زبون' });
    }

    await user.deleteOne();

    res.status(200).json({ success: true, message: 'تم حذف الحساب بنجاح' });
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

    await logSecurityEvent(user._id, user.name || user.email, user.role, 'create_user', `تم تسجيل مستخدم جديد بالمنصة بنجاح بدور: ${role}`, req);

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
      await logSecurityEvent(null, email || 'guest', 'guest', 'login_failure', 'محاولة دخول فاشلة: البريد أو الهاتف غير مسجل في النظام', req);
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    // التحقق من كلمة المرور
    if (!(await verifyPassword(user, password))) {
      await logSecurityEvent(user._id, user.name || user.email, user.role, 'login_failure', 'محاولة دخول فاشلة: كلمة مرور غير مطابقة', req);
      return res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة' });
    }

    if (!user.isActive) {
      await logSecurityEvent(user._id, user.name || user.email, user.role, 'login_failure', 'محاولة دخول فاشلة: الحساب مجمد حالياً', req);
      return res.status(403).json({ success: false, message: 'تم إيقاف هذا الحساب' });
    }

    await logSecurityEvent(user._id, user.name || user.email, user.role, 'login_success', 'تسجيل دخول ناجح إلى تطبيق الكادر', req);

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
      // accountRevoked تخلي تطبيق الكادر يسجّل خروج السائق تلقائياً فوراً —
      // مهم خصوصاً لو الإدارة حذفت حسابه وهو مسجّل دخول أصلاً بجهازه
      return res.status(404).json({ success: false, message: 'السائق غير موجود', accountRevoked: true });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'تم إيقاف هذا الحساب من قبل الإدارة', accountRevoked: true });
    }

    // تحديث الموقع الجغرافي والتوفر
    if (!user.driverDetails) {
      user.driverDetails = {};
    }

    if (longitude && latitude) {
      user.driverDetails.currentLocation = {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)], // [Longitude, Latitude]
      };
    }

    user.driverDetails.lastActiveAt = new Date();

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

// @desc    جلب جميع السائقين وحساب حالة تفرغهم اللحظية بدقة (متاح / مشغول / أوفلاين)
// @route   GET /api/auth/drivers
router.get('/drivers', async (req, res) => {
  try {
    const Order = require('../models/Order');
    const drivers = await User.find({ role: 'driver' }).select('-password').populate('region', 'name').lean();
    
    // جلب الطلبات النشطة حالياً التي يعمل عليها كباتن التوصيل
    const activeOrders = await Order.find({ status: { $in: ['accepted', 'picking_up', 'delivering'] }, driver: { $ne: null } }).select('driver').lean();
    const busyDriverIds = new Set(activeOrders.map(o => o.driver.toString()));

    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);

    const calculatedDrivers = drivers.map(driver => {
      const driverIdStr = driver._id.toString();
      const details = driver.driverDetails || {};
      
      const isExplicitAvailable = details.isAvailable !== false;
      const isBusyWithOrder = busyDriverIds.has(driverIdStr);
      
      // التثبت من نشاط التطبيق (أن الموقع أو النشاط حدث خلال آخر 3 دقائق)
      const lastActive = details.lastActiveAt ? new Date(details.lastActiveAt) : (driver.updatedAt ? new Date(driver.updatedAt) : null);
      const isRecentlyActive = lastActive ? lastActive >= threeMinutesAgo : false;

      // السائق متاح فعلياً فقط إذا كان قد فعل التوفر + ليس لديه طلب نشط + التطبيق كان مفتوحاً ونشطاً
      const realIsAvailable = isExplicitAvailable && !isBusyWithOrder && isRecentlyActive;

      return {
        ...driver,
        driverDetails: {
          ...details,
          isAvailable: realIsAvailable,
          isBusy: isBusyWithOrder,
          isOffline: !isRecentlyActive,
        }
      };
    });

    res.json({ success: true, data: calculatedDrivers });
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
    const { name, email, password, phone, role, driverDetails, shopId, address, profilePicture, avatar, regionId } = req.body;

    const allowedRoles = ['driver', 'admin', 'owner', 'accountant', 'merchant', 'support'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ success: false, message: 'دور الموظف غير صالح. يجب أن يكون سائق، مسؤول، مالك، محاسب، موظف دعم أو صاحب متجر' });
    }

    const finalEmail = (email && email.trim()) ? email.trim() : `${role}_${phone}_${Date.now()}@local.com`;

    // الفحص يقارن رقم الهاتف بنفس دور الموظف الجديد فقط (مطابقةً للفهرس المركّب
    // phone+role بقاعدة البيانات) — حتى يصير مسموح لنفس الرقم يكون مسجّل
    // كزبون بتطبيق العميل ومنفصلاً كموظف بتطبيق الكادر بنفس الوقت
    let userExists = await User.findOne({
      $or: [{ phone, role }, { email: finalEmail }]
    });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'رقم الهاتف أو البريد الإلكتروني مسجل بالفعل بنفس هذا الدور الوظيفي' });
    }

    const driverAddr = address || driverDetails?.address || '';
    const driverAvatar = profilePicture || avatar || driverDetails?.avatar || null;

    const user = new User({
      name,
      email: finalEmail,
      password,
      phone,
      role,
      profilePicture: driverAvatar,
      driverDetails: role === 'driver' ? {
        vehicleType: driverDetails?.vehicleType || 'motorcycle',
        plateNumber: driverDetails?.plateNumber || '',
        address: driverAddr,
        avatar: driverAvatar,
        rating: 5.0,
        numReviews: 0,
        ratingSum: 0,
        isAvailable: true,
        currentLocation: { type: 'Point', coordinates: [0, 0] }
      } : undefined,
      shop: role === 'merchant' ? shopId : undefined,
      // منطقة عمل السائق: المرسلة من الإدارة، وإلا المنطقة الافتراضية —
      // حتى لا يبقى سائق بلا منطقة (يمنعه لاحقاً من قبول أي طلب إطلاقاً)
      region: role === 'driver' ? (regionId || await getDefaultRegionId()) : undefined,
    });

    await user.save();
    await logSecurityEvent(user._id, user.name || user.email, user.role, 'create_user', `تم إضافة موظف جديد بالمنصة باسم: ${user.name} ودور: ${user.role}`, req);
    res.status(201).json({ success: true, message: 'تم إضافة الموظف/السائق بنجاح', data: user });
  } catch (error) {
    console.error('Error creating employee:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تعديل بيانات وصلاحيات موظف أو سائق (خاص بالمسؤول)
// @route   PUT /api/auth/employee/:id
router.put('/employee/:id', async (req, res) => {
  try {
    const { name, email, phone, role, isActive, shopId, address, profilePicture, avatar, regionId } = req.body;
    const user = await User.findById(req.params.id);
    if (!user || user.role === 'customer') {
      return res.status(404).json({ success: false, message: 'الموظف غير موجود' });
    }

    if (name) user.name = name;
    if (email) user.email = email;
    if (phone) user.phone = phone;
    if (role) user.role = role;
    if (typeof isActive !== 'undefined') user.isActive = isActive;
    if (shopId) user.shop = shopId;
    if (regionId !== undefined) user.region = regionId || null;

    const driverAvatar = profilePicture || avatar;
    if (driverAvatar) {
      user.profilePicture = driverAvatar;
    }

    if (user.role === 'driver') {
      if (!user.driverDetails) user.driverDetails = {};
      if (address) user.driverDetails.address = address;
      if (driverAvatar) user.driverDetails.avatar = driverAvatar;
      // سائق بلا منطقة عمل ما يقدر يقبل أي طلب إطلاقاً — نسد الفجوة تلقائياً
      if (!user.region) user.region = await getDefaultRegionId();
    }

    await user.save();
    res.status(200).json({ success: true, message: 'تم تحديث بيانات الموظف بنجاح', data: user });

    const originalRole = user.role;
    const originalActive = user.isActive;

    if (name) user.name = name;
    if (email) user.email = email;
    if (phone) user.phone = phone;
    
    if (role) {
      const allowedRoles = ['driver', 'admin', 'owner', 'accountant', 'merchant', 'support'];
      if (!allowedRoles.includes(role)) {
        return res.status(400).json({ success: false, message: 'دور الموظف غير صالح' });
      }
      user.role = role;
      if (role === 'merchant') {
        user.shop = shopId || user.shop;
      } else {
        user.shop = undefined;
      }
      if (role === 'driver' && !user.driverDetails) {
        user.driverDetails = {
          vehicleType: 'motorcycle',
          plateNumber: '',
          isAvailable: true,
          currentLocation: { type: 'Point', coordinates: [0, 0] }
        };
      }
    }
    
    if (isActive !== undefined) {
      user.isActive = isActive;
    }

    await user.save();
    
    let changeDetails = `تم تحديث بيانات الموظف ${user.name}.`;
    if (role && role !== originalRole) changeDetails += ` تغيير الرتبة من ${originalRole} إلى ${role}.`;
    if (isActive !== undefined && isActive !== originalActive) changeDetails += ` تغيير حالة النشاط إلى: ${isActive}.`;
    
    await logSecurityEvent(user._id, user.name || user.email, user.role, 'update_user_role', changeDetails, req);

    res.status(200).json({ success: true, message: 'تم تحديث بيانات الموظف بنجاح', data: user });
  } catch (error) {
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

    await logSecurityEvent(user._id, user.name || user.email, user.role, 'delete_user', `تم حذف حساب الموظف: ${user.name} (الدور: ${user.role}) نهائياً من النظام`, req);
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
    const employees = await User.find({ role: { $in: ['driver', 'admin', 'owner', 'accountant', 'merchant', 'support'] } }).select('-password').populate('shop', 'name').populate('region', 'name').sort({ createdAt: -1 });
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

// @desc    مزامنة قائمة المحلات المفضلة مع السيرفر (لأجل إشعارات زيادة الخصم)
// @route   PUT /api/auth/users/:id/favorites
router.put('/users/:id/favorites', async (req, res) => {
  try {
    const { shopIds } = req.body;
    if (!Array.isArray(shopIds)) {
      return res.status(400).json({ success: false, message: 'يجب إرسال قائمة معرّفات المحلات' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { favoriteShops: shopIds },
      { new: true }
    );
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    res.status(200).json({ success: true, message: 'تمت مزامنة المفضلة بنجاح' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    تسجيل/تحديث رمز جهاز الإشعارات (FCM) الخاص بالمستخدم
// @route   PUT /api/auth/users/:id/fcm-token
router.put('/users/:id/fcm-token', async (req, res) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) {
      return res.status(400).json({ success: false, message: 'الرجاء إرسال رمز الجهاز' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { fcmToken },
      { new: true }
    );
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    res.status(200).json({ success: true, message: 'تم تسجيل رمز الجهاز بنجاح' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    جلب رصيد نقاط الولاء الحالي للمستخدم
// @route   GET /api/auth/users/:id/loyalty-points
router.get('/users/:id/loyalty-points', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    res.status(200).json({
      success: true,
      data: { loyaltyPoints: user.loyaltyPoints || 0 },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @desc    استبدال نقاط الولاء بكود خصم (كل 100 نقطة = 5% خصم، بحد أقصى 25%)
// @route   POST /api/auth/users/:id/redeem-points
router.post('/users/:id/redeem-points', async (req, res) => {
  try {
    const points = Number(req.body.points);

    if (!points || points < 100 || points % 100 !== 0) {
      return res.status(400).json({ success: false, message: 'عدد النقاط يجب أن يكون 100 أو مضاعفاتها' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    if ((user.loyaltyPoints || 0) < points) {
      return res.status(400).json({ success: false, message: 'رصيد النقاط غير كافٍ' });
    }

    const discountPercentage = Math.min((points / 100) * 5, 25);
    const code = `LOYAL-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const expirationDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // شهر واحد

    const promo = await PromoCode.create({
      code,
      discountPercentage,
      expirationDate,
      assignedTo: user._id,
    });

    user.loyaltyPoints -= points;
    await user.save();

    res.status(200).json({
      success: true,
      message: `تم استبدال ${points} نقطة بكود خصم ${discountPercentage}%`,
      data: {
        loyaltyPoints: user.loyaltyPoints,
        promoCode: promo,
      },
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

    if (!(await verifyPassword(user, currentPassword))) {
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

    let user = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      user = await User.findById(id);
    }
    if (!user && phone) {
      user = await User.findOne({ phone, role: 'customer' });
    }
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود، يرجى تسجيل الدخول بحسابك الحقيقي أولاً' });
    }

    // التحقق من عدم تكرار رقم الهاتف مع زبون آخر
    const existingUser = await User.findOne({ phone, _id: { $ne: user._id }, role: 'customer' });
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
