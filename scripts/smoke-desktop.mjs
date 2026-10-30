import { _electron as electron, expect } from '@playwright/test';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractAll } from '@electron/asar';

// Linux CI check with an isolated OS profile. Never touches a user's real workspace.
if (process.platform !== 'linux') throw new Error('This headless desktop smoke test is intended for Linux CI.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(path.join(os.tmpdir(), 'mada-desktop-test-'));
let app;
const errors = [];
const purchaseCollections = ['suppliers', 'purchases', 'supplierPayments'];
const readSnapshot = page => page.evaluate(async () => {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('mada-business-local', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('workspace', 'readonly');
      const request = transaction.objectStore('workspace').get('current');
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { database.close(); }
});
const writeSnapshot = (page, snapshot) => page.evaluate(async value => {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('mada-business-local', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('workspace', 'readwrite');
      transaction.objectStore('workspace').put(value, 'current');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { database.close(); }
}, snapshot);
const launch = async entry => {
  app = await electron.launch({ args: [entry, '--no-sandbox', '--headless', '--ozone-platform=headless', '--disable-gpu'], env: { ...process.env, XDG_CONFIG_HOME: path.join(temp, 'profile') }, timeout: 20000 });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('h1', { state: 'attached' });
  return page;
};
try {
  const page = await launch(path.join(root, 'desktop/main.cjs'));
  expect(await page.locator('h1').innerText()).toContain('كل تفاصيل أعمالك');
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  const originalDataPath = await app.evaluate(({ app }) => app.getPath('userData'));
  await page.locator('.sidebar').getByRole('button', { name: 'الإعدادات والتخصيص', exact: true }).click();
  await page.getByLabel('اسم الشركة', { exact: true }).fill('مصنع اختبار الحفظ المحلي');
  await page.getByRole('button', { name: 'حفظ التغييرات', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('تم حفظ');

  // Recreate a genuine v1.0.0 shape in the isolated profile: old records plus
  // a user-created text purchases section, without the new financial arrays.
  const legacy = await readSnapshot(page);
  for (const collection of purchaseCollections) delete legacy[collection];
  legacy.version = 1;
  legacy.demo = false;
  legacy.customers.push({ id: 'legacy-upgrade-customer', name: 'عميل محفوظ قبل تحديث المشتريات', phone: '01000000001', email: '', address: 'عنوان محفوظ قبل التحديث' });
  const legacyDate = new Date().toISOString().slice(0, 10);
  legacy.invoices.push({ id: 'legacy-upgrade-invoice', number: 'INV-LEGACY-UPGRADE-1', customerId: 'legacy-upgrade-customer', date: legacyDate, dueDate: legacyDate, items: [{ description: 'بند فاتورة محفوظ قبل تحديث المشتريات', quantity: 10, price: 125 }], taxRate: 14, discount: 0, notes: 'فاتورة ودفعة قديمتان يجب أن تظلا محفوظتين' });
  legacy.receipts.push({ id: 'legacy-upgrade-receipt', invoiceId: 'legacy-upgrade-invoice', customerId: 'legacy-upgrade-customer', amount: 500, date: legacyDate, method: 'cash', notes: 'دفعة محفوظة قبل التحديث' });
  legacy.modules.push({
    id: 'legacy-text-purchases', name: 'المشتريات', fields: ['البند', 'السعر', 'ملاحظات'],
    records: [{ id: 'legacy-purchase-record', values: { 'البند': 'ورق محفوظ في القسم النصي القديم', 'السعر': '1200.50', 'ملاحظات': 'يجب الحفاظ على السجل عند التحديث' } }],
  });
  await writeSnapshot(page, legacy);
  expect(await readSnapshot(page)).toEqual(legacy);
  await app.close(); app = undefined;
  const moved = path.join(temp, 'moved-app');
  await cp(path.join(root, 'dist'), path.join(moved, 'dist'), { recursive: true });
  await cp(path.join(root, 'desktop'), path.join(moved, 'desktop'), { recursive: true });
  const reopened = await launch(path.join(moved, 'desktop/main.cjs'));
  await expect(reopened.locator('.workspace-meta')).toContainText('مصنع اختبار الحفظ المحلي');
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(originalDataPath);
  await reopened.locator('.sidebar').getByRole('button', { name: 'العملاء', exact: true }).click();
  await expect(reopened.getByText('عميل محفوظ قبل تحديث المشتريات', { exact: true })).toBeVisible();
  // A built-in purchases page must never silently reinterpret or erase the
  // user's earlier custom text section with the same display name.
  await reopened.locator('.sidebar').getByRole('button', { name: 'المشتريات', exact: true }).last().click();
  await expect(reopened.getByRole('cell', { name: 'ورق محفوظ في القسم النصي القديم', exact: true })).toBeVisible();
  await reopened.locator('.sidebar').getByRole('button', { name: 'الإعدادات والتخصيص', exact: true }).click();
  await expect(reopened.getByLabel('اسم الشركة', { exact: true })).toHaveValue(legacy.settings.companyName);
  await reopened.getByRole('button', { name: 'حفظ التغييرات', exact: true }).click();
  await expect(reopened.getByRole('status')).toContainText('تم حفظ');
  const upgraded = await readSnapshot(reopened);
  expect(upgraded).toEqual({ ...legacy, version: 2, suppliers: [], purchases: [], supplierPayments: [] });
  await reopened.locator('.sidebar').getByRole('button', { name: /المبيعات والفواتير/ }).click();
  await reopened.getByRole('button', { name: 'عرض الفاتورة INV-LEGACY-UPGRADE-1', exact: true }).click();
  await expect(reopened.getByRole('cell', { name: 'بند فاتورة محفوظ قبل تحديث المشتريات', exact: true })).toBeVisible();
  const pdf = await app.evaluate(async ({ BrowserWindow }) => {
    const bytes = await BrowserWindow.getAllWindows()[0].webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    return bytes.length;
  });
  expect(pdf).toBeGreaterThan(1000);
  await app.close(); app = undefined;
  if (process.env.MADA_LEGACY_ASAR) {
    // Exercise the original released renderer against migrated data. Its
    // unsupported-version screen must appear before it can overwrite data.
    const oldInstall = path.join(temp, 'original-v1-app');
    extractAll(process.env.MADA_LEGACY_ASAR, oldInstall);
    const oldApp = await launch(path.join(oldInstall, 'desktop/main.cjs'));
    await expect(oldApp.getByRole('heading', { name: 'تعذر فتح مساحة العمل', exact: true })).toBeVisible();
    expect(await readSnapshot(oldApp)).toEqual(upgraded);
    await app.close(); app = undefined;
    console.log('Original v1 app rejects the newer schema without overwriting stored records.');
  }
  const finalRestart = await launch(path.join(moved, 'desktop/main.cjs'));
  expect(await readSnapshot(finalRestart)).toEqual(upgraded);
  expect(errors).toEqual([]);
  console.log('Desktop passed: offline assets, isolated renderer, exact legacy-data preservation through upgrade/restart/relocation, custom purchases retained, new purchases collections initialized, invoice PDF.');
} finally {
  if (app) await app.close();
  await rm(temp, { recursive: true, force: true });
}
