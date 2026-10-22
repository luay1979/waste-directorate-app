// اختبار تكاملي سريع: node test.js
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'dir-'));
process.env.ADMIN_PASSWORD = 'Initial#Pass1';
const assert = require('assert');
const { app, bootstrap } = require('./index');
bootstrap();

const srv = app.listen(0, async () => {
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const call = async (method, path, body, token) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  const ok = (name) => console.log('  ✔', name);
  try {
    let r = await call('POST', '/auth/login', { username: 'director', password: 'wrong' });
    assert.equal(r.status, 401); ok('كلمة مرور خاطئة ← 401');

    r = await call('POST', '/auth/login', { username: 'director', password: 'Initial#Pass1' });
    assert.equal(r.status, 200); assert.equal(r.body.user.mustChangePassword, true);
    let dir = r.body.token;
    r = await call('GET', '/tasks', null, dir);
    assert.equal(r.status, 403); assert.equal(r.body.error, 'PASSWORD_CHANGE_REQUIRED'); ok('منع كل شيء قبل تغيير كلمة المرور');

    r = await call('POST', '/auth/change-password', { currentPassword: 'Initial#Pass1', newPassword: 'NewPass#2026' }, dir);
    assert.equal(r.status, 200); const old = dir; dir = r.body.token;
    r = await call('GET', '/auth/me', null, old);
    assert.equal(r.status, 401); ok('إبطال الرمز القديم بعد تغيير كلمة المرور');

    const mk = async (username, role, fullName) => {
      r = await call('POST', '/users', { username, role, fullName, password: 'Temp#12345' }, dir);
      assert.equal(r.status, 201);
      const l = await call('POST', '/auth/login', { username, password: 'Temp#12345' });
      const c = await call('POST', '/auth/change-password', { currentPassword: 'Temp#12345', newPassword: 'Mine#12345' }, l.body.token);
      return { id: r.body.user.id, token: c.body.token };
    };
    const dept = await mk('dept1', 'DEPT_HEAD', 'رئيس قسم');
    const emp = await mk('emp1', 'EMPLOYEE', 'موظف أول');
    const emp2 = await mk('emp2', 'EMPLOYEE', 'موظف ثان');
    const muni = await mk('muni1', 'MUNICIPALITY_SUPERVISOR', 'مشرف بلدية');
    ok('إنشاء مستخدمين وتغيير كلمات مرورهم');

    r = await call('POST', '/users', { username: 'x1x', role: 'EMPLOYEE', fullName: 'س س', password: 'Temp#12345' }, emp.token);
    assert.equal(r.status, 403); ok('الموظف لا يستطيع إنشاء مستخدمين');

    const task = { title: 'كشف فني على الضاغطة 104', type: 'INSPECTION', priority: 'HIGH' };
    r = await call('POST', '/tasks', { ...task, assignedTo: emp.id }, emp.token);
    assert.equal(r.status, 403); ok('الموظف لا يستطيع إسناد مهام');
    r = await call('POST', '/tasks', { ...task, assignedTo: muni.id }, dept.token);
    assert.equal(r.status, 403); ok('رئيس القسم لا يسند لمشرف بلدية (خارج تسلسله)');
    r = await call('POST', '/tasks', { ...task, assignedTo: emp.id }, dept.token);
    assert.equal(r.status, 201); const tid = r.body.task.id; ok('رئيس القسم يسند مهمة لموظف');

    r = await call('GET', '/tasks', null, emp2.token);
    assert.equal(r.body.tasks.length, 0); ok('موظف آخر لا يرى المهمة');
    r = await call('PATCH', `/tasks/${tid}/status`, { status: 'DONE' }, emp2.token);
    assert.equal(r.status, 404); ok('موظف آخر لا يستطيع تعديلها (404)');
    r = await call('PATCH', `/tasks/${tid}/status`, { status: 'DONE' }, dept.token);
    assert.equal(r.status, 403); ok('المُسنِد لا ينجز بدل المنفذ');

    r = await call('PATCH', `/tasks/${tid}/status`, { status: 'IN_PROGRESS' }, emp.token);
    assert.equal(r.status, 200);
    r = await call('PATCH', `/tasks/${tid}/status`, { status: 'DONE', note: 'تم تغيير الصمام' }, emp.token);
    assert.equal(r.status, 200); assert.equal(r.body.task.status, 'DONE');
    r = await call('PATCH', `/tasks/${tid}/status`, { status: 'CANCELLED' }, dir);
    assert.equal(r.status, 409); ok('لا إلغاء لمهمة منجزة (409)');

    r = await call('POST', '/tasks', { ...task, assignedTo: emp.id }, dir);
    const t2 = r.body.task.id;
    r = await call('PATCH', `/tasks/${t2}/status`, { status: 'CANCELLED' }, dir);
    assert.equal(r.status, 200); ok('المدير يلغي مهمة مفتوحة');

    r = await call('GET', '/tasks', null, dir);
    assert.equal(r.body.tasks.length, 2); ok('المدير يرى كل المهام');
    r = await call('GET', '/audit', null, emp.token);
    assert.equal(r.status, 403);
    r = await call('GET', '/audit', null, dir);
    assert.ok(r.body.logs.length > 5); ok('سجل التدقيق للمدير فقط');

    r = await call('PATCH', `/users/${emp.id}`, { active: false }, dir);
    assert.equal(r.status, 200);
    r = await call('GET', '/tasks', null, emp.token);
    assert.equal(r.status, 401); ok('تعطيل المستخدم يُسقط جلسته فوراً');

    for (let i = 0; i < 5; i++) await call('POST', '/auth/login', { username: 'dept1', password: 'bad' });
    r = await call('POST', '/auth/login', { username: 'dept1', password: 'Mine#12345' });
    assert.equal(r.status, 429); ok('تحديد محاولات الدخول (429)');

    console.log('\nكل الاختبارات نجحت ✔');
    srv.close(); process.exit(0);
  } catch (e) { console.error('\n✘ فشل:', e.message); console.error(e.stack.split('\n')[1]); srv.close(); process.exit(1); }
});
