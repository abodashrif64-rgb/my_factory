import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import type { AppData, PurchaseInvoice, SupplierPayment } from '../src/types';
import { cashOutflows, createDemoData, createEmptyData, loadData, parseBackup, purchasePaid, purchaseStatus, purchaseSubtotal, purchaseTotal, saveData, supplierBalance, today, validateData } from '../src/lib/data';

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('mada-business-local');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
function purchase(changes: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
  return { id: 'purchase1', number: 'PUR-0001', supplierInvoiceNumber: 'SUP-9', supplierId: 'supplier1', date: today(), dueDate: today(), items: [{ description: 'ورق دوبلكس', quantity: 3, price: 0.1, unit: 'كيلوجرام' }], taxRate: 14, discount: 0.1, notes: '', ...changes };
}
function payment(amount: number, changes: Partial<SupplierPayment> = {}): SupplierPayment {
  return { id: 'payment1', purchaseId: 'purchase1', supplierId: 'supplier1', amount, date: today(), method: 'cash', notes: '', ...changes };
}
function fixture(): AppData {
  const data = createEmptyData();
  data.suppliers = [{ id: 'supplier1', name: 'مورد الورق', phone: '01012345678', email: '', address: 'القاهرة', taxNumber: '' }];
  data.purchases = [purchase()];
  return data;
}

describe('purchase totals and supplier balances', () => {
  it('calculates paper quantities, line rounding, discount and tax using the sales money rules', () => {
    const invoice = purchase({ items: [{ description: 'ورق', quantity: 2.5, price: 19.99, unit: 'طن' }, { description: 'عينة', quantity: 0.58, price: 0.25, unit: 'كيلوجرام' }], discount: 0.13 });
    expect(purchaseSubtotal(invoice)).toBe(50.13);
    expect(purchaseTotal(invoice)).toBe(57);
    expect(purchaseTotal(purchase())).toBe(0.23);
  });
  it('sums multiple partial payments in cents and settles the exact balance', () => {
    const data = fixture();
    expect(purchaseStatus(data, data.purchases[0])).toBe('pending');
    data.supplierPayments.push(payment(0.1));
    expect(purchasePaid(data, 'purchase1')).toBe(0.1);
    expect(supplierBalance(data, 'supplier1')).toBe(0.13);
    expect(purchaseStatus(data, data.purchases[0])).toBe('partial');
    data.supplierPayments.push(payment(0.13, { id: 'payment2' }));
    expect(purchasePaid(data, 'purchase1')).toBe(0.23);
    expect(supplierBalance(data, 'supplier1')).toBe(0);
    expect(purchaseStatus(data, data.purchases[0])).toBe('paid');
    expect(validateData(data)).toEqual(data);
  });
  it('marks a partly unpaid overdue purchase without losing its paid amount', () => {
    const data = fixture();
    data.purchases[0] = purchase({ date: '2020-01-01', dueDate: '2020-01-10' });
    data.supplierPayments.push(payment(0.1));
    expect(purchaseStatus(data, data.purchases[0])).toBe('overdue');
    expect(purchasePaid(data, 'purchase1')).toBe(0.1);
  });
  it('separates supplier balances and counts only actual payments in cash-flow reports', () => {
    const data = fixture();
    data.suppliers.push({ ...data.suppliers[0], id: 'supplier2', name: 'مورد ثانٍ' });
    data.purchases.push(purchase({ id: 'purchase2', number: 'PUR-0002', supplierId: 'supplier2' }));
    data.supplierPayments.push(payment(0.1));
    data.expenses.push({ id: 'payment1', title: 'إيجار', category: 'إيجارات', amount: 25, date: today(), employeeId: '', notes: '' });
    expect(supplierBalance(data, 'supplier1')).toBe(0.13);
    expect(supplierBalance(data, 'supplier2')).toBe(0.23);
    const outgoing = cashOutflows(data);
    expect(outgoing.map(row => row.amount)).toEqual([25, 0.1]);
    expect(new Set(outgoing.map(row => row.id)).size).toBe(2);
    expect(outgoing[1].category).toBe('مشتريات');
    expect(outgoing[1].title).toContain('PUR-0001');
    expect(outgoing[1].title).toContain('مورد الورق');
  });
});

describe('purchase accounting validation', () => {
  it('rejects supplier removal while a purchase references it', () => {
    const data = fixture(); data.suppliers = [];
    expect(() => validateData(data)).toThrow(/مورد فاتورة الشراء/);
  });
  it('rejects purchase removal or a payment assigned to another supplier', () => {
    const data = fixture(); data.supplierPayments.push(payment(0.1)); data.purchases = [];
    expect(() => validateData(data)).toThrow(/غير متطابقين/);
    const mismatch = fixture(); mismatch.supplierPayments.push(payment(0.1, { supplierId: 'unknown' }));
    expect(() => validateData(mismatch)).toThrow(/غير متطابقين/);
  });
  it('rejects overpayment across multiple payments and reducing a paid invoice below its payments', () => {
    const data = fixture();
    data.supplierPayments.push(payment(0.1), payment(0.14, { id: 'payment2' }));
    expect(() => validateData(data)).toThrow(/مدفوعات المورد/);
    data.supplierPayments.pop();
    data.purchases[0].items[0].price = 0.04;
    data.purchases[0].discount = 0;
    data.purchases[0].taxRate = 0;
    data.supplierPayments[0].amount = 0.13;
    expect(() => validateData(data)).toThrow(/مدفوعات المورد/);
  });
  it('blocks duplicate internal numbers and duplicate vendor references for the same supplier', () => {
    const data = fixture();
    data.purchases.push(purchase({ id: 'purchase2', number: ' pur-0001 ', supplierInvoiceNumber: '' }));
    expect(() => validateData(data)).toThrow(/رقم فاتورة الشراء مكرر/);
    data.purchases[1].number = 'PUR-0002';
    data.purchases[1].supplierInvoiceNumber = ' sup-9 ';
    expect(() => validateData(data)).toThrow(/لنفس المورد/);
    data.suppliers.push({ ...data.suppliers[0], id: 'supplier2' });
    data.purchases[1].supplierId = 'supplier2';
    expect(validateData(data).purchases).toHaveLength(2);
  });
  it('rejects duplicate IDs in each purchasing collection', () => {
    for (const key of ['suppliers', 'purchases', 'supplierPayments'] as const) {
      const data = fixture(); data.supplierPayments.push(payment(0.1));
      (data[key] as { id: string }[]).push(data[key][0]);
      expect(() => validateData(data)).toThrow(/مكرر/);
    }
  });
  it('validates dates, positive totals, units, quantity precision and bounded monetary input', () => {
    const invalid: Partial<PurchaseInvoice>[] = [
      { dueDate: '2000-01-01' },
      { discount: 0.31 },
      { taxRate: 14.123 },
      { items: [] },
      { items: [{ description: 'ورق', unit: 'طن', quantity: 0.0001, price: 1 }] },
      { items: [{ description: 'ورق', unit: 'طن', quantity: 1, price: -1 }] },
      { items: [{ description: 'ورق', unit: 'طن', quantity: 1, price: 0.001 }] },
      { items: [{ description: 'ورق', unit: 'طن', quantity: 1, price: Infinity }] },
      { items: [{ description: 'ورق', unit: 'طن', quantity: 1, price: 0 }] },
      { items: [{ description: 'ورق', unit: 'unknown' as 'طن', quantity: 1, price: 1 }] },
      { items: [{ description: 'ورق', unit: 'طن', quantity: 1_000_000, price: 1_000_000 }] },
    ];
    for (const value of invalid) {
      const data = fixture(); data.purchases[0] = purchase(value);
      expect(() => validateData(data), JSON.stringify(value)).toThrow();
    }
    const data = fixture();
    data.purchases[0] = purchase({ items: [{ description: 'وزن ورق', unit: 'كيلوجرام', quantity: 0.125, price: 100 }], discount: 0 });
    expect(validateData(data).purchases[0].items[0].quantity).toBe(0.125);
  });
  it('rejects malformed optional arrays instead of silently erasing supplied purchasing data', () => {
    for (const key of ['suppliers', 'purchases', 'supplierPayments']) {
      const data = fixture() as unknown as Record<string, unknown>; data[key] = null;
      expect(() => validateData(data)).toThrow();
    }
  });
});

describe('purchase migration, backup and persistence', () => {
  it('never injects new purchase demo records into empty or demo workspaces', () => {
    for (const data of [createEmptyData(), createDemoData()]) {
      expect(data.suppliers).toEqual([]);
      expect(data.purchases).toEqual([]);
      expect(data.supplierPayments).toEqual([]);
    }
  });
  it('preserves all legacy version-one records and custom fields while adding empty arrays', () => {
    const original = createDemoData();
    original.settings.companyName = 'مصنع فعلي';
    original.modules.push({ id: 'legacy-module', name: 'المشتريات القديمة', fields: ['بيان', 'سعر'], records: [{ id: 'record1', values: { بيان: 'خامة محفوظة سابقًا', سعر: '123.45' } }] });
    const legacy = JSON.parse(JSON.stringify(original));
    legacy.version = 1;
    delete legacy.suppliers; delete legacy.purchases; delete legacy.supplierPayments;
    const restored = parseBackup(JSON.stringify(legacy));
    expect(restored).toEqual(original);
    expect(Object.hasOwn(legacy, 'purchases')).toBe(false);
  });
  it('loads an actual legacy IndexedDB snapshot without resetting business data', async () => {
    const original = createDemoData(); original.settings.companyName = 'سجلات المستخدم الحالية';
    const legacy = JSON.parse(JSON.stringify(original));
    legacy.version = 1;
    delete legacy.suppliers; delete legacy.purchases; delete legacy.supplierPayments;
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('mada-business-local', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('workspace');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('workspace', 'readwrite');
        tx.objectStore('workspace').put(legacy, 'current');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
    const migrated = await loadData(); expect(migrated).toEqual(original);
    await saveData(migrated); expect(await loadData()).toEqual(original);
  });
  it('marks migrated snapshots as version two so the old version-one application cannot overwrite new records', () => {
    const legacy = JSON.parse(JSON.stringify(createDemoData()));
    legacy.version = 1;
    delete legacy.suppliers; delete legacy.purchases; delete legacy.supplierPayments;
    const migrated = validateData(legacy);
    expect(migrated.version).toBe(2);
    // v1.0's loader accepts only version === 1; migrated data now trips that guard.
    expect(migrated.version === (1 as number)).toBe(false);
    expect(parseBackup(JSON.stringify(migrated))).toEqual(migrated);
  });
  it('rejects missing purchasing arrays in version-two snapshots instead of treating corruption as a migration', () => {
    for (const key of ['suppliers', 'purchases', 'supplierPayments']) {
      const data = fixture() as unknown as Record<string, unknown>;
      expect(data.version).toBe(2);
      delete data[key];
      expect(() => validateData(data)).toThrow();
    }
  });
  it('round-trips purchases, units and supplier payments through save/reload and backup restore', async () => {
    const data = fixture(); data.supplierPayments.push(payment(0.1));
    await saveData(data);
    expect(await loadData()).toEqual(data);
    const backup = parseBackup(JSON.stringify(await loadData()));
    await saveData(createEmptyData()); await saveData(backup);
    expect(await loadData()).toEqual(data);
  });
  it('keeps the stored workspace unchanged when a purchase/payment edit violates integrity', async () => {
    const data = fixture(); data.supplierPayments.push(payment(0.1));
    await saveData(data);
    const invalid = structuredClone(data); invalid.supplierPayments[0].amount = 0.24;
    await expect(saveData(invalid)).rejects.toThrow(/مدفوعات المورد/);
    expect(await loadData()).toEqual(data);
  });
});

describe('typed custom sections remain compatible with real purchasing', () => {
  it('round-trips monetary, numeric and date fields without losing old text sections', () => {
    const data = fixture();
    data.modules = [
      { id: 'old', name: 'المشتريات', fields: ['ملاحظة'], records: [{ id: 'old-record', values: { ملاحظة: 'سجل نصي قديم يبقى كما هو' } }] },
      { id: 'typed', name: 'متابعة خامات', fields: ['البيان', 'السعر', 'الكمية', 'الموعد'], fieldTypes: { السعر: 'money', الكمية: 'number', الموعد: 'date' }, records: [{ id: 'row', values: { البيان: 'دوبلكس', السعر: '123.45', الكمية: '-0.125', الموعد: '2026-10-30' } }] },
    ];
    const restored = parseBackup(JSON.stringify(data));
    expect(restored).toEqual(data);
    expect(restored.modules[0]).not.toHaveProperty('fieldTypes');
  });
  it('allows blank optional typed fields and rejects unknown metadata keys/types', () => {
    const data = createEmptyData();
    data.modules = [{ id: 'typed', name: 'مواعيد', fields: ['البيان', 'الموعد'], fieldTypes: { الموعد: 'date' }, records: [{ id: 'r', values: { البيان: 'دون موعد محدد', الموعد: '' } }] }];
    expect(validateData(data)).toEqual(data);
    data.modules[0].fieldTypes = { حقل_آخر: 'date' };
    expect(() => validateData(data)).toThrow(/نوع حقل/);
    data.modules[0].fieldTypes = { الموعد: 'formula' as 'date' };
    expect(() => validateData(data)).toThrow(/نوع حقل/);
  });
  it('rejects invalid typed field values before saving or restoring a workspace', () => {
    const scenarios = [
      ['money', '-1'], ['money', '1.001'], ['money', 'Infinity'], ['money', '0x10'],
      ['number', '1.0001'], ['number', 'not-a-number'], ['number', '1000000001'], ['number', '0b10'],
      ['date', '2026-02-30'], ['date', '30/10/2026'],
    ] as const;
    for (const [kind, value] of scenarios) {
      const data = createEmptyData();
      data.modules = [{ id: 'typed', name: 'قسم مخصص', fields: ['الحقل'], fieldTypes: { الحقل: kind }, records: [{ id: 'r', values: { الحقل: value } }] }];
      expect(() => validateData(data), `${kind}:${value}`).toThrow();
    }
  });
});
