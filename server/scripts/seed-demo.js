// بيانات تجريبية موسومة [DEMO] وقابلة للحذف بالكامل:  npm run seed:demo  /  npm run seed:demo:remove
const bcrypt = require('bcryptjs');
const { db, now } = require('../db');

if (process.argv.includes('--remove')) {
  db.prepare('DELETE FROM tasks WHERE is_demo = 1').run();
  db.prepare('DELETE FROM users WHERE is_demo = 1').run();
  console.log('تم حذف كل البيانات التجريبية.');
  process.exit(0);
}
if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
  console.error('ممنوع في بيئة الإنتاج (استخدم --force إن كنت متأكداً).');
  process.exit(1);
}
const pw = bcrypt.hashSync('Demo@12345', 10);
const people = [
  ['demo_dept', 'DEPT_HEAD', '[DEMO] رئيس قسم الآليات'],
  ['demo_sector1', 'SECTOR_SUPERVISOR', '[DEMO] مشرف القطاع الأول'],
  ['demo_muni1', 'MUNICIPALITY_SUPERVISOR', '[DEMO] مشرف بلدية المركز'],
  ['demo_emp1', 'EMPLOYEE', '[DEMO] مهندس ميداني'],
  ['demo_driver1', 'DRIVER', '[DEMO] سائق ضاغطة'],
];
const ins = db.prepare('INSERT OR IGNORE INTO users (username, full_name, role, password_hash, must_change_password, is_demo, created_at) VALUES (?,?,?,?,0,1,?)');
for (const [u, r, n] of people) ins.run(u, n, r, pw, now());
console.log('تم إنشاء مستخدمين تجريبيين (كلمة المرور: Demo@12345):', people.map((p) => p[0]).join(', '));
