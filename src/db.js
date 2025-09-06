// src/db.js
const mongoose = require('mongoose');


async function connectDB(uri) {
mongoose.set('strictQuery', true);
return mongoose.connect(uri);
}


module.exports = { connectDB };