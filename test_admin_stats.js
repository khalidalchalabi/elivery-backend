// اختبار مكافئة: النتيجة الجديدة (تجميع بالقاعدة) = نتيجة الحساب القديم (تحميل كل الطلبات
// للذاكرة) على نفس البيانات العشوائية. خطوط التجميع تُشغَّل بمحاكي MongoDB بالذاكرة (mingo).
// mingo مو من حزم المشروع: شغّله هكذا (مثال):
//   NODE_PATH=/path/to/node_modules node test_admin_stats.js
// ولو mingo غير موجود يتخطى اختبارات خطوط التجميع وينفّذ فقط اختبارات الدوال النقية.
const assert = require('assert');
const A = require('./utils/adminStats');

let mingo = null;
try {
  mingo = require('mingo');
  require('mingo/init/system'); // تحميل كل عوامل التجميع ($group, $match, ...)
} catch (_) {
  mingo = null;
  console.log('تنبيه: mingo غير مثبت، سيتم تخطي اختبارات خطوط التجميع');
}

// ---------- مولّد بيانات عشوائية ثابت (seeded) ----------
let seed = 12345;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const oid = (n) => ({ toString: () => `oid${n}`, n });
const shops = [
  { _id: oid(1), name: 'محل 1', appCommissionPercent: 0 },
  { _id: oid(2), name: 'محل 2', appCommissionPercent: 10 },
  { _id: oid(3), name: 'محل 3', appCommissionPercent: 2.5 },
  { _id: oid(4), name: 'محل 4' }, // بدون نسبة
];
const drivers = [
  { _id: oid(11), name: 'سائق 1', phone: '0771' },
  { _id: oid(12), name: 'سائق 2', phone: '0772' },
  { _id: oid(13), name: 'سائق 3', phone: '0773' },
];
const STATUSES = ['awaiting_verification', 'pending', 'preparing', 'ready', 'accepted', 'picking_up', 'delivering', 'completed', 'completed', 'completed', 'cancelled'];
const now = new Date('2026-10-15T10:30:00.000Z');

function makeOrders(n) {
  const orders = [];
  for (let i = 0; i < n; i++) {
    const itemsPrice = int(1, 40) * 500;
    const deliveryFee = pick([0, 1000, 1500, 2000, 2500]);
    const createdAt = new Date(now.getTime() - int(0, 20 * 24 * 3600 * 1000));
    const o = {
      status: pick(STATUSES),
      shop: pick([null, ...shops.map((s) => s._id), oid(99)]), // oid99: محل محذوف
      driver: pick([null, oid(11), oid(12), oid(13), oid(88)]), // oid88: سائق غير موجود
      paymentMethod: pick(['cash', 'cash', 'card', 'wallet']),
      isSettledDriver: pick([false, false, true, undefined]),
      createdAt,
      priceDetails: { itemsPrice, deliveryFee, totalPrice: itemsPrice + deliveryFee },
    };
    if (rnd() < 0.05) delete o.priceDetails; // طلب بدون تفاصيل سعر
    orders.push(o);
  }
  return orders;
}

// mingo يقارن ObjectId كقيم؛ نستعمل مفاتيح نصية متطابقة بالمقارنة (toString) عبر تحويل _id لنص قبل التجميع
function toPlain(orders) {
  return orders.map((o) => ({
    ...o,
    shop: o.shop ? o.shop.toString() : null,
    driver: o.driver ? o.driver.toString() : null,
  }));
}
// النتائج ترجع المعرفات كنص؛ نعيدها لكائنات oid ليستعملها الحساب النهائي
const rehydrate = (rows, fields) =>
  rows.map((r) => {
    const out = { ...r };
    fields.forEach((f) => {
      const parts = f.split('.');
      let obj = out;
      for (let i = 0; i < parts.length - 1 && obj; i++) obj = obj[parts[i]];
      if (!obj) return;
      const k = parts[parts.length - 1];
      // فقط المعرفات (oidN) تُحوَّل لكائنات؛ حالات الطلب وتواريخ الأيام تبقى نصوصاً
      if (typeof obj[k] === 'string' && obj[k].startsWith('oid')) {
        const str = obj[k];
        obj[k] = { toString: () => str };
      }
    });
    return out;
  });

// ---------- المنطق القديم (مرجع المقارنة) ----------
const oldDashboard = (orders, drivers_, keys, startOfToday) => {
  const statusList = A.STATUS_LIST;
  const statusBreakdown = {};
  statusList.forEach((s) => { statusBreakdown[s] = 0; });
  orders.forEach((o) => { if (o.status in statusBreakdown) statusBreakdown[o.status] += 1; });
  const completed = orders.filter((o) => o.status === 'completed');
  let totalRevenue = 0, totalItemsPrice = 0, totalDeliveryFees = 0;
  completed.forEach((o) => {
    totalRevenue += o.priceDetails?.totalPrice || 0;
    totalItemsPrice += o.priceDetails?.itemsPrice || 0;
    totalDeliveryFees += o.priceDetails?.deliveryFee || 0;
  });
  const map = {};
  keys.forEach((k) => { map[k] = { date: k, revenue: 0, orderCount: 0 }; });
  completed.forEach((o) => {
    const k = o.createdAt.toISOString().slice(0, 10);
    if (map[k]) {
      map[k].revenue += o.priceDetails?.totalPrice || 0;
      map[k].orderCount += 1;
    }
  });
  const todayOrders = orders.filter((o) => o.createdAt >= startOfToday);
  return {
    counts: {
      total: orders.length,
      pending: orders.filter((o) => o.status === 'pending').length,
      active: orders.filter((o) => ['accepted', 'picking_up', 'delivering'].includes(o.status)).length,
      completed: completed.length,
      cancelled: orders.filter((o) => o.status === 'cancelled').length,
    },
    statusBreakdown,
    today: {
      ordersCount: todayOrders.length,
      completedCount: todayOrders.filter((o) => o.status === 'completed').length,
      cancelledCount: todayOrders.filter((o) => o.status === 'cancelled').length,
      revenue: todayOrders.filter((o) => o.status === 'completed').reduce((s, o) => s + (o.priceDetails?.totalPrice || 0), 0),
    },
    drivers: { online: 0, total: 0 },
    financials: { totalRevenue, totalItemsPrice, totalDeliveryFees, driverEarnings: totalDeliveryFees * 0.8, appCommission: totalDeliveryFees * 0.2 },
    dailySales: Object.values(map),
  };
};

const oldAdminStats = (orders, shops_) => {
  const completed = orders.filter((o) => o.status === 'completed');
  const commission = {};
  shops_.forEach((s) => { commission[s._id.toString()] = s.appCommissionPercent || 0; });
  let totalRevenue = 0;
  completed.forEach((o) => {
    totalRevenue += (o.priceDetails?.deliveryFee || 0) * 0.2;
    const shopId = o.shop ? o.shop.toString() : null;
    totalRevenue += (o.priceDetails?.itemsPrice || 0) * ((shopId ? commission[shopId] || 0 : 0) / 100);
  });
  return { totalOrders: completed.length, totalRevenue: Math.round(totalRevenue) };
};

const oldShopFinancials = (orders, shops_, payouts) => {
  const stats = {};
  shops_.forEach((s) => {
    stats[s._id.toString()] = { _id: s._id, name: s.name, totalSales: 0, totalOrders: 0, commissionPercent: s.appCommissionPercent || 0, commission: 0, totalPaid: 0, unpaidBalance: 0 };
  });
  orders.filter((o) => o.status === 'completed').forEach((o) => {
    if (o.shop && stats[o.shop.toString()]) {
      stats[o.shop.toString()].totalSales += o.priceDetails?.itemsPrice || 0;
      stats[o.shop.toString()].totalOrders += 1;
    }
  });
  payouts.filter((p) => p.status === 'confirmed').forEach((p) => {
    const id = p.shop ? p.shop.toString() : null;
    if (id && stats[id]) stats[id].totalPaid += p.amount || 0;
  });
  Object.keys(stats).forEach((id) => {
    const s = stats[id];
    s.commission = Math.round(s.totalSales * (s.commissionPercent / 100));
    s.unpaidBalance = Math.round(s.totalSales - s.commission - s.totalPaid);
  });
  return Object.values(stats);
};

const oldDriverFinancials = (orders, drivers_) => {
  const stats = {};
  drivers_.forEach((d) => {
    stats[d._id.toString()] = { _id: d._id, name: d.name, phone: d.phone, totalOrders: 0, totalDeliveryFees: 0, driverEarnings: 0, cashCollected: 0, netBalance: 0 };
  });
  orders.filter((o) => o.status === 'completed' && o.isSettledDriver !== true).forEach((o) => {
    if (o.driver) {
      const s = stats[o.driver.toString()];
      if (s) {
        const fee = o.priceDetails?.deliveryFee || 0;
        const total = o.priceDetails?.totalPrice || 0;
        const earnings = fee * 0.8;
        s.totalOrders += 1;
        s.totalDeliveryFees += fee;
        s.driverEarnings += earnings;
        if (o.paymentMethod === 'cash') {
          s.cashCollected += total;
          s.netBalance -= total - earnings;
        } else {
          s.netBalance += earnings;
        }
      }
    }
  });
  return Object.values(stats);
};

const close = (a, b, msg) => assert(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);
const cmpObj = (a, b, path = '') => {
  if (typeof a === 'number' && typeof b === 'number') return close(a, b, path);
  if (Array.isArray(a)) {
    assert.strictEqual(a.length, b.length, `${path} length`);
    return a.forEach((x, i) => cmpObj(x, b[i], `${path}[${i}]`));
  }
  if (a && typeof a === 'object' && !a.toString.call(a).includes('Date') && !('n' in a)) {
    Object.keys(b).forEach((k) => cmpObj(a[k], b[k], `${path}.${k}`));
    return undefined;
  }
  return assert.deepStrictEqual(String(a), String(b), path);
};

// ---------- اختبارات الدوال النقية (لا تحتاج mingo) ----------
{
  const stats = A.buildAdminStats({
    roleRows: [{ _id: 'customer', count: 5 }, { _id: 'driver', count: 2 }, { _id: 'support', count: 1 }, { _id: 'admin', count: 1 }],
    shopRows: [],
    shops: [],
  });
  assert.deepStrictEqual(stats, { totalUsers: 9, totalCustomers: 5, totalDrivers: 2, totalSupport: 1, totalOrders: 0, totalRevenue: 0 });

  const empty = A.buildDashboardStats({ statusRows: [], totalsRow: undefined, dailyRows: [], todayRows: [], driversRow: undefined, keys: A.dashboardWindow(now).keys });
  assert.strictEqual(empty.counts.total, 0);
  assert.strictEqual(empty.dailySales.length, 14);
  assert.strictEqual(empty.financials.totalRevenue, 0);
  assert.deepStrictEqual(empty.drivers, { online: 0, total: 0 });

  const w = A.dashboardWindow(now);
  assert.strictEqual(w.keys.length, 14);
  assert.strictEqual(w.keys[13], '2026-10-15');
  assert.strictEqual(w.keys[0], '2026-10-02');
  assert.strictEqual(w.windowStart.toISOString(), '2026-10-02T00:00:00.000Z');

  // حالة غير معروفة تدخل بالإجمالي فقط
  const odd = A.buildDashboardStats({ statusRows: [{ _id: 'weird', count: 3 }, { _id: 'pending', count: 2 }], dailyRows: [], todayRows: [], keys: w.keys });
  assert.strictEqual(odd.counts.total, 5);
  assert.strictEqual(odd.counts.pending, 2);
  assert.strictEqual(odd.statusBreakdown.weird, undefined);
}

// ---------- اختبارات المكافئة (تحتاج mingo) ----------
if (mingo) {
  const run = (pipeline, docs) => new mingo.Aggregator(pipeline).run(docs);

  for (let round = 0; round < 25; round++) {
    const orders = makeOrders(int(0, 400));
    const plain = toPlain(orders);
    const w = A.dashboardWindow(now);
    const P = A.dashboardPipelines(w);

    // لوحة الإحصائيات
    const dash = A.buildDashboardStats({
      statusRows: run(P.byStatus, plain),
      totalsRow: run(P.completedTotals, plain)[0],
      dailyRows: run(P.dailySales, plain),
      todayRows: run(P.today, plain),
      driversRow: undefined,
      keys: w.keys,
    });
    const expectedDash = oldDashboard(orders, drivers, w.keys, w.startOfToday);
    expectedDash.drivers = dash.drivers;
    cmpObj(dash, expectedDash, `dashboard#${round}`);

    // إحصائيات الإدارة
    const adminStats = A.buildAdminStats({
      roleRows: [{ _id: 'customer', count: 3 }],
      shopRows: rehydrate(run(A.completedByShopPipeline, plain), ['_id']),
      shops,
    });
    const expectedAdmin = oldAdminStats(orders, shops);
    assert.strictEqual(adminStats.totalOrders, expectedAdmin.totalOrders, `admin orders#${round}`);
    assert.strictEqual(adminStats.totalRevenue, expectedAdmin.totalRevenue, `admin revenue#${round}`);

    // مالية المحلات
    const payouts = [];
    for (let i = 0; i < int(0, 8); i++) {
      payouts.push({ status: pick(['confirmed', 'pending', 'rejected']), shop: pick([null, ...shops.map((s) => s._id)]), amount: int(1, 50) * 1000 });
    }
    const plainPayouts = payouts.map((p) => ({ ...p, shop: p.shop ? p.shop.toString() : null }));
    const shopFin = A.buildShopFinancials({
      shops,
      salesRows: rehydrate(run(A.shopSalesPipeline, plain), ['_id']),
      payoutRows: rehydrate(run(A.shopPayoutsPipeline, plainPayouts), ['_id']),
    });
    cmpObj(shopFin, oldShopFinancials(orders, shops, payouts), `shops#${round}`);

    // مالية السائقين
    const driverFin = A.buildDriverFinancials({
      drivers,
      rows: rehydrate(run(A.driverOrdersPipeline, plain), ['_id.driver']),
    });
    cmpObj(driverFin, oldDriverFinancials(orders, drivers), `drivers#${round}`);
  }

  // عدد السائقين المتصلين
  const users = [
    { role: 'driver', isActive: true, driverDetails: { isAvailable: true } },
    { role: 'driver', isActive: true, driverDetails: { isAvailable: false } },
    { role: 'driver', isActive: false, driverDetails: { isAvailable: true } },
    { role: 'driver', isActive: true },
    { role: 'customer', isActive: true },
  ];
  const row = run(A.driversCountPipeline, users)[0];
  assert.deepStrictEqual({ total: row.total, online: row.online }, { total: 4, online: 1 });

  // أدوار المستخدمين
  const roles = run(A.usersByRolePipeline, users);
  assert.strictEqual(roles.find((r) => r._id === 'driver').count, 4);

  console.log('اختبارات المكافئة نجحت (25 جولة × 4 نقاط)');
}
// ---------- اختبار تكامل: المسارات الأربعة عبر Express (القاعدة مستبدلة بمحاكٍ بالذاكرة) ----------
async function routesIntegration() {
  const express = require('express');
  const Order = require('./models/Order');
  const User = require('./models/User');
  const Shop = require('./models/Shop');
  const Payout = require('./models/Payout');

  const orders = makeOrders(300);
  const plain = toPlain(orders);
  const payouts = [
    { status: 'confirmed', shop: shops[1]._id.toString(), amount: 20000 },
    { status: 'pending', shop: shops[1]._id.toString(), amount: 99999 },
  ];
  const users = [
    { role: 'customer' }, { role: 'customer' }, { role: 'support' }, { role: 'admin' },
    { role: 'driver', isActive: true, driverDetails: { isAvailable: true } },
    { role: 'driver', isActive: true, driverDetails: { isAvailable: false } },
  ];
  const run = (pipeline, docs) => new mingo.Aggregator(pipeline).run(docs);
  // الحساب لا يغيّر شكل الاستجابة: الـ aggregate المُستبدل ينفّذ نفس خطوط التجميع المنشورة
  Order.aggregate = (p) => Promise.resolve(rehydrate(run(p, plain), ['_id', '_id.driver'].filter(() => true)));
  User.aggregate = (p) => Promise.resolve(run(p, users));
  Payout.aggregate = (p) => Promise.resolve(rehydrate(run(p, payouts), ['_id']));
  Shop.find = () => ({ select: () => ({ lean: async () => shops }) });
  User.find = () => ({ select: () => ({ lean: async () => drivers }) });

  const app = express();
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/orders', require('./routes/orders'));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const get = async (path) => {
    const res = await fetch(base + path);
    assert.strictEqual(res.status, 200, `${path} => ${res.status}`);
    const body = await res.json();
    assert.strictEqual(body.success, true, path);
    return body.data;
  };

  try {
    const dash = await get('/orders/dashboard/stats');
    assert.deepStrictEqual(Object.keys(dash), ['counts', 'statusBreakdown', 'today', 'drivers', 'financials', 'dailySales']);
    assert.deepStrictEqual(Object.keys(dash.counts), ['total', 'pending', 'active', 'completed', 'cancelled']);
    assert.strictEqual(dash.counts.total, orders.length);
    assert.strictEqual(dash.dailySales.length, 14);
    assert.deepStrictEqual(dash.drivers, { online: 1, total: 2 });
    const w = A.dashboardWindow(new Date());
    const expected = oldDashboard(orders, drivers, w.keys, w.startOfToday);
    assert.strictEqual(dash.counts.completed, expected.counts.completed);
    close(dash.financials.totalRevenue, expected.financials.totalRevenue, 'dash revenue');

    const stats = await get('/admin/stats');
    assert.deepStrictEqual(Object.keys(stats), ['totalUsers', 'totalCustomers', 'totalDrivers', 'totalSupport', 'totalOrders', 'totalRevenue']);
    assert.strictEqual(stats.totalUsers, 6);
    assert.strictEqual(stats.totalCustomers, 2);
    assert.strictEqual(stats.totalDrivers, 2);
    assert.strictEqual(stats.totalSupport, 1);
    assert.strictEqual(stats.totalOrders, oldAdminStats(orders, shops).totalOrders);
    assert.strictEqual(stats.totalRevenue, oldAdminStats(orders, shops).totalRevenue);

    const shopsFin = await get('/admin/financials/shops');
    assert.deepStrictEqual(Object.keys(shopsFin[0]), ['_id', 'name', 'totalSales', 'totalOrders', 'commissionPercent', 'commission', 'totalPaid', 'unpaidBalance']);
    cmpObj(shopsFin, oldShopFinancials(orders, shops, payouts).map((x) => JSON.parse(JSON.stringify(x))), 'shopsFin');

    const driversFin = await get('/admin/financials/drivers');
    assert.deepStrictEqual(Object.keys(driversFin[0]), ['_id', 'name', 'phone', 'totalOrders', 'totalDeliveryFees', 'driverEarnings', 'cashCollected', 'netBalance']);
    assert.strictEqual(driversFin.length, drivers.length);
    cmpObj(driversFin, oldDriverFinancials(orders, drivers).map((x) => JSON.parse(JSON.stringify(x))), 'driversFin');

    console.log('اختبار التكامل نجح: 4 مسارات (الشكل والأرقام)');
  } finally {
    server.close();
  }
}

(async () => {
  if (mingo) await routesIntegration();
  console.log('كل اختبارات إحصائيات الإدارة نجحت');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
