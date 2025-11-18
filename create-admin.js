// create-admin.js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { connectDB } = require('./src/db');
const User = require('./src/models/user.model'); // ⚠️ path นี้ตรงกับโครงที่หมูเด้งใช้จริง

async function main() {
  // ใช้ URI เดียวกับ app.js เป๊ะ ๆ
  const uri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    'mongodb://127.0.0.1:27017/badtournament';

  await connectDB(uri);

  const username = 'admin';
  const password = 'adminmoodeng26';   // 👈 ใช้รหัสที่หมูเด้งอยากตั้ง
  const displayName = 'Tournament Admin';

  const passwordHash = await bcrypt.hash(password, 10);

  const exists = await User.findOne({ username: username.toLowerCase() });
  if (exists) {
    console.log('⚠️ User นี้มีอยู่แล้ว:', username);
    console.log('ถ้าอยากเปลี่ยนรหัสผ่าน ลบ user เดิมใน collection `users` ก่อนครับ');
    process.exit(0);
  }

  const user = await User.create({
    username: username.toLowerCase(),
    passwordHash,
    role: 'admin',
    displayName,
    isActive: true,
  });

  console.log('🎉 สร้าง Admin User สำเร็จ!');
  console.log('Username:', username);
  console.log('Password:', password);
  console.log('User:', user);

  process.exit(0);
}

main().catch((err) => {
  console.error('Error while creating admin:', err);
  process.exit(1);
});
