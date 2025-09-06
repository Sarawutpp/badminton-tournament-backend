// server.js
require('dotenv').config();
const { createServer } = require('http');
const app = require('./src/app');


const PORT = process.env.PORT || 5000;
const server = createServer(app);


server.listen(PORT, () => {
console.log(`API running on http://localhost:${PORT}`);
});// deploy-test Sat 09/06/2025 14:34:30.23
