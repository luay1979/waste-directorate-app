const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, now, audit, JWT_SECRET } = require('./db');
const { ROLES, ASSIGNABLE, TASK_TYPES, TASK_PRIORITIES, can } = require('./permissions');

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });
const extra = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: ['https://localhost', 'http://localhost', 'capacitor://localhost', ...extra] }));
app.use(express.json({ limit: '50kb' }));

// ---------- أدوات ----------
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);
const failures = new Map();
const WINDOW = 15 * 60 * 1000;
const isLimited = (k) => { const e = failures.get(k); return !!e && e.count >= 5 && Date.now() - e.first < WINDOW; };
const noteFail = (k) => {
  const e = failures.get(k);
  if (!e || Date.now() - e.first >= WINDOW) failures.set(k, { count: 1, first: Date.now() });
  else e.count++;
};
setInterval(() => { for (const [k, e] of failures) if (Date.now() - e.first >= WINDOW) failures.delete(k); }, WINDOW).unref();

const str = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
const publicUser = (u) => ({ id: u.id, username: u.username, fullName: u.full_name, role: u.role, active: !!u.active, mustChangePassword: !!u.must_change_password });
const sign = (u) => jwt.sign({ sub: u.id, tv: u.token_version }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '12h' });

function auth(req, res, next) {
  const h = req.get('authorization') || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: 'UNAUTHENTICATED' });
  let p;
  try { p = jwt.verify(t, JWT_SECRET, { algorithms: ['HS256'] }); } catch { return res.status(401).json({ error: 'UNAUTHENTICATED' }); }
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(p.sub);
  if (!u || !u.active || u.token_version !== p.tv) return res.status(401).json({ error: 'UNAUTHENTICATED' });
  req.user = u;
  next();
}
const ready = (req, res, next) => (req.user.must_change_password ? res.status(403).json({ error: 'PASSWORD_CHANGE_REQUIRED' }) : next());
const need = (perm) => (req, res, next) => (can(req.user.role, perm) ? next() : res.status(403).json({ error: 'FORBIDDEN' }));

// ---------- المصادقة ----------
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!str(username, 1, 64) || typeof password !== 'string' || password.length > 200) return res.status(400).json({ error: 'BAD_REQUEST' });
  const key = `${req.ip}|${username.trim().toLowerCase()}`;
  if (isLimited(key)) return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS' });

  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  const ok = bcrypt.compareSync(password, u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok || !u.active) {
    noteFail(key);
    audit(u || null, 'فشل تسجيل الدخول', u ? null : `username=${username.trim().slice(0, 40)}`, req.ip);
    return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  }
  failures.delete(key);
  audit(u, 'تسجيل دخول', null, req.ip);
  res.json({ token: sign(u), user: publicUser(u) });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/auth/change-password', auth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') return res.status(400).json({ error: 'BAD_REQUEST' });
  if (!bcrypt.compareSync(currentPassword, req.user.password_hash)) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  if (newPassword.length < 8 || newPassword.length > 200 || newPassword === currentPassword) return res.status(400).json({ error: 'WEAK_PASSWORD' });
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, token_version = token_version + 1 WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, 10), req.user.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  audit(u, 'تغيير كلمة المرور', null, req.ip);
  res.json({ token: sign(u), user: publicUser(u) });
});

// ---------- المستخدمون ----------
app.get('/api/users/assignable', auth, ready, need('task.create'), (req, res) => {
  const roles = ASSIGNABLE[req.user.role] || [];
  if (!roles.length) return res.json({ users: [] });
  const ph = roles.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, full_name, role FROM users WHERE active = 1 AND role IN (${ph}) ORDER BY full_name`).all(...roles);
  res.json({ users: rows.map((r) => ({ id: r.id, fullName: r.full_name, role: r.role })) });
});

app.get('/api/users', auth, ready, need('user.manage'), (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY id').all();
  res.json({ users: rows.map(publicUser) });
});

app.post('/api/users', auth, ready, need('user.manage'), (req, res) => {
  const { username, fullName, role, password } = req.body || {};
  if (typeof username !== 'string' || !/^[a-z0-9._-]{3,32}$/i.test(username)) return res.status(400).json({ error: 'BAD_USERNAME' });
  if (!str(fullName, 2, 80)) return res.status(400).json({ error: 'BAD_NAME' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'BAD_ROLE' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) return res.status(400).json({ error: 'WEAK_PASSWORD' });
  try {
    const r = db.prepare('INSERT INTO users (username, full_name, role, password_hash, must_change_password, created_at) VALUES (?,?,?,?,1,?)')
      .run(username, fullName.trim(), role, bcrypt.hashSync(password, 10), now());
    audit(req.user, 'إنشاء مستخدم', `User #${r.lastInsertRowid} (${role})`, req.ip);
    res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'USERNAME_TAKEN' });
    throw e;
  }
});

app.patch('/api/users/:id', auth, ready, need('user.manage'), (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'NOT_FOUND' });
  const { active, resetPassword } = req.body || {};
  if (typeof active === 'boolean') {
    if (id === req.user.id && !active) return res.status(400).json({ error: 'CANNOT_DEACTIVATE_SELF' });
    db.prepare('UPDATE users SET active = ?, token_version = token_version + 1 WHERE id = ?').run(active ? 1 : 0, id);
    audit(req.user, active ? 'تفعيل مستخدم' : 'تعطيل مستخدم', `User #${id}`, req.ip);
  }
  if (resetPassword !== undefined) {
    if (typeof resetPassword !== 'string' || resetPassword.length < 8 || resetPassword.length > 200) return res.status(400).json({ error: 'WEAK_PASSWORD' });
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, token_version = token_version + 1 WHERE id = ?')
      .run(bcrypt.hashSync(resetPassword, 10), id);
    audit(req.user, 'إعادة تعيين كلمة مرور', `User #${id}`, req.ip);
  }
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
});

// ---------- المهام ----------
const TASK_SELECT = `SELECT t.*, a.full_name AS assignee_name, c.full_name AS creator_name
  FROM tasks t JOIN users a ON a.id = t.assigned_to JOIN users c ON c.id = t.created_by`;
const taskOut = (t) => ({
  id: t.id, title: t.title, description: t.description, type: t.type, priority: t.priority, status: t.status,
  assignedTo: t.assigned_to, assigneeName: t.assignee_name, createdBy: t.created_by, creatorName: t.creator_name,
  lat: t.lat, lng: t.lng, completionNote: t.completion_note, createdAt: t.created_at, updatedAt: t.updated_at, completedAt: t.completed_at,
});
const canSee = (u, t) => can(u.role, 'task.view_all') || t.assigned_to === u.id || t.created_by === u.id;

app.get('/api/tasks', auth, ready, (req, res) => {
  const rows = can(req.user.role, 'task.view_all')
    ? db.prepare(`${TASK_SELECT} ORDER BY t.id DESC LIMIT 500`).all()
    : db.prepare(`${TASK_SELECT} WHERE t.assigned_to = ? OR t.created_by = ? ORDER BY t.id DESC LIMIT 500`).all(req.user.id, req.user.id);
  res.json({ tasks: rows.map(taskOut) });
});

app.post('/api/tasks', auth, ready, need('task.create'), (req, res) => {
  const { title, description, type, priority, assignedTo } = req.body || {};
  if (!str(title, 3, 200)) return res.status(400).json({ error: 'BAD_TITLE' });
  if (description != null && (typeof description !== 'string' || description.length > 2000)) return res.status(400).json({ error: 'BAD_DESCRIPTION' });
  if (!TASK_TYPES.includes(type) || !TASK_PRIORITIES.includes(priority)) return res.status(400).json({ error: 'BAD_REQUEST' });
  const target = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(Number(assignedTo));
  if (!target || !(ASSIGNABLE[req.user.role] || []).includes(target.role)) return res.status(403).json({ error: 'CANNOT_ASSIGN_TO_THIS_USER' });
  const ts = now();
  const r = db.prepare(`INSERT INTO tasks (title, description, type, priority, status, assigned_to, created_by, created_at, updated_at)
    VALUES (?,?,?,?, 'NEW', ?,?,?,?)`).run(title.trim(), description ? description.trim() : null, type, priority, target.id, req.user.id, ts, ts);
  audit(req.user, `إسناد مهمة إلى ${target.full_name}`, `Task #${r.lastInsertRowid}`, req.ip);
  res.status(201).json({ task: taskOut(db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(r.lastInsertRowid)) });
});

app.patch('/api/tasks/:id/status', auth, ready, (req, res) => {
  const t = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(Number(req.params.id));
  if (!t || !canSee(req.user, t)) return res.status(404).json({ error: 'NOT_FOUND' });
  const { status, note } = req.body || {};
  if (note != null && (typeof note !== 'string' || note.length > 1000)) return res.status(400).json({ error: 'BAD_NOTE' });
  const isAssignee = t.assigned_to === req.user.id;
  const isManager = t.created_by === req.user.id || can(req.user.role, 'task.view_all');
  const open = t.status === 'NEW' || t.status === 'IN_PROGRESS';

  let allowed = false;
  if (status === 'IN_PROGRESS') allowed = isAssignee && t.status === 'NEW';
  else if (status === 'DONE') allowed = isAssignee && open;
  else if (status === 'CANCELLED') allowed = isManager && open;
  else return res.status(400).json({ error: 'BAD_STATUS' });
  if (!allowed) return res.status(open ? 403 : 409).json({ error: open ? 'FORBIDDEN' : 'INVALID_TRANSITION' });

  const ts = now();
  db.prepare('UPDATE tasks SET status = ?, completion_note = COALESCE(?, completion_note), updated_at = ?, completed_at = ? WHERE id = ?')
    .run(status, note ? note.trim() : null, ts, status === 'DONE' ? ts : t.completed_at, t.id);
  const label = { IN_PROGRESS: 'بدء تنفيذ مهمة', DONE: 'إنجاز مهمة', CANCELLED: 'إلغاء مهمة' }[status];
  audit(req.user, label, `Task #${t.id}`, req.ip);
  res.json({ task: taskOut(db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(t.id)) });
});

// ---------- سجل التدقيق ----------
app.get('/api/audit', auth, ready, need('audit.view'), (req, res) => {
  res.json({ logs: db.prepare('SELECT at, username, role, action, record FROM audit_logs ORDER BY id DESC LIMIT 200').all() });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'NOT_FOUND' }));

// واجهة الويب (اختياري): إن وُجد مجلد www بجانب الخادم يُقدَّم منه
const www = path.join(__dirname, '..', 'www');
if (fs.existsSync(www)) app.use(express.static(www));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'BAD_JSON' });
  console.error(err);
  res.status(500).json({ error: 'SERVER_ERROR' });
});

// ---------- أول تشغيل: إنشاء حساب المدير ----------
function bootstrap() {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;
  const username = process.env.ADMIN_USERNAME || 'director';
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  db.prepare("INSERT INTO users (username, full_name, role, password_hash, must_change_password, created_at) VALUES (?,?,?,?,1,?)")
    .run(username, 'مدير المديرية', 'DIRECTOR', bcrypt.hashSync(password, 10), now());
  console.log('==============================================');
  console.log(' تم إنشاء حساب المدير (لأول مرة فقط):');
  console.log(`   اسم المستخدم: ${username}`);
  console.log(`   كلمة المرور المؤقتة: ${process.env.ADMIN_PASSWORD ? '(من ADMIN_PASSWORD)' : password}`);
  console.log(' سيُطلب تغيير كلمة المرور عند أول دخول.');
  console.log('==============================================');
}

module.exports = { app, bootstrap };

if (require.main === module) {
  bootstrap();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`الخادم يعمل على المنفذ ${port}`));
}
