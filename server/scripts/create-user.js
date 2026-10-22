// الاستخدام: node scripts/create-user.js <username> <role> "<الاسم الكامل>" <كلمة مرور مؤقتة>
const bcrypt = require('bcryptjs');
const { db, now } = require('../db');
const { ROLES } = require('../permissions');
const [username, role, fullName, password] = process.argv.slice(2);
if (!username || !ROLES.includes(role) || !fullName || !password || password.length < 8) {
  console.error('الاستخدام: node scripts/create-user.js <username> <role> "<الاسم الكامل>" <كلمة مرور ≥ 8 أحرف>');
  console.error('الأدوار:', ROLES.join(', '));
  process.exit(1);
}
db.prepare('INSERT INTO users (username, full_name, role, password_hash, must_change_password, created_at) VALUES (?,?,?,?,1,?)')
  .run(username, fullName, role, bcrypt.hashSync(password, 10), now());
console.log('تم إنشاء المستخدم. سيُطلب منه تغيير كلمة المرور عند أول دخول.');
