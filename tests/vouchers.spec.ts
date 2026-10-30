import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { stat } from 'node:fs/promises';

async function navigate(page: Page, label: string) {
  await page.locator('.sidebar').getByRole('button', { name: new RegExp(`^${label}(?:\\s+[0-9٠-٩]+)?$`) }).click();
}

async function verifyPrintedVoucher(page: Page, testInfo: TestInfo, name: 'receipt' | 'expense', expectedText: string[]) {
  await page.emulateMedia({ media: 'print' });
  const document = page.locator('.print-invoice');
  await expect(document).toBeVisible();
  for (const text of expectedText) await expect(document).toContainText(text);

  // Check the actual print media layout: navigation and the modal controls must
  // disappear, while the saved financial document remains visible.
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.topbar')).toBeHidden();
  await expect(page.getByRole('button', { name: 'طباعة / PDF', exact: true })).toBeHidden();
  const printedText = await page.locator('body').innerText();
  expect(printedText).not.toContain('لوحة التحكم');
  expect(printedText).not.toContain('الإعدادات والتخصيص');
  expect(printedText).not.toContain('معاينة السند المحفوظ قبل الطباعة');
  for (const text of expectedText) expect(printedText).toContain(text);

  const path = `test-results/${name}.pdf`;
  const pdf = await page.pdf({ path, format: 'A4', printBackground: true, margin: { top: '14mm', right: '14mm', bottom: '14mm', left: '14mm' } });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.length).toBeGreaterThan(1_000);
  expect((await stat(path)).size).toBe(pdf.length);
  await testInfo.attach(`${name}-voucher.pdf`, { body: pdf, contentType: 'application/pdf' });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /كل تفاصيل أعمالك/ })).toBeVisible();
});

test('receipt voucher prints the saved company, customer, invoice and collected amount without navigation', async ({ page }, testInfo) => {
  await navigate(page, 'المقبوضات');
  const latestReceipt = page.locator('.data-table tbody tr').first();
  await expect(latestReceipt).toContainText('شركة النور للتعبئة');
  await expect(latestReceipt).toContainText('37,050');
  await latestReceipt.getByRole('button', { name: 'طباعة سند قبض', exact: true }).click();
  const voucher = page.getByRole('dialog', { name: 'سند قبض', exact: true });
  await expect(voucher).toBeVisible();
  await expect(voucher.locator('.invoice-document')).toContainText('تحويل بنكي');
  await verifyPrintedVoucher(page, testInfo, 'receipt', [
    'مصنع الأفق للورق', 'سند قبض', 'شركة النور للتعبئة', 'INV-1048',
    '37,050 ج.م', 'تحويل بنكي', 'سداد فاتورة', 'توقيع المحصّل', 'توقيع العميل',
  ]);
});

test('employee salary expense saves and prints an employee payment voucher with its exact amount', async ({ page }, testInfo) => {
  await navigate(page, 'المصروفات');
  await page.getByRole('button', { name: 'إضافة مصروف', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'إضافة مصروف', exact: true });
  const title = 'راتب الموظف محمد علي — اختبار طباعة';
  await editor.getByLabel('بيان المصروف *', { exact: true }).fill(title);
  await editor.getByLabel('المبلغ *', { exact: true }).fill('12000.50');
  await editor.getByRole('combobox', { name: 'التصنيف', exact: true }).selectOption('رواتب وأجور');
  await editor.getByRole('combobox', { name: 'الموظف (اختياري)', exact: true }).selectOption('e1');
  await editor.getByLabel('ملاحظات', { exact: true }).fill('تم صرف الراتب للموظف نقدًا');
  await editor.getByRole('button', { name: 'حفظ مصروف', exact: true }).click();
  await expect(editor).not.toBeVisible();

  // Reopen the persisted workspace before printing; the voucher must use the
  // stored employee link and amount rather than values left in the editor.
  await page.reload();
  await navigate(page, 'المصروفات');
  const expense = page.getByRole('row').filter({ hasText: title });
  await expect(expense).toContainText('محمد علي');
  await expect(expense).toContainText('12,000.5');
  await expense.getByRole('button', { name: 'طباعة سند صرف', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'سند صرف', exact: true })).toBeVisible();
  await verifyPrintedVoucher(page, testInfo, 'expense', [
    'مصنع الأفق للورق', 'سند صرف', title, 'محمد علي', 'مدير المبيعات',
    'رواتب وأجور', '12,000.5 ج.م', 'تم صرف الراتب للموظف نقدًا', 'توقيع المستلم', 'اعتماد المسؤول',
  ]);
});
