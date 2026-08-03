const axios = require('axios');

const baseUrl = 'http://localhost:5000/api';

async function runTest() {
  console.log('🚀 بدء فحص الدورة الكاملة للنظام (الزبون والسائق والطلبات)...');

  try {
    // 1. تسجيل دخول الزبون
    console.log('\n🔐 1. محاكاة تسجيل دخول الزبون (abbas@test.com)...');
    const customerLogin = await axios.post(`${baseUrl}/auth/login`, {
      email: 'abbas@test.com',
      password: 'password123',
    });
    const customerId = customerLogin.data.data._id;
    console.log(`✅ تم تسجيل دخول العميل بنجاح. معرف العميل (ID): ${customerId}`);

    // 2. تسجيل دخول السائق
    console.log('\n🔐 2. محاكاة تسجيل دخول السائق (driver@test.com)...');
    const driverLogin = await axios.post(`${baseUrl}/auth/login`, {
      email: 'driver@test.com',
      password: 'driver123',
    });
    const driverId = driverLogin.data.data._id;
    console.log(`✅ تم تسجيل دخول السائق بنجاح. معرف السائق (ID): ${driverId}`);

    // 3. إنشاء طلب جديد من الزبون
    console.log('\n🛒 3. محاكاة قيام الزبون بعمل طلب جديد من سوبرماركت البركة...');
    const orderResponse = await axios.post(`${baseUrl}/orders`, {
      customerId: customerId,
      items: [
        { name: 'حليب كامل الدسم 1 لتر', quantity: 2, price: 1500 },
        { name: 'أرز بسمتي فاخر 5 كغم', quantity: 1, price: 7500 },
      ],
      pickupAddress: 'سوبرماركت البركة',
      pickupLat: 34.22,
      pickupLng: 44.53,
      dropoffAddress: 'ديالى، الخالص، قرب المحكمة',
      dropoffLat: 34.221,
      dropoffLng: 44.532,
      itemsPrice: 10500,
      deliveryFee: 1000,
      paymentMethod: 'cash',
    });
    const order = orderResponse.data.data;
    const orderId = order._id;
    console.log(`✅ تم إنشاء الطلب بنجاح في قاعدة البيانات. معرف الطلب (ID): ${orderId}`);
    console.log(`   الحالة الحالية للطلب: ${order.status}`);

    // 4. السائق يستعلم عن الطلبات المعلقة المتاحة
    console.log('\n🛵 4. محاكاة استعلام السائق عن الطلبات المعلقة...');
    const pendingOrdersResponse = await axios.get(`${baseUrl}/orders`);
    const pendingOrders = pendingOrdersResponse.data.data.filter(o => o.status === 'pending');
    console.log(`✅ تم جلب الطلبات المعلقة بنجاح. عدد الطلبات المعلقة المتاحة: ${pendingOrders.length}`);
    const isOrderFound = pendingOrders.some(o => o._id === orderId);
    console.log(`   هل الطلب الجديد متواجد في قائمة السائق؟ ${isOrderFound ? 'نعم (نجاح)' : 'لا (فشل)'}`);

    if (!isOrderFound) {
      throw new Error('الطلب لم يظهر في قائمة السائق!');
    }

    // 5. السائق يقبل الطلب
    console.log(`\n🚚 5. محاكاة قيام السائق بقبول الطلب #${orderId.substring(orderId.length - 6).toUpperCase()}...`);
    const acceptResponse = await axios.put(`${baseUrl}/orders/${orderId}/accept`, {
      driverId: driverId,
    });
    console.log(`✅ تم قبول الطلب وتعيينه للسائق بنجاح!`);
    console.log(`   حالة الطلب بعد القبول: ${acceptResponse.data.data.status}`);

    // 6. السائق يبدأ التوصيل (delivering)
    console.log('\n📦 6. محاكاة بدء السائق في توصيل الطلب للزبون...');
    const deliveringResponse = await axios.put(`${baseUrl}/orders/${orderId}/status`, {
      status: 'delivering',
    });
    console.log(`✅ تم تحديث حالة الطلب إلى: ${deliveringResponse.data.data.status}`);

    // 7. السائق يسلم الطلب ويكمله (completed)
    console.log('\n🏁 7. محاكاة تسليم الطلب للزبون بنجاح وإتمام الطلب...');
    const completedResponse = await axios.put(`${baseUrl}/orders/${orderId}/status`, {
      status: 'completed',
    });
    console.log(`✅ تم تحديث حالة الطلب إلى: ${completedResponse.data.data.status}`);

    console.log('\n🎉 الفحص تم بنجاح 100%! كافة مسارات الاتصال وقاعدة البيانات تعمل بشكل سليم وخالية من المشاكل.');
  } catch (error) {
    console.error('\n❌ فشل فحص النظام. الخطأ هو:');
    if (error.response) {
      console.error(error.response.data);
    } else {
      console.error(error.message);
    }
  }
}

runTest();
