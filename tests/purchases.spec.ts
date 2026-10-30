import { test, expect, type Page, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function navigate(page: Page, label: string) {
  await page.locator('.sidebar').getByRole('button', { name: new RegExp(`^${label}(?:\\s+مخصص)?$`) }).click();
}
async function storedData(page: Page) {
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
async function storeLegacyData(page: Page, legacy: unknown) {
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mada-business-local', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('workspace', 'readwrite');
        transaction.objectStore('workspace').put(value, 'current');
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
  }, legacy);
}
async function createSupplier(page: Page) {
  await navigate(page, 'الموردون');
  await page.locator('.page-heading').getByRole('button', { name: 'إضافة مورد', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'إضافة مورد جديد', exact: true });
  await editor.getByLabel('اسم المورد', { exact: true }).fill('شركة ورق الاختبار');
  await editor.getByLabel('رقم هاتف المورد', { exact: true }).fill('01000000991');
  await editor.getByLabel('الرقم الضريبي للمورد', { exact: true }).fill('123456789');
  await editor.getByRole('button', { name: 'حفظ المورد', exact: true }).click();
  await expect(editor).not.toBeVisible();
  return (await storedData(page)).suppliers.find((supplier: any) => supplier.name === 'شركة ورق الاختبار');
}
async function fillPurchase(editor: Locator, supplierId: string, initialPayment = '0') {
  await editor.getByRole('combobox', { name: 'المورد', exact: true }).selectOption(supplierId);
  await editor.getByLabel('رقم فاتورة المورد', { exact: true }).fill('SUP-TEST-101');
  await editor.getByLabel('وصف صنف 1', { exact: true }).fill('ورق دوبلكس لاختبار المشتريات');
  await editor.getByLabel('وحدة صنف 1', { exact: true }).selectOption('كيلوجرام');
  await editor.getByLabel('كمية صنف 1', { exact: true }).fill('2');
  await editor.getByLabel('سعر صنف 1', { exact: true }).fill('125');
  await editor.getByLabel('ضريبة المشتريات (%)', { exact: true }).fill('14');
  await editor.getByLabel('خصم المشتريات', { exact: true }).fill('10');
  await editor.getByLabel('دفعة أولى عند الشراء', { exact: true }).fill(initialPayment);
}
async function createPurchase(page: Page, supplierId: string, initialPayment = '0') {
  await navigate(page, 'المشتريات');
  await page.getByRole('button', { name: 'فاتورة شراء جديدة', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'فاتورة شراء جديدة', exact: true });
  await fillPurchase(editor, supplierId, initialPayment);
  await expect(editor.locator('.invoice-total-strip')).toContainText('273.6');
  await editor.getByRole('button', { name: 'حفظ فاتورة الشراء', exact: true }).click();
  const view = page.getByRole('dialog', { name: 'تفاصيل فاتورة الشراء', exact: true });
  await expect(view).toBeVisible();
  const purchase = (await storedData(page)).purchases.find((purchase: any) => purchase.supplierInvoiceNumber === 'SUP-TEST-101');
  return { view, purchase };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /كل تفاصيل أعمالك/ })).toBeVisible();
});

test('real numeric purchases, initial supplier payment and final settlement persist without duplicate expenses', async ({ page }, testInfo) => {
  const before = await storedData(page);
  const supplier = await createSupplier(page);
  const { view, purchase } = await createPurchase(page, supplier.id, '100');
  await expect(view.locator('.invoice-totals')).toContainText('173.6');
  await expect(view).toContainText('مدفوعة جزئيًا');
  await page.screenshot({ path: testInfo.outputPath('purchase-invoice.png'), fullPage: true });
  await view.getByRole('button', { name: 'تسجيل دفعة للمورد', exact: true }).click();
  const payment = page.getByRole('dialog', { name: 'تسجيل دفعة للمورد', exact: true });
  const amount = payment.getByLabel('المبلغ المدفوع', { exact: true });
  await expect(amount).toHaveValue('173.6');
  await amount.fill('173.61');
  expect(await amount.evaluate(input => (input as HTMLInputElement).validity.rangeOverflow)).toBe(true);
  await payment.getByRole('button', { name: 'حفظ دفعة المورد', exact: true }).click();
  await expect(payment).toBeVisible();
  expect((await storedData(page)).supplierPayments).toHaveLength(1);
  await amount.fill('173.60');
  await payment.getByRole('button', { name: 'حفظ دفعة المورد', exact: true }).click();
  await expect(payment).not.toBeVisible();
  await expect(view).toContainText('مدفوعة');
  await expect(view.getByRole('button', { name: 'تسجيل دفعة للمورد', exact: true })).toBeDisabled();
  await page.reload();
  await navigate(page, 'المشتريات');
  const row = page.getByRole('row').filter({ hasText: purchase.number });
  await expect(row).toContainText('مدفوعة');
  await expect(row).toContainText('273.6');
  const saved = await storedData(page);
  const payments = saved.supplierPayments.filter((entry: any) => entry.purchaseId === purchase.id);
  expect(payments.map((entry: any) => entry.amount).sort((a: number, b: number) => a - b)).toEqual([100, 173.6]);
  expect(saved.expenses).toEqual(before.expenses);
  expect(saved.receipts).toEqual(before.receipts);
  expect(saved.purchases[0].items[0]).toEqual({ description: 'ورق دوبلكس لاختبار المشتريات', unit: 'كيلوجرام', quantity: 2, price: 125 });
});

test('purchase edits retain identity and protect supplier payments and linked supplier history', async ({ page }) => {
  const supplier = await createSupplier(page);
  const { view, purchase } = await createPurchase(page, supplier.id, '100');
  await view.getByRole('button', { name: 'إغلاق', exact: true }).first().click();
  await page.getByRole('button', { name: `تعديل فاتورة الشراء ${purchase.number}`, exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'تعديل فاتورة الشراء', exact: true });
  await expect(editor.getByRole('combobox', { name: 'المورد', exact: true })).toBeDisabled();
  await editor.getByLabel('سعر صنف 1', { exact: true }).fill('1');
  await editor.getByLabel('خصم المشتريات', { exact: true }).fill('0');
  await editor.getByRole('button', { name: 'حفظ تعديلات الشراء', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('المدفوع');
  expect((await storedData(page)).purchases.find((entry: any) => entry.id === purchase.id)).toEqual(purchase);
  await editor.getByLabel('سعر صنف 1', { exact: true }).fill('150');
  await editor.getByLabel('خصم المشتريات', { exact: true }).fill('10');
  await editor.getByRole('button', { name: 'حفظ تعديلات الشراء', exact: true }).click();
  await expect(view).toBeVisible();
  const corrected = (await storedData(page)).purchases.find((entry: any) => entry.id === purchase.id);
  expect(corrected.number).toBe(purchase.number);
  expect(corrected.items[0].price).toBe(150);
  await view.getByRole('button', { name: 'إغلاق', exact: true }).first().click();
  await page.getByRole('button', { name: `حذف فاتورة الشراء ${purchase.number}`, exact: true }).click();
  const deletion = page.getByRole('dialog', { name: 'حذف فاتورة الشراء', exact: true });
  await expect(deletion.getByRole('button', { name: 'تأكيد الحذف', exact: true })).toBeDisabled();
  await deletion.getByRole('button', { name: 'إلغاء', exact: true }).click();
  await navigate(page, 'الموردون');
  await page.getByRole('row').filter({ hasText: supplier.name }).getByRole('button', { name: `حذف المورد ${supplier.name}`, exact: true }).click();
  const deleteSupplier = page.getByRole('dialog', { name: 'حذف المورد', exact: true });
  await expect(deleteSupplier.getByRole('button', { name: 'تأكيد حذف المورد', exact: true })).toBeDisabled();
});

test('supplier account statement prints invoice, payment and balance from stored records', async ({ page }, testInfo) => {
  const supplier = await createSupplier(page);
  const { view, purchase } = await createPurchase(page, supplier.id, '100');
  await view.getByRole('button', { name: 'إغلاق', exact: true }).first().click();
  await page.reload();
  await navigate(page, 'الموردون');
  await page.getByRole('row').filter({ hasText: supplier.name }).getByRole('button', { name: `كشف حساب ${supplier.name}`, exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'كشف حساب المورد', exact: true })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  const document = page.locator('.print-invoice');
  await expect(document).toBeVisible();
  for (const text of ['شركة ورق الاختبار', 'مصنع الأفق للورق', purchase.number, '273.6', '100', '173.6']) await expect(document).toContainText(text);
  await expect(page.locator('.sidebar')).toBeHidden();
  expect(await page.locator('body').innerText()).not.toContain('الإعدادات والتخصيص');
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.length).toBeGreaterThan(1000);
  await testInfo.attach('supplier-statement.pdf', { body: pdf, contentType: 'application/pdf' });
});

test('legacy v1 workspace migrates without losing invoices or custom text sections and restores a compatible backup', async ({ page }, testInfo) => {
  const before = await storedData(page);
  const legacy = { ...before, version: 1 };
  delete legacy.suppliers; delete legacy.purchases; delete legacy.supplierPayments;
  legacy.modules = [{ id: 'legacy-purchase-text', name: 'مشتريات قديمة', fields: ['البيان', 'السعر المكتوب'], records: [{ id: 'legacy-row', values: { 'البيان': 'سجل نصي قديم محفوظ', 'السعر المكتوب': '500' } }] }];
  await storeLegacyData(page, legacy);
  await page.reload();
  await expect(page.getByRole('heading', { name: /كل تفاصيل أعمالك/ })).toBeVisible();
  await navigate(page, 'مشتريات قديمة');
  await expect(page.getByRole('row').filter({ hasText: 'سجل نصي قديم محفوظ' })).toContainText('500');
  await navigate(page, 'المشتريات');
  await expect(page.getByRole('heading', { name: /المشتريات/ })).toBeVisible();
  await expect(page.locator('.data-table tbody tr')).toHaveCount(0);
  await navigate(page, 'الإعدادات والتخصيص');
  await page.getByRole('tab', { name: 'البيانات والنسخ الاحتياطي', exact: true }).click();
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'تنزيل نسخة احتياطية', exact: true }).click();
  const download = await promise;
  const path = testInfo.outputPath('migrated-backup.json');
  await download.saveAs(path);
  const migrated = JSON.parse(await readFile(path, 'utf8'));
  expect(migrated.invoices).toEqual(before.invoices);
  expect(migrated.customers).toEqual(before.customers);
  expect(migrated.modules).toEqual(legacy.modules);
  expect(migrated.suppliers).toEqual([]);
  expect(migrated.purchases).toEqual([]);
  expect(migrated.supplierPayments).toEqual([]);
  await page.getByLabel('ملف النسخة الاحتياطية', { exact: true }).setInputFiles({ name: 'old-v1-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
  const restore = page.getByRole('dialog', { name: 'استرجاع النسخة الاحتياطية', exact: true });
  await expect(restore).toBeVisible();
  await restore.getByRole('button', { name: 'تأكيد الاستبدال', exact: true }).click();
  await expect(restore).not.toBeVisible();
  expect(await storedData(page)).toEqual(migrated);
});


test('credit purchase changes supplier liability immediately and cash flow only when paid once', async ({ page }) => {
  await navigate(page, 'التقارير والتحليلات');
  const outgoing = page.locator('.kpi-card').filter({ has: page.locator('.kpi-label').filter({ hasText: /^المدفوعات$/ }) }).locator('.kpi-value');
  const baseline = await outgoing.innerText();
  const before = await storedData(page);
  const supplier = await createSupplier(page);
  const { view, purchase } = await createPurchase(page, supplier.id);
  await expect(view.locator('.invoice-totals')).toContainText('273.6');
  expect((await storedData(page)).supplierPayments).toHaveLength(0);
  await view.getByRole('button', { name: 'إغلاق', exact: true }).first().click();
  await navigate(page, 'التقارير والتحليلات');
  await expect(outgoing).toHaveText(baseline);
  await navigate(page, 'المشتريات');
  await page.getByRole('button', { name: `عرض فاتورة الشراء ${purchase.number}`, exact: true }).click();
  await view.getByRole('button', { name: 'تسجيل دفعة للمورد', exact: true }).click();
  const payment = page.getByRole('dialog', { name: 'تسجيل دفعة للمورد', exact: true });
  await payment.getByLabel('المبلغ المدفوع', { exact: true }).fill('100');
  await payment.getByRole('button', { name: 'حفظ دفعة المورد', exact: true }).click();
  await expect(view).toBeVisible();
  await view.getByRole('button', { name: 'إغلاق', exact: true }).first().click();
  await navigate(page, 'التقارير والتحليلات');
  const baselineAmount = Number(baseline.replace(/[^0-9.,-]/g, '').replaceAll(',', ''));
  await expect(outgoing).toContainText(new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(baselineAmount + 100));
  const current = await storedData(page);
  expect(current.expenses).toEqual(before.expenses);
  expect(current.supplierPayments.filter((entry: any) => entry.purchaseId === purchase.id)).toHaveLength(1);
});


test('custom sections support real price and quantity fields, exact totals and safe schema editing', async ({ page }) => {
  await navigate(page, 'الإعدادات والتخصيص');
  await page.getByRole('tab', { name: 'الأقسام والإضافات', exact: true }).click();
  await page.getByRole('button', { name: 'إضافة قسم جديد', exact: true }).click();
  const section = page.getByRole('dialog', { name: 'إضافة قسم مخصص', exact: true });
  await section.getByLabel('اسم القسم', { exact: true }).fill('سجل أسعار إضافي');
  await section.getByLabel('الحقل 1', { exact: true }).fill('الوصف');
  await section.getByLabel('الحقل 2', { exact: true }).fill('السعر');
  await section.getByLabel('نوع الحقل 2', { exact: true }).selectOption('money');
  await section.getByRole('button', { name: 'إضافة حقل', exact: true }).click();
  await section.getByLabel('الحقل 3', { exact: true }).fill('الكمية');
  await section.getByLabel('نوع الحقل 3', { exact: true }).selectOption('number');
  await section.getByRole('button', { name: 'إنشاء القسم', exact: true }).click();
  await expect(section).not.toBeVisible();
  await navigate(page, 'سجل أسعار إضافي');
  for (const row of [{ description: 'دفعة أ', price: '0.1', quantity: '0.125' }, { description: 'دفعة ب', price: '0.2', quantity: '0.25' }]) {
    await page.getByRole('button', { name: 'إضافة سجل', exact: true }).click();
    const record = page.getByRole('dialog', { name: 'إضافة سجل جديد', exact: true });
    await record.getByLabel('الوصف', { exact: true }).fill(row.description);
    await expect(record.getByLabel('السعر', { exact: true })).toHaveAttribute('type', 'number');
    await expect(record.getByLabel('الكمية', { exact: true })).toHaveAttribute('step', '0.001');
    await record.getByLabel('السعر', { exact: true }).fill(row.price);
    await record.getByLabel('الكمية', { exact: true }).fill(row.quantity);
    await record.getByRole('button', { name: 'حفظ السجل', exact: true }).click();
    await expect(record).not.toBeVisible();
  }
  await expect(page.locator('.custom-totals')).toContainText('0.3 ج.م');
  await expect(page.locator('.custom-totals')).toContainText('0.375');
  await page.getByLabel('البحث في السجلات', { exact: true }).fill('دفعة أ');
  await expect(page.locator('.custom-totals')).toContainText('0.1 ج.م');
  await expect(page.locator('.custom-totals')).toContainText('0.125');
  await page.reload();
  const saved = await storedData(page);
  const module = saved.modules.find((entry: any) => entry.name === 'سجل أسعار إضافي');
  expect(module.records).toHaveLength(2);
  expect(module.fieldTypes).toEqual({ 'الوصف': 'text', 'السعر': 'money', 'الكمية': 'number' });
  await navigate(page, 'الإعدادات والتخصيص');
  await page.getByRole('tab', { name: 'الأقسام والإضافات', exact: true }).click();
  await page.getByRole('button', { name: 'تعديل حقول قسم سجل أسعار إضافي', exact: true }).click();
  const schema = page.getByRole('dialog', { name: 'تعديل حقول القسم', exact: true });
  await expect(schema.getByLabel('الحقل 1', { exact: true })).toBeDisabled();
  await schema.getByLabel('نوع الحقل 1', { exact: true }).selectOption('number');
  await schema.getByRole('button', { name: 'حفظ الحقول', exact: true }).click();
  await expect(schema.getByRole('alert')).toBeVisible();
  expect((await storedData(page)).modules.find((entry: any) => entry.id === module.id)).toEqual(module);
});
