const mongoose = require('mongoose');
const Order = require('./models/Order');

mongoose.connect('mongodb://localhost:27017/alkhalis_db').then(async () => {
  const orders = await Order.find({ status: 'pending' });
  console.log('Pending orders:', orders.length);
  for (let o of orders) {
    console.log(o.customerName, o.deliveryAddress?.address, o.status, o._id);
  }
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
