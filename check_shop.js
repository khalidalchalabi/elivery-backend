const mongoose = require('mongoose');
const Shop = require('./models/Shop');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    const shop = await Shop.findById('6a5817b490c5b28edd65ddd1');
    console.log('Shop:', shop);
    process.exit(0);
  })
  .catch(console.error);
