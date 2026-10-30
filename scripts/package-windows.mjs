import { packager } from '@electron/packager';
import { initializeProxy } from '@electron/get';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const electron = JSON.parse(await readFile(path.join(root, 'node_modules/electron/package.json'), 'utf8'));
const output = path.join(root, 'release');
const stage = await mkdtemp(path.join(os.tmpdir(), 'mada-windows-'));

try {
  await readFile(path.join(root, 'dist/index.html'));
  await mkdir(path.join(stage, 'desktop'), { recursive: true });
  await cp(path.join(root, 'dist'), path.join(stage, 'dist'), { recursive: true });
  await cp(path.join(root, 'desktop/main.cjs'), path.join(stage, 'desktop/main.cjs'));
  await cp(path.join(root, 'desktop/icon.png'), path.join(stage, 'desktop/icon.png'));
  await writeFile(path.join(stage, 'package.json'), JSON.stringify({
    name: 'mada-business-suite', productName: 'Mada', version: metadata.version,
    description: 'Mada local business management', main: 'desktop/main.cjs',
  }, null, 2));
  // Respect the platform proxy and CA configuration; do not relax TLS or checksums.
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) initializeProxy();
  const [bundle] = await packager({
    dir: stage,
    out: output,
    name: 'Mada',
    executableName: 'Mada',
    platform: 'win32',
    arch: 'x64',
    electronVersion: electron.version,
    appVersion: metadata.version,
    appCopyright: 'Mada',
    icon: path.join(root, 'desktop/icon.ico'),
    overwrite: true,
    prune: true,
    asar: true,
    win32metadata: { CompanyName: 'Mada', FileDescription: 'Mada business management', ProductName: 'Mada' },
  });
  const guide = `مدى — إدارة أعمالك محليًا\n\nالتشغيل على Windows 10 أو 11 بنواة 64 بت:\n1. فك ضغط الملف بالكامل في مجلد على جهازك.\n2. افتح المجلد وشغّل Mada.exe.\n3. لا تنقل ملف Mada.exe منفردًا؛ يحتاج الملفات الموجودة بجانبه.\n\nلا تحتاج Node.js أو متصفحًا أو اتصالًا بالإنترنت لتشغيل هذه النسخة.\nتُحفظ البيانات محليًا ضمن مجلد بيانات المستخدم: %APPDATA%\\Mada\nالمجلد يحتوي أيضًا إعدادات المتصفح المدمج؛ لا تحذف محتوياته.\n\nالبدء:\nالبيانات الأولى تجريبية. من الإعدادات ← البيانات والنسخ الاحتياطي،\nاختر «البدء بمساحة فارغة»، ثم أضف بيانات شركتك وعملاءك ومعدّاتك.\nأنشئ فاتورة، وسجّل القبض والمصروفات؛ تتحدث المؤشرات تلقائيًا.\n\nالنسخ الاحتياطي:\nالإعدادات ← البيانات والنسخ الاحتياطي ← تنزيل نسخة احتياطية.\nاحفظ الملف خارج مجلد البرنامج بانتظام، ويمكن استرجاعه على جهاز آخر.\nالفواتير المطبوعة تنظيمية وليست تكاملًا مع منظومة الفاتورة الإلكترونية.\nراجع دليل README داخل المشروع لتفاصيل الاستخدام وحدود النسخة.\n`;
  const updateGuide = '\nالتحديث من الإصدار السابق:\nاحفظ نسخة احتياطية ثم أغلق البرنامج القديم تمامًا. افتح الإصدار الجديد تحت نفس حساب ويندوز؛ بياناتك القديمة تُقرأ من نفس المجلد تلقائيًا. لا تختَر البدء بمساحة فارغة أثناء التحديث. استخدم الإصدار الجديد بعد الترقية.\n\nالمشتريات:\nأضف المورد من الموردون، ثم أنشئ فاتورة من المشتريات مع الكمية والسعر والوحدة والخصم والضريبة. سجّل الدفعات للمورد من تفاصيل الفاتورة؛ تُحتسب في التدفق النقدي مرة واحدة. الأقسام القديمة محفوظة ولم تُحوّل تلقائيًا إلى فواتير.\n';
  await writeFile(path.join(bundle, 'دليل التشغيل.txt'), updateGuide + guide, 'utf8');
  const zipName = `Mada-Windows-x64-v${metadata.version}.zip`;
  const zipPath = path.join(output, zipName);
  // Python is available in the build environment; stdlib zipfile preserves directory structure.
  const python = process.env.PYTHON_FOR_BUILD || (process.platform === 'win32' ? 'python' : 'python3');
  const zipped = spawnSync(python, ['-c',
    'import pathlib,sys,zipfile\nsource=pathlib.Path(sys.argv[1]); target=pathlib.Path(sys.argv[2])\nwith zipfile.ZipFile(target,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:\n for file in sorted(source.rglob("*")):\n  if file.is_file(): archive.write(file,file.relative_to(source.parent))\n',
    bundle, zipPath], { stdio: 'inherit' });
  if (zipped.error) throw zipped.error;
  if (zipped.status !== 0) throw new Error(`ZIP creation failed with status ${zipped.status}`);
  console.log(`Windows application: ${bundle}`);
  console.log(`Portable ZIP: ${zipPath}`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
