// يحوّل الملف الأصلي إلى نسخة تعمل محلياً داخل التطبيق (بدون CDN)
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const www = path.join(root, 'www');
const lib = path.join(www, 'lib');
const nm = (p) => path.join(root, 'node_modules', p);

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(lib, { recursive: true });

// 1) نسخ المكتبات محلياً
fs.cpSync(nm('leaflet/dist'), path.join(lib, 'leaflet'), { recursive: true });
fs.cpSync(nm('chart.js/dist'), path.join(lib, 'chartjs'), { recursive: true });
fs.cpSync(nm('@fortawesome/fontawesome-free/css'), path.join(lib, 'fa/css'), { recursive: true });
fs.cpSync(nm('@fortawesome/fontawesome-free/webfonts'), path.join(lib, 'fa/webfonts'), { recursive: true });
fs.cpSync(nm('@fontsource/cairo'), path.join(lib, 'cairo'), { recursive: true });

// 2) تعديل الـ HTML
let html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');

const fontCss = [300, 400, 600, 700, 800]
  .map((w) => `<link rel="stylesheet" href="lib/cairo/${w}.css">`).join('\n    ');

const rep = (re, to, label) => {
  if (!re.test(html)) throw new Error('لم يُعثر على: ' + label);
  html = html.replace(re, to);
};

rep(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/, '<link rel="stylesheet" href="lib/tailwind.css">', 'tailwind cdn');
rep(/<script>\s*tailwind\.config = \{[\s\S]*?\n    <\/script>/, '', 'tailwind.config');
rep(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/, fontCss, 'google fonts');
rep(/<link rel="stylesheet" href="https:\/\/cdnjs\.cloudflare\.com[^>]*font-awesome[^>]*>/, '<link rel="stylesheet" href="lib/fa/css/all.min.css">', 'font awesome');
rep(/https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.css/, 'lib/leaflet/leaflet.css', 'leaflet css');
rep(/https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.js/, 'lib/leaflet/leaflet.js', 'leaflet js');
rep(/https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js/, 'lib/chartjs/chart.umd.js', 'chart.js');

html = html.replace(
  'content="width=device-width, initial-scale=1.0"',
  'content="width=device-width, initial-scale=1.0, viewport-fit=cover"'
);

fs.writeFileSync(path.join(www, 'index.html'), html);

// عنوان الخادم (يُحقن وقت البناء): API_URL=https://example.org  — فارغ = نفس النطاق (عند تقديم الواجهة من الخادم نفسه)
const apiBase = (process.env.API_URL || '').trim().replace(/\/$/, '');
fs.writeFileSync(path.join(www, 'config.js'), 'window.APP_CONFIG = ' + JSON.stringify({ API_BASE: apiBase }) + ';\n');

// 3) بناء Tailwind CSS
execSync(
  'npx tailwindcss -c tailwind.config.js -i src/input.css -o www/lib/tailwind.css --minify',
  { cwd: root, stdio: 'inherit' }
);

console.log('✔ www جاهز');
