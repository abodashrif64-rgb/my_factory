import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { MAX_BACKUP_BYTES, invoiceLineTotal, invoiceSubtotal, createDemoData, createEmptyData, invoicePaid, invoiceStatus, invoiceTotal, loadData, parseBackup, saveData, today, validateData } from '../src/lib/data';
import type { AppData, Invoice } from '../src/types';

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('mada-business-local');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
const invoice = (changes: Partial<Invoice> = {}): Invoice => ({
  id: 'test-invoice', number: 'INV-TEST', customerId: 'c1', date: today(), dueDate: today(),
  items: [{ description: 'خدمة', quantity: 3, price: 0.1 }], taxRate: 14, discount: 0.1, notes: '', ...changes,
});
function withTestInvoice(): AppData {
  const data = createDemoData();
  data.invoices = [invoice()];
  data.receipts = [];
  return data;
}

describe('financial calculations', () => {
  it('calculates discount before tax and rounds in cents', () => {
    expect(invoiceTotal(invoice())).toBe(0.23);
    expect(invoiceTotal(invoice({ items: [{ description: 'A', price: 19.99, quantity: 2.5 }], taxRate: 0, discount: 0 }))).toBe(49.98);
  });
  it('rounds exact half-cents correctly with fractional quantities and tax', () => {
    const item = { description: 'كميات ورق', price: 0.25, quantity: 0.58 };
    expect(invoiceLineTotal(item)).toBe(0.15);
    expect(invoiceSubtotal({ items: [item, item] })).toBe(0.3);
    expect(invoiceTotal(invoice({ items: [item, item], discount: 0, taxRate: 5 }))).toBe(0.32);
  });
  it('sums receipts without floating point drift', () => {
    const data = withTestInvoice();
    data.receipts = [0.1, 0.13].map((amount, i) => ({ id: `test-r${i}`, customerId: 'c1', invoiceId: 'test-invoice', date: today(), amount, method: 'cash', notes: '' }));
    expect(invoicePaid(data, 'test-invoice')).toBe(0.23);
    expect(invoiceStatus(data, data.invoices[0])).toBe('paid');
  });
  it('distinguishes pending, partial and overdue unpaid invoices', () => {
    const data = withTestInvoice();
    expect(invoiceStatus(data, data.invoices[0])).toBe('pending');
    data.receipts.push({ id: 'partial', invoiceId: 'test-invoice', customerId: 'c1', amount: 0.1, date: today(), method: 'bank', notes: '' });
    expect(invoiceStatus(data, data.invoices[0])).toBe('partial');
    expect(invoiceStatus(data, invoice({ dueDate: '2000-01-01' }))).toBe('overdue');
  });
});

describe('backup and business validation', () => {
  it('accepts complete demo and empty data and copies the validated schema', () => {
    const demo = createDemoData();
    expect(validateData(demo)).toEqual(demo);
    expect(parseBackup(JSON.stringify(createEmptyData()))).toEqual(createEmptyData());
  });
  it('accepts version-one backups made before production modules were added', () => {
    const old = createEmptyData() as unknown as Record<string, unknown>;
    delete old.machines;
    delete old.productionOrders;
    const restored = validateData(old);
    expect(restored.machines).toEqual([]);
    expect(restored.productionOrders).toEqual([]);
  });
  it('rejects missing machines and invalid production quantities', () => {
    const data = createDemoData();
    data.machines = [];
    expect(() => validateData(data)).toThrow(/ماكينة/);
    const over = createDemoData();
    over.productionOrders[0].completedQuantity = over.productionOrders[0].quantity;
    over.productionOrders[0].wasteQuantity = 1;
    expect(() => validateData(over)).toThrow(/الكمية/);
  });
  it('rejects duplicate machine codes and production order numbers', () => {
    const data = createDemoData();
    data.machines[1].code = data.machines[0].code;
    expect(() => validateData(data)).toThrow(/مكرر/);
    const orders = createDemoData();
    orders.productionOrders[1].number = orders.productionOrders[0].number;
    expect(() => validateData(orders)).toThrow(/مكرر/);
  });
  it('accepts thousandth-precision paper weights without floating point comparison errors', () => {
    const data = createDemoData();
    data.productionOrders[0] = { ...data.productionOrders[0], quantity: 0.3, completedQuantity: 0.1, wasteQuantity: 0.2, unit: 'كيلوجرام', status: 'done' };
    expect(validateData(data).productionOrders[0].status).toBe('done');
    data.productionOrders[0].wasteQuantity = 0.201;
    expect(() => validateData(data)).toThrow(/الكمية/);
    data.productionOrders[0].wasteQuantity = 0.1;
    expect(() => validateData(data)).toThrow(/بالكامل/);
  });
  it('blocks customer deletion when referenced only by production and employee deletion when referenced by expenses', () => {
    const data = createDemoData();
    data.projects = []; data.invoices = []; data.receipts = [];
    data.customers = data.customers.filter(c => c.id !== data.productionOrders[0].customerId);
    expect(() => validateData(data)).toThrow(/عميل/);
    const employee = createDemoData();
    employee.expenses[0].employeeId = employee.employees[0].id;
    employee.employees = employee.employees.slice(1);
    expect(() => validateData(employee)).toThrow(/موظف/);
  });
  it('rejects oversized backups by encoded byte count, including Arabic text', () => {
    expect(() => parseBackup(' '.repeat(MAX_BACKUP_BYTES + 1))).toThrow(/ميجابايت/);
    expect(() => parseBackup('ا'.repeat(Math.floor(MAX_BACKUP_BYTES / 2) + 1))).toThrow(/ميجابايت/);
  });
  it('requires every receipt to be linked to an existing invoice', () => {
    const data = createDemoData();
    data.receipts[0].invoiceId = '';
    expect(() => validateData(data)).toThrow(/الفاتورة/);
    data.receipts[0].invoiceId = 'missing-invoice';
    expect(() => validateData(data)).toThrow(/متطابقين/);
  });
  it('rejects malformed JSON, unsupported versions and invalid actual dates', () => {
    expect(() => parseBackup('{')).toThrow();
    expect(() => validateData({ ...createDemoData(), version: 2 })).toThrow();
    const data = withTestInvoice();
    data.invoices[0].date = '2026-02-30';
    expect(() => validateData(data)).toThrow();
  });
  it('rejects dangling references and duplicate IDs or invoice numbers', () => {
    const data = createDemoData();
    data.customers = [];
    expect(() => validateData(data)).toThrow();
    const duplicate = createDemoData();
    duplicate.customers.push(duplicate.customers[0]);
    expect(() => validateData(duplicate)).toThrow();
    const numbers = createDemoData();
    numbers.invoices[1].number = numbers.invoices[0].number;
    expect(() => validateData(numbers)).toThrow();
  });
  it('rejects nonfinite and negative money, invalid tax and excessive discounts', () => {
    for (const amount of [-1, NaN, Infinity, 1.123]) {
      const data = createDemoData();
      data.expenses[0].amount = amount;
      expect(() => validateData(data)).toThrow();
    }
    const data = withTestInvoice();
    data.invoices[0].discount = 1;
    expect(() => validateData(data)).toThrow();
    data.invoices[0].discount = 0;
    data.invoices[0].taxRate = 101;
    expect(() => validateData(data)).toThrow();
  });
  it('rejects overpayment and customer mismatch on linked receipts', () => {
    const data = withTestInvoice();
    data.receipts = [{ id: 'over', customerId: 'c1', invoiceId: 'test-invoice', date: today(), amount: 0.24, method: 'cash', notes: '' }];
    expect(() => validateData(data)).toThrow(/المقبوضات/);
    data.receipts[0].amount = 0.1;
    data.receipts[0].customerId = 'c2';
    expect(() => validateData(data)).toThrow(/متطابقين/);
  });
  it('rejects invalid custom fields and unrecognized record fields', () => {
    const data = createEmptyData();
    data.modules = [{ id: 'm1', name: 'المخازن', fields: ['__proto__'], records: [] }];
    expect(() => validateData(data)).toThrow();
    data.modules[0].fields = ['الاسم'];
    data.modules[0].records = [{ id: 'r1', values: { unexpected: 'test' } }];
    expect(() => validateData(data)).toThrow();
  });
});

describe('IndexedDB persistence', () => {
  it('initializes demo exactly once and persists user edits through reload', async () => {
    const first = await loadData();
    expect(first.demo).toBe(true);
    first.settings.companyName = 'مصنع الاختبار';
    await saveData(first);
    const reloaded = await loadData();
    expect(reloaded.settings.companyName).toBe('مصنع الاختبار');
    expect(reloaded.invoices).toEqual(first.invoices);
  });
  it('does not overwrite valid saved data if validation fails', async () => {
    const data = createDemoData();
    await saveData(data);
    const invalid = structuredClone(data);
    invalid.receipts[0].amount = 999999;
    await expect(saveData(invalid)).rejects.toThrow();
    expect(await loadData()).toEqual(data);
  });
  it('keeps the old snapshot intact when the IndexedDB write transaction aborts', async () => {
    const data = createDemoData();
    await saveData(data);
    const transaction = IDBDatabase.prototype.transaction;
    const abortWrite = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
      const tx = transaction.apply(this, args);
      if (args[1] === 'readwrite') queueMicrotask(() => tx.abort());
      return tx;
    });
    try {
      await expect(saveData({ ...data, settings: { ...data.settings, companyName: 'لن يُحفظ' } })).rejects.toThrow();
    } finally { abortWrite.mockRestore(); }
    expect(await loadData()).toEqual(data);
  });
  it('persists empty real company after leaving demo mode', async () => {
    const empty = createEmptyData();
    await saveData(empty);
    expect(await loadData()).toEqual(empty);
  });
});
