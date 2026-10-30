import type { AppData, Invoice, InvoiceItem, Settings } from '../types';

const DB_NAME = 'mada-business-local';
const DB_STORE = 'workspace';
const STATE_KEY = 'current';
const MAX_RECORDS = 20_000;
export const MAX_BACKUP_BYTES = 30 * 1024 * 1024;
const MAX_MONEY = 1_000_000_000;
const CENTS = 100;

export const id = (): string => crypto.randomUUID();
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function offsetDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const toCents = (v: number) => Math.round((v + Number.EPSILON) * CENTS);

/** Quantity supports thousandths; integer scaling avoids decimal half-cent drift. */
export function invoiceLineTotal(item: InvoiceItem): number {
  return Math.round(toCents(item.price) * Math.round(item.quantity * 1000) / 1000) / CENTS;
}
export function invoiceSubtotal(invoice: Pick<Invoice, 'items'>): number {
  return invoice.items.reduce((sum, item) => sum + toCents(invoiceLineTotal(item)), 0) / CENTS;
}
/** Discount is a fixed amount, applied before tax. Each line rounds to cents. */
export function invoiceTotal(invoice: Invoice): number {
  const taxable = toCents(invoiceSubtotal(invoice)) - toCents(invoice.discount);
  const taxBasisPoints = Math.round(invoice.taxRate * 100);
  return (taxable + Math.round(taxable * taxBasisPoints / 10000)) / CENTS;
}
export function invoicePaid(data: AppData, invoiceId: string): number {
  return data.receipts.filter(r => r.invoiceId === invoiceId).reduce((sum, r) => sum + toCents(r.amount), 0) / CENTS;
}
export function invoiceStatus(data: AppData, invoice: Invoice): 'paid' | 'partial' | 'overdue' | 'pending' {
  const paid = toCents(invoicePaid(data, invoice.id));
  if (paid >= toCents(invoiceTotal(invoice))) return 'paid';
  if (invoice.dueDate < today()) return 'overdue';
  return paid > 0 ? 'partial' : 'pending';
}
export function formatMoney(value: number, currency = 'EGP'): string {
  const symbol = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : currency === 'AED' ? 'د.إ' : currency;
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(value)} ${symbol}`;
}

export function createEmptyData(settings?: Settings): AppData {
  return {
    version: 1, demo: false,
    settings: settings ?? { companyName: 'شركتي', companySubtitle: 'إدارة أعمالك بوضوح', phone: '', address: '', email: '', taxNumber: '', currency: 'EGP', defaultTax: 14 },
    customers: [], employees: [], projects: [], invoices: [], receipts: [], expenses: [], modules: [], machines: [], productionOrders: [],
  };
}
export function createDemoData(): AppData {
  const data = createEmptyData({ companyName: 'مصنع الأفق للورق', companySubtitle: 'صناعة الورق والتعبئة والتغليف', phone: '01012345678', address: 'القاهرة، مصر', email: 'hello@example.com', taxNumber: '', currency: 'EGP', defaultTax: 14 });
  data.demo = true;
  data.customers = [
    { id: 'c1', name: 'شركة النور للتعبئة', phone: '01024567891', email: 'elnour@example.com', address: 'القاهرة الجديدة' },
    { id: 'c2', name: 'أحمد محمود', phone: '01156789012', email: 'ahmed@example.com', address: 'مدينة نصر، القاهرة' },
    { id: 'c3', name: 'مطابع الإبداع', phone: '01234567890', email: 'modern@example.com', address: 'الشيخ زايد، الجيزة' },
    { id: 'c4', name: 'شركة الرواد للتغليف', phone: '01078901234', email: 'rowad@example.com', address: 'المعادي، القاهرة' },
    { id: 'c5', name: 'سارة محمد', phone: '01123456789', email: 'sara@example.com', address: 'الإسكندرية' },
  ];
  data.employees = [
    { id: 'e1', name: 'محمد علي', role: 'مدير المبيعات', phone: '01023456789', salary: 12000 },
    { id: 'e2', name: 'منة أحمد', role: 'محاسبة', phone: '01134567890', salary: 10000 },
    { id: 'e3', name: 'عمر حسن', role: 'مسؤول العمليات', phone: '01245678901', salary: 9000 },
    { id: 'e4', name: 'نور إبراهيم', role: 'خدمة العملاء', phone: '01056789012', salary: 8000 },
  ];
  data.projects = [
    { id: 'p1', name: 'توريد عبوات ورقية مطبوعة', customerId: 'c1', value: 85000, status: 'active', dueDate: offsetDate(12) },
    { id: 'p2', name: 'قص وتكسير علب الهدايا', customerId: 'c3', value: 120000, status: 'active', dueDate: offsetDate(25) },
    { id: 'p3', name: 'توريد كراتين شحن', customerId: 'c4', value: 48000, status: 'planned', dueDate: offsetDate(35) },
    { id: 'p4', name: 'تكسير عبوات منتجات غذائية', customerId: 'c2', value: 18000, status: 'done', dueDate: offsetDate(-8) },
  ];
  const specifications: [string, string, number, number, number][] = [
    ['c1', 'توريد علب كرتون مطبوعة — ٥٬٠٠٠ قطعة', 32500, -2, 20],
    ['c2', 'قص وتكسير ورق دوبلكس — ٣٬٠٠٠ ورقة', 15800, -4, 10],
    ['c3', 'تصنيع عبوات ورقية — دفعة إنتاج', 48000, -6, -1],
    ['c4', 'تكسير علب هدايا وتجهيز القوالب', 22500, -9, 4],
    ['c5', 'توريد أكياس ورقية مطبوعة', 18600, -12, -2],
    ['c1', 'توريد كراتين تغليف للفرع الرئيسي', 42000, -35, -5],
    ['c3', 'عبوات دوبلكس مطبوعة ومكسرة', 53000, -67, -37],
    ['c4', 'توريد ورق كرافت وكراتين', 37500, -98, -68],
    ['c2', 'تكسير وتجميع علب منتجات', 26000, -129, -99],
    ['c1', 'توريد عبوات ورقية أولية', 21000, -158, -128],
  ];
  data.invoices = specifications.map(([customerId, description, price, issued, due], index) => ({
    id: `i${index + 1}`, number: `INV-${String(1048 - index).padStart(4, '0')}`, customerId,
    date: offsetDate(issued), dueDate: offsetDate(due), items: [{ description, quantity: 1, price }], taxRate: 14, discount: 0, notes: 'شكرًا لثقتكم، يسعدنا التعامل معكم.',
  }));
  const paidInvoices = [0, 1, 4, 5, 6, 7, 8, 9];
  data.receipts = paidInvoices.map(index => ({ id: `r${index + 1}`, invoiceId: `i${index + 1}`, customerId: data.invoices[index].customerId, amount: invoiceTotal(data.invoices[index]), date: data.invoices[index].date, method: index % 2 === 0 ? 'bank' : 'cash', notes: 'سداد فاتورة' }));
  data.receipts.push({ id: 'rpartial', invoiceId: 'i4', customerId: 'c4', amount: 10000, date: offsetDate(-3), method: 'bank', notes: 'دفعة مقدمة' });
  const expenseSpecs: [string, string, number, number][] = [
    ['رواتب فريق العمل', 'رواتب', 39000, -3], ['إيجار المقر', 'إيجارات', 8500, -8],
    ['مستلزمات التشغيل', 'تشغيل', 4200, -10], ['حملة إعلانية', 'تسويق', 2800, -12],
    ['شحن ونقل التوريدات', 'نقل', 1650, -5], ['كهرباء وإنترنت', 'مرافق', 1350, -7],
    ['رواتب الشهر السابق', 'رواتب', 36000, -35], ['إيجار المقر', 'إيجارات', 8500, -39],
    ['تشغيل وتوريدات', 'تشغيل', 12200, -67], ['رواتب فريق العمل', 'رواتب', 34000, -70],
    ['تشغيل ومستلزمات', 'تشغيل', 10500, -100], ['رواتب فريق العمل', 'رواتب', 32000, -101],
    ['مستلزمات وتجهيزات', 'تشغيل', 6000, -133], ['إيجار المقر', 'إيجارات', 8500, -135],
    ['تشغيل المقر', 'تشغيل', 8200, -160],
  ];
  data.expenses = expenseSpecs.map(([title, category, amount, days], i) => ({ id: `x${i}`, title, category, amount, date: offsetDate(days), employeeId: '', notes: '' }));
  data.machines = [
    { id: 'machine1', name: 'ماكينة التكسير الرئيسية', type: 'تكسير ورق', code: 'DC-01', status: 'active', hourlyRate: 350, notes: 'تكسير وقص ورق الدوبلكس والكرتون' },
    { id: 'machine2', name: 'ماكينة التكسير الثانية', type: 'تكسير ورق', code: 'DC-02', status: 'active', hourlyRate: 280, notes: '' },
    { id: 'machine3', name: 'مقص الورق', type: 'قص ورق', code: 'CT-01', status: 'maintenance', hourlyRate: 180, notes: 'صيانة دورية وتغيير السكين' },
  ];
  data.productionOrders = [
    { id: 'order1', number: 'PRD-1004', customerId: 'c1', machineId: 'machine1', title: 'تكسير علب كرتون مطبوعة', quantity: 5000, completedQuantity: 3400, wasteQuantity: 60, unit: 'قطعة', status: 'running', date: offsetDate(-2), dueDate: offsetDate(3), notes: 'دوبلكس ٣٥٠ جرام' },
    { id: 'order2', number: 'PRD-1003', customerId: 'c3', machineId: 'machine2', title: 'قص وتجهيز علب الهدايا', quantity: 3000, completedQuantity: 0, wasteQuantity: 0, unit: 'ورقة', status: 'queued', date: today(), dueDate: offsetDate(6), notes: '' },
    { id: 'order3', number: 'PRD-1002', customerId: 'c4', machineId: 'machine1', title: 'تكسير عبوات مواد غذائية', quantity: 8000, completedQuantity: 7920, wasteQuantity: 80, unit: 'قطعة', status: 'done', date: offsetDate(-10), dueDate: offsetDate(-4), notes: 'تم التسليم ومراجعة الجودة' },
  ];
  return data;
}

function fail(message: string): never { throw new Error(message); }
function object(v: unknown, label: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`صيغة ${label} غير صحيحة.`);
  return v as Record<string, unknown>;
}
function text(v: unknown, label: string, required = false, max = 2000): string {
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) fail(`${label} غير صحيح.`);
  return v;
}
function money(v: unknown, label: string, positive = false): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < (positive ? 0.01 : 0) || v > MAX_MONEY || Math.abs(v * 100 - Math.round(v * 100)) > 0.0001) fail(`${label} يجب أن يكون مبلغًا صحيحًا حتى منزلتين عشريتين.`);
  return v;
}
function percentage(v: unknown, label: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100 || Math.abs(v * 100 - Math.round(v * 100)) > 0.0001) fail(`${label} يجب أن يكون بين صفر و١٠٠.`);
  return v;
}
function quantity(v: unknown, label: string, positive = false, maximum = MAX_MONEY): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < (positive ? 0.001 : 0) || v > maximum || Math.abs(v * 1000 - Math.round(v * 1000)) > 0.0001) fail(`${label} يجب أن تكون كمية صحيحة حتى ثلاث منازل عشرية.`);
  return v;
}
function date(v: unknown, label: string): string {
  const s = text(v, label, true, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(`${label} غير صحيح.`);
  const parsed = new Date(`${s}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== s) fail(`${label} غير صحيح.`);
  return s;
}
function list(v: unknown, label: string, max = MAX_RECORDS): unknown[] {
  if (!Array.isArray(v) || v.length > max) fail(`قائمة ${label} غير صحيحة أو تجاوزت الحد المسموح.`);
  return v;
}
function unique<T extends { id: string }>(rows: T[], label: string): T[] {
  const seen = new Set<string>();
  for (const row of rows) {
    text(row.id, `معرّف ${label}`, true, 200);
    if (seen.has(row.id)) fail(`معرّف مكرر في ${label}.`);
    seen.add(row.id);
  }
  return rows;
}
/** Copy an untrusted backup into an explicit schema; never trust its properties. */
export function validateData(input: unknown): AppData {
  const d = object(input, 'البيانات');
  if (d.version !== 1 || typeof d.demo !== 'boolean') fail('إصدار النسخة الاحتياطية غير مدعوم.');
  const s = object(d.settings, 'إعدادات الشركة');
  const currency = text(s.currency, 'العملة', true, 3);
  if (!/^[A-Z]{3}$/.test(currency)) fail('رمز العملة غير صحيح.');
  try { new Intl.NumberFormat('en', { style: 'currency', currency }); } catch { fail('رمز العملة غير صحيح.'); }
  const settings: Settings = {
    companyName: text(s.companyName, 'اسم الشركة', true, 200), companySubtitle: text(s.companySubtitle, 'وصف الشركة'), phone: text(s.phone, 'هاتف الشركة', false, 100), address: text(s.address, 'عنوان الشركة'), email: text(s.email, 'بريد الشركة', false, 320), taxNumber: text(s.taxNumber, 'الرقم الضريبي', false, 100), currency, defaultTax: percentage(s.defaultTax, 'الضريبة الافتراضية'),
  };
  const customers = unique(list(d.customers, 'العملاء').map(v => {
    const r = object(v, 'العميل');
    return { id: text(r.id, 'معرّف العميل', true, 200), name: text(r.name, 'اسم العميل', true, 200), phone: text(r.phone, 'الهاتف', false, 100), email: text(r.email, 'البريد الإلكتروني', false, 320), address: text(r.address, 'العنوان') };
  }), 'العملاء');
  const customerIds = new Set(customers.map(c => c.id));
  const employees = unique(list(d.employees, 'الموظفين').map(v => {
    const r = object(v, 'الموظف');
    return { id: text(r.id, 'معرّف الموظف', true, 200), name: text(r.name, 'اسم الموظف', true, 200), role: text(r.role, 'الوظيفة', true, 200), phone: text(r.phone, 'الهاتف', false, 100), salary: money(r.salary, 'الراتب') };
  }), 'الموظفين');
  const employeeIds = new Set(employees.map(e => e.id));
  const projects = unique(list(d.projects, 'الأعمال').map(v => {
    const r = object(v, 'العمل');
    const customerId = text(r.customerId, 'العميل', true, 200);
    if (!customerIds.has(customerId)) fail('عميل العمل غير موجود.');
    if (!['planned', 'active', 'done'].includes(r.status as string)) fail('حالة العمل غير صحيحة.');
    return { id: text(r.id, 'معرّف العمل', true, 200), name: text(r.name, 'اسم العمل', true, 200), customerId, value: money(r.value, 'قيمة العمل'), status: r.status as 'planned' | 'active' | 'done', dueDate: date(r.dueDate, 'موعد التسليم') };
  }), 'الأعمال');
  const invoiceNumbers = new Set<string>();
  const invoices = unique(list(d.invoices, 'الفواتير').map(v => {
    const r = object(v, 'الفاتورة');
    const customerId = text(r.customerId, 'عميل الفاتورة', true, 200);
    if (!customerIds.has(customerId)) fail('عميل الفاتورة غير موجود.');
    const number = text(r.number, 'رقم الفاتورة', true, 100);
    if (invoiceNumbers.has(number.trim().toUpperCase())) fail('رقم الفاتورة مكرر.');
    invoiceNumbers.add(number.trim().toUpperCase());
    const items = list(r.items, 'بنود الفاتورة', 200).map(v => {
      const item = object(v, 'بند الفاتورة');
      const itemQuantity = quantity(item.quantity, 'كمية البند', true, 1_000_000);
      return { description: text(item.description, 'وصف البند', true), quantity: itemQuantity, price: money(item.price, 'سعر البند') };
    });
    if (!items.length) fail('الفاتورة تحتاج بندًا واحدًا على الأقل.');
    const invoice = { id: text(r.id, 'معرّف الفاتورة', true, 200), number, customerId, date: date(r.date, 'تاريخ الفاتورة'), dueDate: date(r.dueDate, 'تاريخ الاستحقاق'), items, taxRate: percentage(r.taxRate, 'ضريبة الفاتورة'), discount: money(r.discount, 'الخصم'), notes: text(r.notes, 'ملاحظات الفاتورة', false, 10000) };
    if (invoice.dueDate < invoice.date) fail('تاريخ الاستحقاق يجب ألا يسبق تاريخ الفاتورة.');
    const subtotal = toCents(invoiceSubtotal(invoice));
    if (toCents(invoice.discount) > subtotal) fail('الخصم أكبر من قيمة الفاتورة.');
    if (invoiceTotal(invoice) > MAX_MONEY) fail('قيمة الفاتورة تجاوزت الحد المسموح.');
    return invoice;
  }), 'الفواتير');
  const invoiceMap = new Map(invoices.map(i => [i.id, i]));
  const receiptTotals = new Map<string, number>();
  const receipts = unique(list(d.receipts, 'المقبوضات').map(v => {
    const r = object(v, 'سند القبض');
    const customerId = text(r.customerId, 'عميل سند القبض', true, 200);
    if (!customerIds.has(customerId)) fail('عميل سند القبض غير موجود.');
    const invoiceId = text(r.invoiceId, 'الفاتورة المرتبطة بسند القبض', true, 200);
    const amount = money(r.amount, 'المبلغ المقبوض', true);
    {
      const invoice = invoiceMap.get(invoiceId);
      if (!invoice || invoice.customerId !== customerId) fail('الفاتورة والعميل في سند القبض غير متطابقين.');
      const total = (receiptTotals.get(invoiceId) ?? 0) + toCents(amount);
      if (total > toCents(invoiceTotal(invoice))) fail('مجموع المقبوضات أكبر من قيمة الفاتورة.');
      receiptTotals.set(invoiceId, total);
    }
    if (!['cash', 'bank', 'wallet'].includes(r.method as string)) fail('طريقة الدفع غير صحيحة.');
    return { id: text(r.id, 'معرّف سند القبض', true, 200), invoiceId, customerId, amount, date: date(r.date, 'تاريخ القبض'), method: r.method as 'cash' | 'bank' | 'wallet', notes: text(r.notes, 'ملاحظات القبض', false, 10000) };
  }), 'المقبوضات');
  const expenses = unique(list(d.expenses, 'المصروفات').map(v => {
    const r = object(v, 'المصروف');
    const employeeId = text(r.employeeId, 'الموظف', false, 200);
    if (employeeId && !employeeIds.has(employeeId)) fail('موظف سند الصرف غير موجود.');
    return { id: text(r.id, 'معرّف المصروف', true, 200), title: text(r.title, 'بيان المصروف', true, 200), category: text(r.category, 'تصنيف المصروف', true, 200), amount: money(r.amount, 'قيمة المصروف', true), date: date(r.date, 'تاريخ الصرف'), employeeId, notes: text(r.notes, 'ملاحظات المصروف', false, 10000) };
  }), 'المصروفات');
  const machines = unique(list(d.machines ?? [], 'الماكينات').map(v => {
    const r = object(v, 'الماكينة');
    if (!['active', 'maintenance', 'inactive'].includes(r.status as string)) fail('حالة الماكينة غير صحيحة.');
    return { id: text(r.id, 'معرّف الماكينة', true, 200), name: text(r.name, 'اسم الماكينة', true, 200), type: text(r.type, 'نوع الماكينة', true, 200), code: text(r.code, 'كود الماكينة', true, 100), status: r.status as 'active' | 'maintenance' | 'inactive', hourlyRate: money(r.hourlyRate, 'تكلفة ساعة الماكينة'), notes: text(r.notes, 'ملاحظات الماكينة', false, 10000) };
  }), 'الماكينات');
  const machineCodes = machines.map(m => m.code.trim().toUpperCase());
  if (new Set(machineCodes).size !== machineCodes.length) fail('كود الماكينة مكرر.');
  const machineIds = new Set(machines.map(m => m.id));
  const productionOrders = unique(list(d.productionOrders ?? [], 'أوامر الإنتاج').map(v => {
    const r = object(v, 'أمر الإنتاج');
    const customerId = text(r.customerId, 'عميل أمر الإنتاج', true, 200);
    const machineId = text(r.machineId, 'ماكينة أمر الإنتاج', true, 200);
    if (!customerIds.has(customerId) || !machineIds.has(machineId)) fail('عميل أو ماكينة أمر الإنتاج غير موجود.');
    if (!['queued', 'running', 'done'].includes(r.status as string)) fail('حالة أمر الإنتاج غير صحيحة.');
    if (!['ورقة', 'كرتونة', 'قطعة', 'كيلوجرام'].includes(r.unit as string)) fail('وحدة الإنتاج غير صحيحة.');
    const requestedQuantity = quantity(r.quantity, 'الكمية المطلوبة', true);
    const completedQuantity = quantity(r.completedQuantity, 'الكمية المنجزة');
    const wasteQuantity = quantity(r.wasteQuantity, 'الهالك');
    const accounted = Math.round(completedQuantity * 1000) + Math.round(wasteQuantity * 1000);
    const requested = Math.round(requestedQuantity * 1000);
    if (accounted > requested) fail('المنجز والهالك أكبر من الكمية المطلوبة.');
    if (r.status === 'done' && accounted !== requested) fail('لإكمال أمر التشغيل يجب تسجيل الكمية المطلوبة بالكامل بين المنجز والهالك.');
    const issueDate = date(r.date, 'تاريخ أمر الإنتاج');
    const dueDate = date(r.dueDate, 'تاريخ تسليم أمر الإنتاج');
    if (dueDate < issueDate) fail('تاريخ تسليم أمر الإنتاج يسبق تاريخ إنشائه.');
    return { id: text(r.id, 'معرّف أمر الإنتاج', true, 200), number: text(r.number, 'رقم أمر الإنتاج', true, 100), customerId, machineId, title: text(r.title, 'عنوان أمر الإنتاج', true, 200), quantity: requestedQuantity, completedQuantity, wasteQuantity, unit: r.unit as 'ورقة' | 'كرتونة' | 'قطعة' | 'كيلوجرام', status: r.status as 'queued' | 'running' | 'done', date: issueDate, dueDate, notes: text(r.notes, 'ملاحظات أمر الإنتاج', false, 10000) };
  }), 'أوامر الإنتاج');
  const productionNumbers = productionOrders.map(o => o.number.trim().toUpperCase());
  if (new Set(productionNumbers).size !== productionNumbers.length) fail('رقم أمر الإنتاج مكرر.');
  const modules = unique(list(d.modules, 'الأقسام', 100).map(v => {
    const r = object(v, 'القسم');
    const fields = list(r.fields, 'حقول القسم', 20).map(v => text(v, 'اسم الحقل', true, 100));
    if (!fields.length || new Set(fields).size !== fields.length || fields.some(f => ['__proto__', 'constructor', 'prototype'].includes(f))) fail('حقول القسم مكررة أو غير صحيحة.');
    const records = unique(list(r.records, 'سجلات القسم').map(v => {
      const record = object(v, 'السجل');
      const values = object(record.values, 'قيم السجل');
      if (Object.keys(values).some(k => !fields.includes(k))) fail('السجل يحتوي حقولًا غير معروفة.');
      const cleaned: Record<string, string> = {};
      for (const field of fields) cleaned[field] = text(values[field], 'قيمة الحقل', false, 5000);
      return { id: text(record.id, 'معرّف السجل', true, 200), values: cleaned };
    }), 'سجلات القسم');
    return { id: text(r.id, 'معرّف القسم', true, 200), name: text(r.name, 'اسم القسم', true, 100), fields, records };
  }), 'الأقسام');
  return { version: 1, demo: d.demo, settings, customers, employees, projects, invoices, receipts, expenses, modules, machines, productionOrders };
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('التخزين المحلي غير متاح في هذا المتصفح. استخدم متصفحًا حديثًا خارج الوضع الخاص.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('تعذر فتح قاعدة البيانات المحلية. تحقق من مساحة الجهاز وإعدادات المتصفح.'));
    request.onblocked = () => reject(new Error('قاعدة البيانات مشغولة في نافذة أخرى. أغلق النوافذ الأخرى وأعد المحاولة.'));
  });
}
export async function saveData(input: AppData): Promise<void> {
  const data = validateData(input);
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, 'readwrite');
      transaction.objectStore(DB_STORE).put(data, STATE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('تعذر حفظ البيانات. تحقق من مساحة الجهاز وحاول مجددًا.'));
      transaction.onabort = () => reject(new Error('لم تكتمل عملية الحفظ. بياناتك السابقة ما زالت محفوظة.'));
    });
  } finally { db.close(); }
}
export async function loadData(): Promise<AppData> {
  const db = await openDatabase();
  let saved: unknown;
  try {
    saved = await new Promise((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, 'readonly');
      const request = transaction.objectStore(DB_STORE).get(STATE_KEY);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(new Error('تعذر قراءة البيانات المحفوظة.'));
      transaction.onabort = () => reject(new Error('توقفت قراءة البيانات المحلية. أعد المحاولة.'));
    });
  } finally { db.close(); }
  if (saved !== undefined) return validateData(saved);
  const data = createDemoData();
  await saveData(data);
  return data;
}
export function parseBackup(contents: string): AppData {
  if (contents.length > MAX_BACKUP_BYTES || new TextEncoder().encode(contents).byteLength > MAX_BACKUP_BYTES) fail('حجم النسخة الاحتياطية أكبر من الحد المسموح (٣٠ ميجابايت).');
  let parsed: unknown;
  try { parsed = JSON.parse(contents); } catch { fail('ملف النسخة الاحتياطية ليس ملف JSON صالحًا.'); }
  return validateData(parsed);
}
export function downloadBackup(data: AppData): void {
  const valid = validateData(data);
  const blob = new Blob([JSON.stringify(valid, null, 2)], { type: 'application/json' });
  if (blob.size > MAX_BACKUP_BYTES) fail('حجم البيانات أكبر من الحد المسموح للنسخة الاحتياطية (٣٠ ميجابايت). تواصل مع المطور لتوسيع الحد قبل المتابعة.');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mada-backup-${today()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
