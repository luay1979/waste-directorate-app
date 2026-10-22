# منصة مديرية النظافة — المرحلة 1 (دخول + أدوار + مهام)

## 1) تشغيل الخادم محلياً (للتجربة)
يتطلب Node.js 22.13 أو أحدث.
```
cd server
npm install
npm start
```
عند أول تشغيل يطبع حساب المدير (`director`) وكلمة مرور مؤقتة؛ يُجبر على تغييرها عند أول دخول.
لإنشاء مستخدمين تجريبيين موسومين [DEMO]: `npm run seed:demo` (كلمة المرور Demo@12345) — وللحذف الكامل: `npm run seed:demo:remove`.
لإنشاء مستخدم من سطر الأوامر: `npm run create-user -- emp1 EMPLOYEE "اسم الموظف" كلمة_مؤقتة_قوية`.
الاختبار الآلي: `npm test`.

الأدوار: DIRECTOR, DEPT_HEAD, SECTOR_SUPERVISOR, MUNICIPALITY_SUPERVISOR, EMPLOYEE, DRIVER.

## 2) النشر على سيرفر المديرية
```
docker compose up -d --build
docker compose logs      # لرؤية كلمة مرور المدير المؤقتة
```
- ضع الخادم خلف HTTPS (Caddy أو nginx) ثم فعّل `TRUST_PROXY=1` في docker-compose.yml.
- البيانات في المجلد `/data` داخل الحاوية (volume باسم directorate-data): قاعدة `directorate.db` والملف `jwt_secret`. خذ منه نسخة احتياطية دورية.

## 3) بناء الـ APK
1. في GitHub: Settings ▸ Secrets and variables ▸ Actions ▸ **Variables** ▸ أنشئ `API_URL` بقيمة عنوان الخادم، مثل `https://your-domain.example`.
2. ارفع المشروع على الفرع `main` (أو شغّل Build Android APK يدوياً من Actions).
3. نزّل `waste-directorate-apk` من Artifacts.

إذا كان العنوان `http://` (شبكة داخلية بلا HTTPS) يضبط الـ workflow تلقائياً السماح بـ HTTP. يفضّل HTTPS دائماً.
