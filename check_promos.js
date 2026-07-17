const mongoose = require('mongoose');
const PromoCode = require('./models/PromoCode');

mongoose.connect('mongodb+srv://abbasfox201511:80Bss715@cluster0.nhqufxu.mongodb.net/delivery_db?retryWrites=true&w=majority&appName=Cluster0')
  .then(async () => {
    const promos = await PromoCode.find().sort({ createdAt: -1 }).limit(5);
    console.log(promos);
    process.exit(0);
  });
