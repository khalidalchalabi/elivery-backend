const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    const merchants = await User.find({ role: 'merchant' });
    console.log('Merchants:', merchants.map(m => ({ email: m.email, shop: m.shop })));
    process.exit(0);
  })
  .catch(console.error);
