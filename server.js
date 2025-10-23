const app = require('./src/app'); // แก้จาก './src/app' เป็น './app'

const PORT = process.env.PORT || 5000; // ใช้ 5000 ตามโปรเจกต์

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
