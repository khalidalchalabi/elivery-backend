// اختبارات وقت توفر المنتج (من ساعة إلى ساعة، بتوقيت بغداد)
const assert = require('assert');
const A = require('./utils/productAvailability');

const at = (h, m = 0) => new Date(Date.UTC(2026, 9, 15, h - 3, m)); // الوقت بتوقيت بغداد
const prod = (availability, isAvailable = true) => ({ isAvailable, availability });
const window = (from, to) => ({ enabled: true, from, to });

// ---------- النافذة ----------
{
  const p = prod(window('07:00', '11:00'));
  assert.strictEqual(A.isAvailableNow(p, at(6, 59)), false, 'قبل البداية');
  assert.strictEqual(A.isAvailableNow(p, at(7, 0)), true, 'البداية شاملة');
  assert.strictEqual(A.isAvailableNow(p, at(10, 59)), true);
  assert.strictEqual(A.isAvailableNow(p, at(11, 0)), false, 'النهاية غير شاملة');
  assert.strictEqual(A.isAvailableNow(p, at(15, 0)), false);

  // المدى الليلي
  const night = prod(window('18:00', '02:00'));
  assert.strictEqual(A.isAvailableNow(night, at(17, 59)), false);
  assert.strictEqual(A.isAvailableNow(night, at(18, 0)), true);
  assert.strictEqual(A.isAvailableNow(night, at(23, 30)), true);
  assert.strictEqual(A.isAvailableNow(night, at(1, 59)), true);
  assert.strictEqual(A.isAvailableNow(night, at(2, 0)), false);
  assert.strictEqual(A.isAvailableNow(night, at(12, 0)), false);

  // الوقت يُحسب ببغداد مو UTC: 05:00 UTC = 08:00 بغداد
  assert.strictEqual(A.isAvailableNow(p, new Date(Date.UTC(2026, 9, 15, 5, 0))), true);
  assert.strictEqual(A.isAvailableNow(p, new Date(Date.UTC(2026, 9, 15, 8, 30))), false); // 11:30 بغداد
}

// ---------- الزر اليدوي والتوقيت المعطّل ----------
{
  assert.strictEqual(A.isAvailableNow(prod(undefined), at(3, 0)), true, 'منتج قديم بلا availability');
  assert.strictEqual(A.isAvailableNow(prod({ enabled: false, from: '07:00', to: '11:00' }), at(15, 0)), true, 'معطّل');
  assert.strictEqual(A.isAvailableNow(prod(window('07:00', '11:00'), false), at(8, 0)), false, 'الزر اليدوي يمنعه حتى داخل النافذة');
  assert.strictEqual(A.isAvailableNow({ availability: window('07:00', '11:00') }, at(8, 0)), true, 'isAvailable غير معرّف = متاح');
  // بيانات غير صالحة: لا نخفي المنتج بالغلط
  assert.strictEqual(A.isAvailableNow(prod(window('xx', '11:00')), at(15, 0)), true);
  assert.strictEqual(A.isAvailableNow(prod(window('07:00', '07:00')), at(15, 0)), true);
}

// ---------- التحقق من المدخلات ----------
{
  assert.deepStrictEqual(A.mergeAvailability(undefined, null), { value: undefined });
  assert.deepStrictEqual(A.mergeAvailability({ enabled: true, from: '7:00', to: '11:30' }, null), {
    value: { enabled: true, from: '07:00', to: '11:30' },
  });
  assert.deepStrictEqual(A.mergeAvailability({ enabled: 'true', from: '07:00', to: '11:00' }, null).value.enabled, true);
  // تعديل جزئي يحافظ على الباقي
  assert.deepStrictEqual(
    A.mergeAvailability({ to: '12:00' }, { enabled: true, from: '07:00', to: '11:00' }).value,
    { enabled: true, from: '07:00', to: '12:00' }
  );
  assert(A.mergeAvailability({ enabled: true, from: '25:00', to: '11:00' }, null).error, 'ساعة غير صالحة');
  assert(A.mergeAvailability({ enabled: true, from: '07:00', to: '07:00' }, null).error, 'متطابقان');
  // المتطابقان مسموحان لو التوقيت معطّل
  assert.strictEqual(A.mergeAvailability({ enabled: false, from: '07:00', to: '07:00' }, null).error, undefined);
  assert(A.mergeAvailability('x', null).error);
}

// ---------- الإرسال للتطبيقات ----------
{
  const s = A.serializeProduct({ name: 'فطور', isAvailable: true, availability: window('07:00', '11:00') }, at(15, 0));
  assert.strictEqual(s.isAvailable, false, 'الفعلي (للتطبيقات القديمة)');
  assert.strictEqual(s.manualAvailable, true, 'مفتاح التاجر الخام');
  assert.deepStrictEqual(s.availability, { enabled: true, from: '07:00', to: '11:00' });

  const old = A.serializeProduct({ name: 'x', isAvailable: false }, at(8, 0));
  assert.strictEqual(old.isAvailable, false);
  assert.strictEqual(old.manualAvailable, false);
  assert.deepStrictEqual(old.availability, { enabled: false, from: '08:00', to: '23:00' });
}

// ---------- المسارات عبر Express (القاعدة مستبدلة) ----------
async function routes() {
  const express = require('express');
  const Product = require('./models/Product');
  const Shop = require('./models/Shop');

  const NOW = new Date();
  // نافذة تشمل الوقت الحالي، وأخرى لا تشمله أبداً (من ساعة بعد الآن لساعتين)
  const hhmm = (d) => {
    const b = new Date(d.getTime() + 3 * 3600 * 1000);
    return `${String(b.getUTCHours()).padStart(2, '0')}:${String(b.getUTCMinutes()).padStart(2, '0')}`;
  };
  const inWindow = { enabled: true, from: hhmm(new Date(NOW.getTime() - 3600 * 1000)), to: hhmm(new Date(NOW.getTime() + 3600 * 1000)) };
  const outWindow = { enabled: true, from: hhmm(new Date(NOW.getTime() + 3600 * 1000)), to: hhmm(new Date(NOW.getTime() + 2 * 3600 * 1000)) };

  const docs = [
    { _id: '64f0a1b2c3d4e5f6a7b8c901', shop: 's1', name: 'فطور (داخل الوقت)', price: 1000, isAvailable: true, availability: inWindow },
    { _id: '64f0a1b2c3d4e5f6a7b8c902', shop: 's1', name: 'عشاء (خارج الوقت)', price: 2000, isAvailable: true, availability: outWindow },
    { _id: '64f0a1b2c3d4e5f6a7b8c903', shop: 's1', name: 'موقوف يدوياً', price: 3000, isAvailable: false, availability: { enabled: false } },
    { _id: '64f0a1b2c3d4e5f6a7b8c904', shop: 's1', name: 'عادي', price: 500, isAvailable: true },
  ];
  const wrap = (d) => ({ ...d, toObject: () => ({ ...d }) });

  Product.find = (filter) => {
    let rows = docs;
    if (filter && filter._id && filter._id.$in) rows = docs.filter((d) => filter._id.$in.includes(d._id));
    if (filter && filter.shop) rows = rows.filter((d) => d.shop === filter.shop);
    if (filter && filter.isAvailable) rows = rows.filter((d) => d.isAvailable !== false);
    const out = rows.map(wrap);
    const chain = {
      sort: () => chain,
      select: () => chain,
      limit: () => chain,
      lean: async () => rows.map((d) => ({ ...d })),
      then: (res, rej) => Promise.resolve(out).then(res, rej),
    };
    return chain;
  };
  let saved = null;
  Product.prototype.save = async function () { saved = this; return this; };
  Product.findById = async (id) => {
    const d = docs.find((x) => x._id === id);
    if (!d) return null;
    const doc = new Product({ ...d, _id: undefined, shop: undefined });
    doc.shop = '64f0a1b2c3d4e5f6a7b8c999';
    doc.save = async () => { saved = doc; return doc; };
    return doc;
  };
  Shop.findById = async () => ({ categories: ['عام'], save: async () => {} });

  const app = express();
  app.use(express.json());
  app.use('/api/shops', require('./routes/shops'));
  app.use('/api/orders', require('./routes/orders'));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };

  try {
    // قائمة المنتجات: isAvailable الفعلي + manualAvailable + availability
    const list = await call('GET', '/shops/s1/products');
    assert.strictEqual(list.status, 200);
    const byName = Object.fromEntries(list.body.data.map((p) => [p.name, p]));
    assert.strictEqual(byName['فطور (داخل الوقت)'].isAvailable, true);
    assert.strictEqual(byName['عشاء (خارج الوقت)'].isAvailable, false);
    assert.strictEqual(byName['عشاء (خارج الوقت)'].manualAvailable, true);
    assert.strictEqual(byName['موقوف يدوياً'].isAvailable, false);
    assert.strictEqual(byName['موقوف يدوياً'].manualAvailable, false);
    assert.strictEqual(byName['عادي'].isAvailable, true);
    assert.deepStrictEqual(byName['عادي'].availability.enabled, false);

    // البحث: خارج النافذة وموقوف يدوياً لا يظهران
    const search = await call('GET', '/shops/products/search?q=' + encodeURIComponent('وقت'));
    assert.strictEqual(search.status, 200);
    const names = search.body.data.map((p) => p.name);
    assert(names.includes('فطور (داخل الوقت)'), JSON.stringify(names));
    assert(!names.includes('عشاء (خارج الوقت)'), 'خارج النافذة يخفى من البحث');
    assert(!names.includes('موقوف يدوياً'));

    // الإنشاء: تحقق من المدخلات + حفظ النافذة
    const bad = await call('POST', '/shops/s1/products', { name: 'x', price: 1000, category: 'عام', availability: { enabled: true, from: '07:00', to: '07:00' } });
    assert.strictEqual(bad.status, 400);
    saved = null;
    const created = await call('POST', '/shops/64f0a1b2c3d4e5f6a7b8c999/products', {
      name: 'فطور', price: 1000, category: 'عام', imagePath: '🍳', availability: { enabled: true, from: '7:00', to: '11:00' },
    });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    assert.deepStrictEqual(saved.availability.toObject ? saved.availability.toObject() : saved.availability, { enabled: true, from: '07:00', to: '11:00' });
    assert.strictEqual(created.body.data.manualAvailable, true);

    // التعديل: نافذة جديدة، والزر اليدوي مستقل
    saved = null;
    const upd = await call('PUT', '/shops/products/64f0a1b2c3d4e5f6a7b8c904', { availability: { enabled: true, from: '09:00', to: '12:00' } });
    assert.strictEqual(upd.status, 200, JSON.stringify(upd.body));
    assert.deepStrictEqual(upd.body.data.availability, { enabled: true, from: '09:00', to: '12:00' });
    assert.strictEqual(upd.body.data.manualAvailable, true);
    const badUpd = await call('PUT', '/shops/products/64f0a1b2c3d4e5f6a7b8c904', { availability: { enabled: true, from: '99:00' } });
    assert.strictEqual(badUpd.status, 400);

    // الطلب: منتج خارج وقته أو موقوف يُرفض قبل أي شي، والمتاح يتجاوز هذا الفحص
    const orderBase = { customerId: 'c1', pickupAddress: 'a', dropoffAddress: 'b', itemsPrice: 1000, deliveryFee: 1000, shopId: undefined };
    const rejected = await call('POST', '/orders', {
      ...orderBase,
      items: [{ product: '64f0a1b2c3d4e5f6a7b8c901', name: 'ok', quantity: 1, price: 1000 }, { product: '64f0a1b2c3d4e5f6a7b8c902', name: 'عشاء', quantity: 1, price: 2000 }],
    });
    assert.strictEqual(rejected.status, 400);
    assert(rejected.body.message.includes('عشاء (خارج الوقت)'), rejected.body.message);
    assert(!rejected.body.message.includes('فطور (داخل الوقت)'));

    const manual = await call('POST', '/orders', {
      ...orderBase,
      items: [{ product: '64f0a1b2c3d4e5f6a7b8c903', name: 'x', quantity: 1, price: 3000 }],
    });
    assert.strictEqual(manual.status, 400);
    assert(manual.body.message.includes('موقوف يدوياً'));

    const okOrder = await call('POST', '/orders', {
      ...orderBase,
      items: [{ product: '64f0a1b2c3d4e5f6a7b8c901', name: 'ok', quantity: 1, price: 1000 }],
    });
    // يتجاوز فحص التوفر وينتقل لخطوات لاحقة (العميل غير موجود بالقاعدة المستبدلة) — المهم أنه ما انرفض بسبب المنتج
    assert(!(okOrder.body.message || '').includes('غير متوفر'), okOrder.body.message);

    console.log('اختبار المسارات نجح: القائمة، البحث، الإنشاء، التعديل، رفض الطلب');
  } finally {
    server.close();
  }
}

routes()
  .then(() => console.log('كل اختبارات وقت توفر المنتج نجحت'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
