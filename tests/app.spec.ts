import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function navigate(page: Page, label: string) {
  await page.locator('.sidebar').getByRole('button', { name: new RegExp(`^${label}(?:\\s+[0-9٠-٩]+)?$`) }).click();
}

async function openSettingsTab(page: Page, label: string) {
  await navigate(page, 'الإعدادات والتخصيص');
  await page.getByRole('tab', { name: label, exact: true }).click();
}

async function persistedData(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mada-business-local', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<any>((resolve, reject) => {
        const request = db.transaction('workspace', 'readonly').objectStore('workspace').get('current');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /كل تفاصيل أعمالك/ })).toBeVisible();
});

test('dashboard renders real data without runtime errors and adapts to mobile', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'المبيعات والمدفوعات', exact: true })).toBeVisible();
  await expect(page.locator('.recent-table tbody tr')).toHaveCount(5);
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/dashboard.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'فتح القائمة', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'فتح القائمة', exact: true }).click();
  await expect(page.locator('.sidebar')).toHaveClass(/open/);
  await navigate(page, 'الماكينات');
  await expect(page.getByRole('heading', { name: 'الماكينات والمعدات', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('invoice calculation, partial collection and balance persist after reload', async ({ page }) => {
  await page.getByRole('button', { name: 'فاتورة جديدة', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'فاتورة جديدة', exact: true });
  await editor.getByRole('combobox', { name: /^العميل/ }).selectOption({ index: 1 });
  await editor.getByLabel('وصف البند 1', { exact: true }).fill('اختبار خدمة تكسير الورق');
  await editor.getByLabel('كمية البند 1', { exact: true }).fill('2');
  await editor.getByLabel('سعر البند 1', { exact: true }).fill('125');
  await editor.getByLabel('الضريبة (%)', { exact: true }).fill('14');
  await editor.getByLabel('خصم ثابت', { exact: true }).fill('10');
  await expect(editor.locator('.invoice-total-strip')).toContainText('273.6');
  await editor.getByRole('button', { name: 'حفظ الفاتورة', exact: true }).click();
  const view = page.getByRole('dialog', { name: 'تفاصيل الفاتورة', exact: true });
  await expect(view).toBeVisible();
  const number = (await view.locator('.invoice-document-number strong').innerText()).trim();
  await expect(view.getByRole('button', { name: 'طباعة / PDF', exact: true })).toBeVisible();
  await view.getByRole('button', { name: 'إغلاق', exact: true }).click();
  await navigate(page, 'المقبوضات');
  await page.getByRole('button', { name: 'إضافة سند قبض', exact: true }).click();
  const receipt = page.getByRole('dialog', { name: 'إضافة سند قبض', exact: true });
  const invoiceSelect = receipt.getByRole('combobox', { name: /^الفاتورة/ });
  const value = await invoiceSelect.locator('option').filter({ hasText: number }).getAttribute('value');
  expect(value).toBeTruthy();
  await invoiceSelect.selectOption(value!);
  const amount = receipt.getByLabel('المبلغ المحصل *', { exact: true });
  await expect(amount).toHaveValue('273.6');
  await amount.fill('274');
  expect(await amount.evaluate(input => (input as HTMLInputElement).validity.rangeOverflow)).toBe(true);
  await amount.fill('100');
  await receipt.getByRole('combobox', { name: /^طريقة القبض/ }).selectOption('bank');
  await receipt.getByRole('button', { name: 'حفظ سند قبض', exact: true }).click();
  await expect(receipt).not.toBeVisible();
  await page.reload();
  await navigate(page, 'المبيعات والفواتير');
  const invoiceRow = page.getByRole('row').filter({ hasText: number });
  await expect(invoiceRow).toContainText('مدفوعة جزئيًا');
  await invoiceRow.getByRole('button', { name: `عرض الفاتورة ${number}` }).click();
  await expect(page.locator('.invoice-totals')).toContainText('173.6');
  const saved = await persistedData(page);
  const invoice = saved.invoices.find((item: any) => item.number === number);
  expect(invoice.items[0]).toEqual({ description: 'اختبار خدمة تكسير الورق', quantity: 2, price: 125 });
  expect(saved.receipts.find((item: any) => item.invoiceId === invoice.id).amount).toBe(100);
});

test('invoice corrections preserve identity, confirm deletion and protect collected amounts', async ({ page }) => {
  await page.getByRole('button', { name: 'فاتورة جديدة', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'فاتورة جديدة', exact: true });
  await create.getByRole('combobox', { name: /^العميل/ }).selectOption({ index: 1 });
  await create.getByLabel('وصف البند 1', { exact: true }).fill('خدمة قابلة للتصحيح');
  await create.getByLabel('سعر البند 1', { exact: true }).fill('200');
  await create.getByLabel('الضريبة (%)', { exact: true }).fill('0');
  await create.getByRole('button', { name: 'حفظ الفاتورة', exact: true }).click();
  const view = page.getByRole('dialog', { name: 'تفاصيل الفاتورة', exact: true });
  const number = (await view.locator('.invoice-document-number strong').innerText()).trim();
  const original = (await persistedData(page)).invoices.find((invoice: any) => invoice.number === number);
  await view.getByRole('button', { name: 'إغلاق', exact: true }).click();
  await page.getByRole('button', { name: `تعديل الفاتورة ${number}`, exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'تعديل الفاتورة', exact: true });
  await edit.getByLabel('سعر البند 1', { exact: true }).fill('150');
  await edit.getByLabel('ملاحظات للعميل', { exact: true }).fill('تصحيح سعر الخدمة');
  await edit.getByRole('button', { name: 'حفظ التعديلات', exact: true }).click();
  await expect(view).toBeVisible();
  const corrected = (await persistedData(page)).invoices.find((invoice: any) => invoice.number === number);
  expect(corrected.id).toBe(original.id);
  expect(corrected.items[0].price).toBe(150);
  expect(corrected.notes).toBe('تصحيح سعر الخدمة');
  await view.getByRole('button', { name: 'إغلاق', exact: true }).click();
  await page.getByRole('button', { name: `حذف الفاتورة ${number}`, exact: true }).click();
  const deletion = page.getByRole('dialog', { name: 'حذف الفاتورة', exact: true });
  await expect(deletion).toBeVisible();
  expect((await persistedData(page)).invoices.some((invoice: any) => invoice.id === original.id)).toBe(true);
  await deletion.getByRole('button', { name: 'تأكيد حذف الفاتورة', exact: true }).click();
  await expect(deletion).not.toBeVisible();
  expect((await persistedData(page)).invoices.some((invoice: any) => invoice.id === original.id)).toBe(false);

  const stored = await persistedData(page);
  const paid = stored.invoices.find((invoice: any) => stored.receipts.some((receipt: any) => receipt.invoiceId === invoice.id && receipt.amount > 1));
  expect(paid).toBeTruthy();
  await page.getByRole('button', { name: `تعديل الفاتورة ${paid.number}`, exact: true }).click();
  await expect(edit.getByRole('combobox', { name: 'العميل', exact: true })).toBeDisabled();
  await edit.getByLabel('سعر البند 1', { exact: true }).fill('1');
  await edit.getByLabel('الضريبة (%)', { exact: true }).fill('0');
  await edit.getByRole('button', { name: 'حفظ التعديلات', exact: true }).click();
  await expect(edit.getByRole('alert')).toContainText('لا يمكن أن يقل إجمالي الفاتورة عن المبلغ المحصل');
  expect((await persistedData(page)).invoices.find((invoice: any) => invoice.id === paid.id)).toEqual(paid);
  await edit.getByRole('button', { name: 'إلغاء', exact: true }).click();
  await page.getByRole('button', { name: `حذف الفاتورة ${paid.number}`, exact: true }).click();
  await expect(deletion.getByRole('alert')).toContainText('لا يمكن حذف فاتورة مرتبطة بسندات قبض');
  await expect(deletion.getByRole('button', { name: 'تأكيد حذف الفاتورة', exact: true })).toBeDisabled();
});

test('machine and completed production order retain quantities and reject excess waste', async ({ page }) => {
  await navigate(page, 'الماكينات');
  await page.getByRole('button', { name: 'إضافة ماكينة', exact: true }).click();
  const machine = page.getByRole('dialog', { name: 'إضافة ماكينة جديدة', exact: true });
  await machine.getByLabel('اسم الماكينة *', { exact: true }).fill('ماكينة اختبار التشغيل');
  await machine.getByLabel('كود الماكينة *', { exact: true }).fill('QA-MC-101');
  await machine.getByLabel('نوع الماكينة / النشاط *', { exact: true }).fill('تكسير ورق');
  await machine.getByLabel('تكلفة ساعة التشغيل', { exact: false }).fill('250');
  await machine.getByRole('button', { name: 'حفظ الماكينة', exact: true }).click();
  await expect(machine).not.toBeVisible();
  await navigate(page, 'أوامر التشغيل');
  await page.getByRole('button', { name: 'أمر تشغيل جديد', exact: true }).click();
  const order = page.getByRole('dialog', { name: 'أمر تشغيل جديد', exact: true });
  const orderNumber = await order.getByLabel('رقم أمر التشغيل', { exact: true }).inputValue();
  await order.getByLabel('اسم العمل / المنتج *', { exact: true }).fill('تكسير مائة ورقة اختبار');
  const machineSelect = order.getByRole('combobox', { name: /^الماكينة/ });
  const machineValue = await machineSelect.locator('option').filter({ hasText: 'ماكينة اختبار التشغيل' }).getAttribute('value');
  await machineSelect.selectOption(machineValue!);
  await order.getByLabel('الكمية المطلوبة *', { exact: true }).fill('100');
  await order.getByLabel('الكمية المنفذة', { exact: true }).fill('95');
  await order.getByLabel('كمية الهالك', { exact: true }).fill('5');
  await order.getByRole('combobox', { name: /^حالة التشغيل/ }).selectOption('done');
  await order.getByRole('button', { name: 'حفظ أمر التشغيل', exact: true }).click();
  await expect(order).not.toBeVisible();
  await page.reload();
  await navigate(page, 'أوامر التشغيل');
  const row = page.getByRole('row').filter({ hasText: orderNumber });
  await expect(row).toContainText('مكتمل');
  await expect(row).toContainText('ماكينة اختبار التشغيل');
  await row.getByRole('button', { name: `تعديل ${orderNumber}`, exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'تحديث أمر التشغيل', exact: true });
  await edit.getByLabel('الكمية المنفذة', { exact: true }).fill('96');
  await edit.getByRole('button', { name: 'حفظ أمر التشغيل', exact: true }).click();
  await expect(edit.getByRole('alert')).toContainText('لا يمكن أن يتجاوز');
  const saved = await persistedData(page);
  expect(saved.productionOrders.find((item: any) => item.number === orderNumber).completedQuantity).toBe(95);
});

test('custom section schema and records persist without a code change', async ({ page }) => {
  await openSettingsTab(page, 'الأقسام والإضافات');
  await page.getByRole('button', { name: 'إضافة قسم جديد', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'إضافة قسم مخصص', exact: true });
  await dialog.getByLabel('اسم القسم', { exact: true }).fill('مورّدو الاختبار');
  await dialog.getByRole('textbox', { name: /^الحقل 1/ }).fill('اسم المورد');
  await dialog.getByRole('textbox', { name: /^الحقل 2/ }).fill('رقم التواصل');
  await dialog.getByRole('button', { name: 'إنشاء القسم', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await navigate(page, 'مورّدو الاختبار');
  await page.getByRole('button', { name: 'إضافة سجل', exact: true }).click();
  const record = page.getByRole('dialog', { name: 'إضافة سجل جديد', exact: true });
  await record.getByLabel('اسم المورد', { exact: true }).fill('شركة الورق الممتاز');
  await record.getByLabel('رقم التواصل', { exact: true }).fill('01000000001');
  await record.getByRole('button', { name: 'حفظ السجل', exact: true }).click();
  await expect(record).not.toBeVisible();
  await page.reload();
  await navigate(page, 'مورّدو الاختبار');
  await expect(page.getByRole('row').filter({ hasText: 'شركة الورق الممتاز' })).toContainText('01000000001');
  const saved = await persistedData(page);
  expect(saved.modules.find((item: any) => item.name === 'مورّدو الاختبار').fields).toEqual(['اسم المورد', 'رقم التواصل']);
});

test('full backup survives workspace reset and import restores all collections', async ({ page }, testInfo) => {
  const before = await persistedData(page);
  await openSettingsTab(page, 'البيانات والنسخ الاحتياطي');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'تنزيل نسخة احتياطية', exact: true }).click();
  const download = await downloadPromise;
  const backupPath = testInfo.outputPath('mada-backup.json');
  await download.saveAs(backupPath);
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  expect(backup).toEqual(before);
  await page.getByRole('button', { name: 'البدء بمساحة فارغة', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'تأكيد الاستبدال', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const empty = await persistedData(page);
  expect(empty.customers).toHaveLength(0);
  expect(empty.productionOrders).toHaveLength(0);
  expect(empty.demo).toBe(false);
  await page.getByLabel('ملف النسخة الاحتياطية', { exact: true }).setInputFiles(backupPath);
  await expect(page.getByRole('dialog', { name: 'استرجاع النسخة الاحتياطية', exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'تأكيد الاستبدال', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  expect(await persistedData(page)).toEqual(before);
});
