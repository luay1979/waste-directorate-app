// الصلاحية = الإجراء المسموح. تُفرض هنا في الخادم فقط (الواجهة للعرض فقط).
const ROLES = ['DIRECTOR', 'DEPT_HEAD', 'SECTOR_SUPERVISOR', 'MUNICIPALITY_SUPERVISOR', 'EMPLOYEE', 'DRIVER'];

const PERMS = {
  'task.create': ['DIRECTOR', 'DEPT_HEAD', 'SECTOR_SUPERVISOR'],
  'task.view_all': ['DIRECTOR'],
  'user.manage': ['DIRECTOR'],
  'audit.view': ['DIRECTOR'],
};

// من يستطيع إسناد مهام إلى أي دور (التسلسل: مدير ← رؤساء أقسام ← مشرفو قطاعات ← مشرفو بلديات ← موظفون/سائقون)
const ASSIGNABLE = {
  DIRECTOR: ['DEPT_HEAD', 'SECTOR_SUPERVISOR', 'MUNICIPALITY_SUPERVISOR', 'EMPLOYEE', 'DRIVER'],
  DEPT_HEAD: ['EMPLOYEE', 'DRIVER'],
  SECTOR_SUPERVISOR: ['MUNICIPALITY_SUPERVISOR', 'EMPLOYEE', 'DRIVER'],
};

const TASK_TYPES = ['FIELD', 'INSPECTION', 'CAMPAIGN', 'COMPLAINT_FOLLOWUP'];
const TASK_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'];
const TASK_STATUSES = ['NEW', 'IN_PROGRESS', 'DONE', 'CANCELLED'];

const can = (role, perm) => (PERMS[perm] || []).includes(role);

module.exports = { ROLES, PERMS, ASSIGNABLE, TASK_TYPES, TASK_PRIORITIES, TASK_STATUSES, can };
