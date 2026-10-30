import { _electron as electron, expect } from '@playwright/test';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Linux CI check with an isolated OS profile. Never touches a user's real workspace.
if (process.platform !== 'linux') throw new Error('This headless desktop smoke test is intended for Linux CI.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(path.join(os.tmpdir(), 'mada-desktop-test-'));
let app;
const launch = async entry => {
  app = await electron.launch({ args: [entry, '--no-sandbox', '--headless', '--ozone-platform=headless', '--disable-gpu'], env: { ...process.env, XDG_CONFIG_HOME: path.join(temp, 'profile') }, timeout: 20000 });
  const page = await app.firstWindow();
  await page.waitForSelector('h1', { state: 'attached' });
  return page;
};
try {
  const page = await launch(path.join(root, 'desktop/main.cjs'));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  expect(await page.locator('h1').innerText()).toContain('كل تفاصيل أعمالك');
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  await page.locator('.sidebar').getByRole('button', { name: 'الإعدادات والتخصيص', exact: true }).click();
  await page.getByLabel('اسم الشركة', { exact: true }).fill('مصنع اختبار الحفظ المحلي');
  await page.getByRole('button', { name: 'حفظ التغييرات', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('تم حفظ');
  await app.close(); app = undefined;
  const moved = path.join(temp, 'moved-app');
  await cp(path.join(root, 'dist'), path.join(moved, 'dist'), { recursive: true });
  await cp(path.join(root, 'desktop'), path.join(moved, 'desktop'), { recursive: true });
  const reopened = await launch(path.join(moved, 'desktop/main.cjs'));
  await expect(reopened.locator('.workspace-meta')).toContainText('مصنع اختبار الحفظ المحلي');
  await reopened.locator('.sidebar').getByRole('button', { name: /المبيعات والفواتير/ }).click();
  await reopened.getByRole('button', { name: /عرض الفاتورة/ }).first().click();
  const pdf = await app.evaluate(async ({ BrowserWindow }) => {
    const bytes = await BrowserWindow.getAllWindows()[0].webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    return bytes.length;
  });
  expect(pdf).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
  console.log('Desktop passed: bundled offline assets, isolated renderer, persisted data after restart and relocation, invoice PDF.');
} finally {
  if (app) await app.close();
  await rm(temp, { recursive: true, force: true });
}
