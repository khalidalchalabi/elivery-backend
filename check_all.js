const mongoose = require('mongoose');
const Shop = require('./models/Shop');
const PromoCode = require('./models/PromoCode');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('--- SHOPS ---');
    const shops = await Shop.find();
    shops.forEach(s => {
      console.log(`Shop: ${s.name}, Discount: ${s.discountPercentage}%, MinAmount: ${s.minOrderAmountForDiscount}`);
    });

    console.log('\n--- PROMO CODES ---');
    const promos = await PromoCode.find();
    promos.forEach(p => {
      console.log(`Promo: ${p.code}, Discount: ${p.discountPercentage}%, MinOrder: ${p.minOrderAmount}, Active: ${p.isActive}`);
    });

    process.exit(0);
  })
  .catch(console.error);
