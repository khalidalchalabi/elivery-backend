const mongoose = require('mongoose');
const Order = require('./models/Order');

mongoose.connect('mongodb+srv://abbasfox201511_db_user:DlvNxHYSKlKUAVkw@cluster0.nhqufxu.mongodb.net/delivery_db?retryWrites=true&w=majority&appName=Cluster0')
  .then(async () => {
    try {
      const order = new Order({
        customer: new mongoose.Types.ObjectId(),
        items: [{ name: 'test', quantity: 1, price: 100 }],
        pickupLocation: { type: 'Point', coordinates: [0, 0], address: 'test' },
        dropoffLocation: { type: 'Point', coordinates: [0, 0], address: 'test' },
        shop: 'r1'
      });
      await order.save();
      console.log('Saved order:', order);
    } catch (err) {
      console.error('Error:', err.message);
    }
    process.exit(0);
  });
