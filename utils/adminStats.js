// تجميع إحصائيات ومالية لوحة الإدارة داخل قاعدة البيانات بدل تحميل كل الطلبات للذاكرة.
//
// السبب الفعلي لبطء هذه الصفحات (قياس على السيرفر: المالية ~19 ثانية بالتطبيق، وكل نقطة
// 4.5-8 ثوانٍ): كل استعلام بالقاعدة يكلّف ~1 ثانية رحلة شبكة، وهذه الدوال كانت تنفّذ
// 6-14 استعلاماً بالتتابع. الآن: استعلامات تجميع قليلة تُنفَّذ بالتوازي (Promise.all)،
// والحساب النهائي بدوال نقية هنا حتى يمكن اختبارها بدون قاعدة بيانات.

const STATUS_LIST = [
  'awaiting_verification', 'pending', 'preparing', 'ready',
  'accepted', 'picking_up', 'delivering', 'completed', 'cancelled',
];

const idKey = (v) => (v == null ? null : v.toString());

// ================= /api/orders/dashboard/stats =================

// مفتاح اليوم كما كان يُبنى سابقاً: تاريخ UTC (YYYY-MM-DD)
const dayKey = (d) => d.toISOString().slice(0, 10);

function dashboardWindow(now = new Date()) {
  const keys = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    keys.push(dayKey(d));
  }
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  return { keys, windowStart: new Date(`${keys[0]}T00:00:00.000Z`), startOfToday };
}

function dashboardPipelines({ windowStart, startOfToday }) {
  return {
    // عدد الطلبات لكل حالة (يغطي الإجمالي والمعلّق والنشط والمكتمل والملغى)
    byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
    // مجاميع الطلبات المكتملة
    completedTotals: [
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$priceDetails.totalPrice' },
          totalItemsPrice: { $sum: '$priceDetails.itemsPrice' },
          totalDeliveryFees: { $sum: '$priceDetails.deliveryFee' },
        },
      },
    ],
    // مبيعات آخر 14 يوم مجمّعة بتاريخ UTC ($dateToString بدون timezone يستعمل UTC افتراضياً)
    dailySales: [
      { $match: { status: 'completed', createdAt: { $gte: windowStart } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$priceDetails.totalPrice' },
          orderCount: { $sum: 1 },
        },
      },
    ],
    // كل طلبات اليوم بحسب الحالة
    today: [
      { $match: { createdAt: { $gte: startOfToday } } },
      { $group: { _id: '$status', count: { $sum: 1 }, revenue: { $sum: '$priceDetails.totalPrice' } } },
    ],
  };
}

// سائقين: إجمالي والمتصلين الآن (فعّال + متاح)
const driversCountPipeline = [
  { $match: { role: 'driver' } },
  {
    $group: {
      _id: null,
      total: { $sum: 1 },
      online: {
        $sum: {
          $cond: [{ $and: [{ $eq: ['$isActive', true] }, { $eq: ['$driverDetails.isAvailable', true] }] }, 1, 0],
        },
      },
    },
  },
];

function buildDashboardStats({ statusRows, totalsRow, dailyRows, todayRows, driversRow, keys }) {
  const statusBreakdown = {};
  STATUS_LIST.forEach((s) => { statusBreakdown[s] = 0; });
  let total = 0;
  statusRows.forEach((row) => {
    total += row.count;
    if (row._id in statusBreakdown) statusBreakdown[row._id] = row.count;
  });
  const statusCount = (s) => statusBreakdown[s] || 0;

  const totals = totalsRow || {};
  const totalRevenue = totals.totalRevenue || 0;
  const totalItemsPrice = totals.totalItemsPrice || 0;
  const totalDeliveryFees = totals.totalDeliveryFees || 0;

  const dailySalesMap = {};
  keys.forEach((key) => { dailySalesMap[key] = { date: key, revenue: 0, orderCount: 0 }; });
  dailyRows.forEach((row) => {
    if (dailySalesMap[row._id]) {
      dailySalesMap[row._id].revenue += row.revenue || 0;
      dailySalesMap[row._id].orderCount += row.orderCount || 0;
    }
  });

  let todayOrdersCount = 0;
  let todayCompletedCount = 0;
  let todayCancelledCount = 0;
  let todayRevenue = 0;
  todayRows.forEach((row) => {
    todayOrdersCount += row.count;
    if (row._id === 'completed') {
      todayCompletedCount += row.count;
      todayRevenue += row.revenue || 0;
    }
    if (row._id === 'cancelled') todayCancelledCount += row.count;
  });

  const drivers = driversRow || {};

  return {
    counts: {
      total,
      pending: statusCount('pending'),
      active: statusCount('accepted') + statusCount('picking_up') + statusCount('delivering'),
      completed: statusCount('completed'),
      cancelled: statusCount('cancelled'),
    },
    statusBreakdown,
    today: {
      ordersCount: todayOrdersCount,
      completedCount: todayCompletedCount,
      cancelledCount: todayCancelledCount,
      revenue: todayRevenue,
    },
    drivers: {
      online: drivers.online || 0,
      total: drivers.total || 0,
    },
    financials: {
      totalRevenue,
      totalItemsPrice,
      totalDeliveryFees,
      driverEarnings: totalDeliveryFees * 0.8,
      appCommission: totalDeliveryFees * 0.2,
    },
    dailySales: Object.values(dailySalesMap),
  };
}

// ================= /api/admin/stats =================

const usersByRolePipeline = [{ $group: { _id: '$role', count: { $sum: 1 } } }];

// الطلبات المكتملة مجمّعة بالمحل (لحساب عمولة كل محل بنسبته الخاصة)
const completedByShopPipeline = [
  { $match: { status: 'completed' } },
  {
    $group: {
      _id: '$shop',
      orders: { $sum: 1 },
      deliveryFees: { $sum: '$priceDetails.deliveryFee' },
      itemsPrice: { $sum: '$priceDetails.itemsPrice' },
    },
  },
];

function buildAdminStats({ roleRows, shopRows, shops }) {
  let totalUsers = 0;
  const byRole = {};
  roleRows.forEach((r) => {
    totalUsers += r.count;
    byRole[r._id] = r.count;
  });

  const commissionByShop = {};
  shops.forEach((s) => { commissionByShop[idKey(s._id)] = s.appCommissionPercent || 0; });

  // ربح المنصة = 20% من أجور التوصيل + عمولة اختيارية من مواد كل محل (appCommissionPercent)
  let totalRevenue = 0;
  let totalOrders = 0;
  shopRows.forEach((row) => {
    totalOrders += row.orders;
    totalRevenue += (row.deliveryFees || 0) * 0.2;
    const shopId = idKey(row._id);
    const percent = shopId ? commissionByShop[shopId] || 0 : 0;
    totalRevenue += (row.itemsPrice || 0) * (percent / 100);
  });

  return {
    totalUsers,
    totalCustomers: byRole.customer || 0,
    totalDrivers: byRole.driver || 0,
    totalSupport: byRole.support || 0,
    totalOrders,
    totalRevenue: Math.round(totalRevenue),
  };
}

// ================= /api/admin/financials/shops =================

const shopSalesPipeline = [
  { $match: { status: 'completed', shop: { $ne: null } } },
  { $group: { _id: '$shop', totalSales: { $sum: '$priceDetails.itemsPrice' }, totalOrders: { $sum: 1 } } },
];

const shopPayoutsPipeline = [
  { $match: { status: 'confirmed', shop: { $ne: null } } },
  { $group: { _id: '$shop', totalPaid: { $sum: '$amount' } } },
];

function buildShopFinancials({ shops, salesRows, payoutRows }) {
  const stats = {};
  shops.forEach((s) => {
    stats[idKey(s._id)] = {
      _id: s._id,
      name: s.name,
      totalSales: 0,
      totalOrders: 0,
      commissionPercent: s.appCommissionPercent || 0,
      commission: 0,
      totalPaid: 0,
      unpaidBalance: 0,
    };
  });
  salesRows.forEach((row) => {
    const s = stats[idKey(row._id)];
    if (s) {
      s.totalSales += row.totalSales || 0;
      s.totalOrders += row.totalOrders;
    }
  });
  payoutRows.forEach((row) => {
    const s = stats[idKey(row._id)];
    if (s) s.totalPaid += row.totalPaid || 0;
  });
  Object.keys(stats).forEach((id) => {
    const s = stats[id];
    s.commission = Math.round(s.totalSales * (s.commissionPercent / 100));
    s.unpaidBalance = Math.round(s.totalSales - s.commission - s.totalPaid);
  });
  return Object.values(stats);
}

// ================= /api/admin/financials/drivers =================

// طلبات مكتملة لم تُسوَّ مع السائق، مجمّعة بالسائق وطريقة الدفع (كاش/غيره)
const driverOrdersPipeline = [
  { $match: { status: 'completed', isSettledDriver: { $ne: true }, driver: { $ne: null } } },
  {
    $group: {
      _id: { driver: '$driver', cash: { $eq: ['$paymentMethod', 'cash'] } },
      orders: { $sum: 1 },
      deliveryFees: { $sum: '$priceDetails.deliveryFee' },
      totalPrice: { $sum: '$priceDetails.totalPrice' },
    },
  },
];

function buildDriverFinancials({ drivers, rows }) {
  const stats = {};
  drivers.forEach((d) => {
    stats[idKey(d._id)] = {
      _id: d._id,
      name: d.name,
      phone: d.phone,
      totalOrders: 0,
      totalDeliveryFees: 0,
      driverEarnings: 0,
      cashCollected: 0,
      netBalance: 0,
    };
  });
  rows.forEach((row) => {
    const s = stats[idKey(row._id.driver)];
    if (!s) return;
    const fees = row.deliveryFees || 0;
    const earnings = fees * 0.8;
    s.totalOrders += row.orders;
    s.totalDeliveryFees += fees;
    s.driverEarnings += earnings;
    if (row._id.cash) {
      s.cashCollected += row.totalPrice || 0;
      // الإدارة تطلب من السائق الكلي مطروحاً منه مستحقاته (80% من أجر التوصيل)
      s.netBalance -= (row.totalPrice || 0) - earnings;
    } else {
      // كارت/محفظة: السائق يطلب مستحقاته من الإدارة
      s.netBalance += earnings;
    }
  });
  return Object.values(stats);
}

module.exports = {
  STATUS_LIST,
  dashboardWindow,
  dashboardPipelines,
  driversCountPipeline,
  buildDashboardStats,
  usersByRolePipeline,
  completedByShopPipeline,
  buildAdminStats,
  shopSalesPipeline,
  shopPayoutsPipeline,
  buildShopFinancials,
  driverOrdersPipeline,
  buildDriverFinancials,
};
