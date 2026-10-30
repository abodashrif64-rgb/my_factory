import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDownLeft, BriefcaseBusiness, CircleDollarSign, ClipboardList, Pencil, Plus, Printer, ReceiptText, Search, Trash2, UserRound, Users, Wallet, X } from 'lucide-react';
import type { AppData, ModuleProps, Page, Project, Receipt } from '../types';
import { formatMoney, id, invoicePaid, invoiceTotal, today } from '../lib/data';

type BusinessPage = 'customers' | 'employees' | 'projects' | 'receipts' | 'expenses';
type FormValues = Record<string, string>;
const headings = {
  customers: { title: 'العملاء', subtitle: 'علاقات أقوى، وكل تفاصيل عملائك في مكان واحد.', singular: 'عميل', icon: Users },
  employees: { title: 'فريق العمل', subtitle: 'نظرة واضحة على فريقك وبيانات الموظفين والرواتب.', singular: 'موظف', icon: UserRound },
  projects: { title: 'الأعمال والمشروعات', subtitle: 'تابع أعمالك من أول خطوة وحتى التسليم.', singular: 'عمل', icon: BriefcaseBusiness },
  receipts: { title: 'سندات القبض', subtitle: 'سجل التحصيلات واربط كل دفعة بفاتورتها.', singular: 'سند قبض', icon: Wallet },
  expenses: { title: 'المصروفات', subtitle: 'كل مصروف في مكانه، لصورة مالية أوضح.', singular: 'مصروف', icon: CircleDollarSign },
};
const categories = ['رواتب وأجور', 'إيجار ومرافق', 'مشتريات', 'تسويق', 'نقل وانتقالات', 'تشغيل', 'أخرى'];
const methodLabels: Record<Receipt['method'], string> = { cash: 'نقدي', bank: 'تحويل بنكي', wallet: 'محفظة إلكترونية' };
const projectLabels: Record<Project['status'], string> = { planned: 'مخطط له', active: 'قيد التنفيذ', done: 'مكتمل' };
const toForm = (record: object): FormValues => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, String(value)]));
const recordName = (record: { id: string; name?: string; title?: string }) => record.name || record.title || 'السند';

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={`field${wide ? ' field-wide' : ''}`}><span>{label}</span>{children}</label>;
}

export default function BusinessModules({ data, onUpdate, notify, page: requestedPage, query }: ModuleProps & { page: Page; query: string }) {
  const page = requestedPage as BusinessPage;
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormValues>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [voucher, setVoucher] = useState<{ kind: 'receipt' | 'expense'; id: string } | null>(null);
  const [filter, setFilter] = useState('all');
  useEffect(() => { setModal(false); setDeleting(null); setVoucher(null); setError(''); setFilter('all'); }, [requestedPage]);
  useEffect(() => {
    if (!modal && !deleting && !voucher) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) { setModal(false); setDeleting(null); setVoucher(null); } };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [modal, deleting, voucher, busy]);
  if (!(page in headings)) return null;
  const heading = headings[page];
  const Icon = heading.icon;
  const money = (value: number) => formatMoney(value, data.settings.currency);
  const customerName = (customerId: string) => data.customers.find(customer => customer.id === customerId)?.name || '—';
  const employeeName = (employeeId: string) => data.employees.find(employee => employee.id === employeeId)?.name || '—';
  const set = (key: string, value: string) => setForm(previous => ({ ...previous, [key]: value }));
  const remaining = (invoiceId: string) => {
    const invoice = data.invoices.find(item => item.id === invoiceId);
    return invoice ? Math.max(0, Math.round((invoiceTotal(invoice) - invoicePaid(data, invoiceId)) * 100) / 100) : 0;
  };
  const open = (record?: object & { id: string }) => {
    setEditing(record?.id || null);
    setForm(record ? toForm(record) : {
      name: '', phone: '', email: '', address: '', role: '', salary: '',
      customerId: '', value: '', status: 'planned', dueDate: today(),
      invoiceId: '', amount: '', date: today(), method: 'cash', notes: '',
      title: '', category: 'تشغيل', employeeId: '',
    });
    setError(''); setModal(true);
  };
  const number = (value: string, label: string, allowZero = false) => {
    const parsed = Number(value);
    if (!value?.trim() || !Number.isFinite(parsed) || (allowZero ? parsed < 0 : parsed <= 0) || parsed > 1_000_000_000) throw new Error(`أدخل ${label} صحيحًا ${allowZero ? 'لا يقل عن صفر' : 'أكبر من صفر'}.`);
    if (Math.abs(parsed * 100 - Math.round(parsed * 100)) > 0.0001) throw new Error('أدخل المبلغ بمنزلتين عشريتين بحد أقصى.');
    return Math.round(parsed * 100) / 100;
  };
  const text = (key: string) => (form[key] || '').trim();
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const next: AppData = { ...data };
      const recordId = editing || id();
      switch (page) {
        case 'customers': {
          if (!text('name')) throw new Error('اسم العميل مطلوب.');
          const record = { id: recordId, name: text('name'), phone: text('phone'), email: text('email'), address: text('address') };
          next.customers = editing ? data.customers.map(item => item.id === editing ? record : item) : [...data.customers, record];
          break;
        }
        case 'employees': {
          if (!text('name') || !text('role')) throw new Error('اسم الموظف والمسمى الوظيفي مطلوبان.');
          const record = { id: recordId, name: text('name'), role: text('role'), phone: text('phone'), salary: number(form.salary, 'راتبًا', true) };
          next.employees = editing ? data.employees.map(item => item.id === editing ? record : item) : [...data.employees, record];
          break;
        }
        case 'projects': {
          if (!text('name')) throw new Error('اسم العمل مطلوب.');
          if (!data.customers.some(item => item.id === form.customerId)) throw new Error('اختر عميلًا للعمل أولًا.');
          const record: Project = { id: recordId, name: text('name'), customerId: form.customerId, value: number(form.value, 'قيمة', true), status: form.status as Project['status'], dueDate: form.dueDate };
          next.projects = editing ? data.projects.map(item => item.id === editing ? record : item) : [...data.projects, record];
          break;
        }
        case 'receipts': {
          const invoice = data.invoices.find(item => item.id === form.invoiceId);
          if (!invoice) throw new Error('اختر الفاتورة التي تم تحصيلها.');
          const amount = number(form.amount, 'مبلغًا');
          if (Math.round(amount * 100) > Math.round(remaining(invoice.id) * 100)) throw new Error(`المبلغ أكبر من المتبقي على الفاتورة (${money(remaining(invoice.id))}).`);
          const record: Receipt = { id: recordId, invoiceId: invoice.id, customerId: invoice.customerId, amount, date: form.date, method: form.method as Receipt['method'], notes: text('notes') };
          next.receipts = [...data.receipts, record];
          break;
        }
        case 'expenses': {
          if (!text('title')) throw new Error('بيان المصروف مطلوب.');
          const record = { id: recordId, title: text('title'), category: text('category'), amount: number(form.amount, 'مبلغًا'), date: form.date, employeeId: form.employeeId || '', notes: text('notes') };
          next.expenses = editing ? data.expenses.map(item => item.id === editing ? record : item) : [...data.expenses, record];
          break;
        }
      }
      await onUpdate(next);
      setModal(false);
      notify(editing ? 'تم حفظ التعديلات بنجاح' : `تمت إضافة ${heading.singular} بنجاح`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذر حفظ البيانات. حاول مرة أخرى.'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!deleting || busy) return;
    setBusy(true); setError('');
    try {
      if (page === 'customers' && (data.invoices.some(item => item.customerId === deleting) || data.receipts.some(item => item.customerId === deleting) || data.projects.some(item => item.customerId === deleting) || data.productionOrders.some(item => item.customerId === deleting))) throw new Error('هذا العميل مرتبط بفواتير أو أعمال أو أوامر إنتاج. احتفظ به للحفاظ على سجل المصنع.');
      if (page === 'employees' && data.expenses.some(item => item.employeeId === deleting)) throw new Error('هذا الموظف مرتبط بمصروفات. احتفظ به للحفاظ على السجل المالي.');
      const next = { ...data, [page]: data[page].filter(item => item.id !== deleting) };
      await onUpdate(next);
      setDeleting(null); notify('تم حذف السجل');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذر حذف السجل.'); }
    finally { setBusy(false); }
  };
  const actions = (record: { id: string }) => <div className="row-actions">
    {(page === 'receipts' || page === 'expenses') && <button className="icon-button" title={page === 'receipts' ? 'طباعة سند قبض' : 'طباعة سند صرف'} aria-label={page === 'receipts' ? 'طباعة سند قبض' : 'طباعة سند صرف'} onClick={() => setVoucher({ kind: page === 'receipts' ? 'receipt' : 'expense', id: record.id })}><Printer size={15} /></button>}
    {page !== 'receipts' && <button className="icon-button" title={`تعديل ${heading.singular}`} aria-label={`تعديل ${heading.singular}`} onClick={() => open(record)}><Pencil size={15} /></button>}
    <button className="icon-button danger-icon" title={`حذف ${heading.singular}`} aria-label={`حذف ${heading.singular}`} onClick={() => { setDeleting(record.id); setError(''); }}><Trash2 size={15} /></button>
  </div>;
  const search = query.trim().toLowerCase();
  const includes = (...values: (string | number)[]) => values.join(' ').toLowerCase().includes(search);
  const visible = data[page].filter(record => {
    if (page === 'customers') { const row = record as AppData['customers'][number]; return includes(row.name, row.phone, row.email, row.address); }
    if (page === 'employees') { const row = record as AppData['employees'][number]; return includes(row.name, row.role, row.phone); }
    if (page === 'projects') { const row = record as Project; return includes(row.name, customerName(row.customerId)) && (filter === 'all' || row.status === filter); }
    if (page === 'receipts') { const row = record as Receipt; return includes(customerName(row.customerId), data.invoices.find(item => item.id === row.invoiceId)?.number || '', row.notes) && (filter === 'all' || row.method === filter); }
    const row = record as AppData['expenses'][number]; return includes(row.title, row.category, employeeName(row.employeeId), row.notes) && (filter === 'all' || row.category === filter);
  });
  const deletedRecord = data[page].find(record => record.id === deleting);
  const voucherReceipt = voucher?.kind === 'receipt' ? data.receipts.find(record => record.id === voucher.id) : undefined;
  const voucherExpense = voucher?.kind === 'expense' ? data.expenses.find(record => record.id === voucher.id) : undefined;
  const voucherRecord = voucherReceipt || voucherExpense;
  const voucherCustomer = voucherReceipt ? data.customers.find(customer => customer.id === voucherReceipt.customerId) : undefined;
  const voucherEmployee = voucherExpense?.employeeId ? data.employees.find(employee => employee.id === voucherExpense.employeeId) : undefined;
  const voucherInvoice = voucherReceipt ? data.invoices.find(invoice => invoice.id === voucherReceipt.invoiceId) : undefined;
  const voucherTitle = voucherReceipt ? 'سند قبض' : 'سند صرف';
  const voucherNumber = voucherRecord ? `${voucherReceipt ? 'RCPT' : 'PAY'}-${voucherRecord.id.slice(0, 8).toUpperCase()}` : '';
  const totals = page === 'customers' ? [
    { label: 'إجمالي العملاء', value: data.customers.length.toLocaleString('ar-EG'), icon: Users },
    { label: 'مبيعات العملاء', value: money(data.invoices.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0)), icon: ClipboardList },
    { label: 'المبالغ المحصلة', value: money(data.receipts.reduce((sum, receipt) => sum + receipt.amount, 0)), icon: ArrowDownLeft },
  ] : page === 'employees' ? [
    { label: 'أفراد الفريق', value: data.employees.length.toLocaleString('ar-EG'), icon: Users },
    { label: 'إجمالي الرواتب الشهرية', value: money(data.employees.reduce((sum, employee) => sum + employee.salary, 0)), icon: Wallet },
  ] : page === 'projects' ? [
    { label: 'إجمالي الأعمال', value: data.projects.length.toLocaleString('ar-EG'), icon: BriefcaseBusiness },
    { label: 'قيد التنفيذ', value: data.projects.filter(project => project.status === 'active').length.toLocaleString('ar-EG'), icon: ClipboardList },
    { label: 'قيمة الأعمال', value: money(data.projects.reduce((sum, project) => sum + project.value, 0)), icon: CircleDollarSign },
  ] : page === 'receipts' ? [
    { label: 'إجمالي التحصيلات', value: money(data.receipts.reduce((sum, receipt) => sum + receipt.amount, 0)), icon: Wallet },
    { label: 'عدد سندات القبض', value: data.receipts.length.toLocaleString('ar-EG'), icon: ClipboardList },
  ] : [
    { label: 'إجمالي المصروفات', value: money(data.expenses.reduce((sum, expense) => sum + expense.amount, 0)), icon: CircleDollarSign },
    { label: 'عدد المصروفات', value: data.expenses.length.toLocaleString('ar-EG'), icon: ClipboardList },
  ];

  return <div className="business-page">
    <div className="page-heading"><div><h1>{heading.title}</h1><p>{heading.subtitle}</p></div><button className="primary-button" onClick={() => open()}><Plus size={18} />إضافة {heading.singular}</button></div>
    <div className="module-summary-grid">{totals.map(stat => <div className="module-stat" key={stat.label}><span className="module-stat-icon"><stat.icon size={22} /></span><div><span>{stat.label}</span><strong>{stat.value}</strong></div></div>)}</div>
    <section className="table-card">
      <div className="table-toolbar"><div><h3>سجل {heading.title}</h3><span className="muted">{visible.length.toLocaleString('ar-EG')} سجل{search ? ' مطابق للبحث' : ''}</span></div><div className="table-tools">
        {page === 'projects' && <select aria-label="تصفية حالة الأعمال" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">كل الحالات</option>{Object.entries(projectLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>}
        {page === 'receipts' && <select aria-label="تصفية طريقة القبض" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">كل طرق القبض</option>{Object.entries(methodLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>}
        {page === 'expenses' && <select aria-label="تصفية تصنيف المصروفات" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">كل التصنيفات</option>{[...new Set([...categories, ...data.expenses.map(expense => expense.category)])].map(category => <option key={category}>{category}</option>)}</select>}
      </div></div>
      {visible.length === 0 ? <div className="empty-state">{search ? <Search size={36} /> : <Icon size={36} />}<h3>{search ? 'لا توجد نتائج مطابقة' : `لا توجد سجلات بعد`}</h3><p>{search ? 'جرب اسمًا أو كلمة بحث أخرى.' : `ابدأ بإضافة أول ${heading.singular}، وستظهر بياناته هنا.`}</p>{!search && <button className="secondary-button" onClick={() => open()}><Plus size={16} />إضافة {heading.singular}</button>}</div> : <div className="table-scroll"><table className="data-table">
        <thead><tr>
          {page === 'customers' && <><th>العميل</th><th>رقم الهاتف</th><th>عدد الفواتير</th><th>إجمالي المبيعات</th><th>المتبقي</th></>}
          {page === 'employees' && <><th>الموظف</th><th>المسمى الوظيفي</th><th>رقم الهاتف</th><th>الراتب الشهري</th></>}
          {page === 'projects' && <><th>العمل</th><th>العميل</th><th>موعد التسليم</th><th>القيمة</th><th>الحالة</th></>}
          {page === 'receipts' && <><th>العميل</th><th>الفاتورة</th><th>التاريخ</th><th>طريقة القبض</th><th>المبلغ</th></>}
          {page === 'expenses' && <><th>المصروف</th><th>التصنيف</th><th>التاريخ</th><th>الموظف</th><th>المبلغ</th></>}
          <th aria-label="الإجراءات" />
        </tr></thead><tbody>
          {page === 'customers' && (visible as AppData['customers']).map(customer => {
            const invoices = data.invoices.filter(invoice => invoice.customerId === customer.id);
            const total = invoices.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0);
            const paid = data.receipts.filter(receipt => receipt.customerId === customer.id).reduce((sum, receipt) => sum + receipt.amount, 0);
            return <tr key={customer.id}><td><div className="person-cell"><span className="avatar">{customer.name.slice(0, 1)}</span><div><strong>{customer.name}</strong><small>{customer.email || customer.address || 'عميل'}</small></div></div></td><td dir="ltr">{customer.phone || '—'}</td><td>{invoices.length}</td><td className="amount">{money(total)}</td><td className="amount">{money(Math.max(0, total - paid))}</td><td>{actions(customer)}</td></tr>;
          })}
          {page === 'employees' && (visible as AppData['employees']).map(employee => <tr key={employee.id}><td><div className="person-cell"><span className="avatar">{employee.name.slice(0, 1)}</span><strong>{employee.name}</strong></div></td><td>{employee.role}</td><td dir="ltr">{employee.phone || '—'}</td><td className="amount">{money(employee.salary)}</td><td>{actions(employee)}</td></tr>)}
          {page === 'projects' && (visible as AppData['projects']).map(project => <tr key={project.id}><td><strong>{project.name}</strong></td><td>{customerName(project.customerId)}</td><td>{project.dueDate}</td><td className="amount">{money(project.value)}</td><td><span className={`badge ${project.status === 'done' ? 'badge-success' : project.status === 'active' ? 'badge-warning' : 'badge-neutral'}`}>{projectLabels[project.status]}</span></td><td>{actions(project)}</td></tr>)}
          {page === 'receipts' && [...visible as AppData['receipts']].sort((a, b) => b.date.localeCompare(a.date)).map(receipt => <tr key={receipt.id}><td><strong>{customerName(receipt.customerId)}</strong>{receipt.notes && <small className="cell-note">{receipt.notes}</small>}</td><td className="invoice-number">{data.invoices.find(invoice => invoice.id === receipt.invoiceId)?.number || '—'}</td><td>{receipt.date}</td><td><span className="badge badge-neutral">{methodLabels[receipt.method]}</span></td><td className="amount positive">{money(receipt.amount)}</td><td>{actions(receipt)}</td></tr>)}
          {page === 'expenses' && [...visible as AppData['expenses']].sort((a, b) => b.date.localeCompare(a.date)).map(expense => <tr key={expense.id}><td><strong>{expense.title}</strong>{expense.notes && <small className="cell-note">{expense.notes}</small>}</td><td><span className="badge badge-neutral">{expense.category}</span></td><td>{expense.date}</td><td>{employeeName(expense.employeeId)}</td><td className="amount">{money(expense.amount)}</td><td>{actions(expense)}</td></tr>)}
        </tbody></table></div>}
      <div className="table-footer"><span>عرض {visible.length.toLocaleString('ar-EG')} من {data[page].length.toLocaleString('ar-EG')} سجل</span><span>كل التغييرات تُحفظ على هذا الجهاز</span></div>
    </section>
    {modal && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) setModal(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="business-modal-title">
      <div className="modal-header"><div><h2 id="business-modal-title">{editing ? 'تعديل' : 'إضافة'} {heading.singular}</h2><p>أدخل البيانات التالية ثم احفظ التغييرات.</p></div><button className="icon-button" aria-label="إغلاق" disabled={busy} onClick={() => setModal(false)}><X size={20} /></button></div>
      <form onSubmit={save}><div className="modal-body"><div className="form-grid">
        {(page === 'customers' || page === 'employees' || page === 'projects') && <Field label={`${page === 'projects' ? 'اسم العمل' : page === 'customers' ? 'اسم العميل' : 'اسم الموظف'} *`} wide><input autoFocus required maxLength={150} value={form.name || ''} onChange={event => set('name', event.target.value)} placeholder={page === 'projects' ? 'مثال: توريد وتجهيز الفرع الجديد' : 'الاسم بالكامل'} /></Field>}
        {(page === 'customers' || page === 'employees') && <Field label="رقم الهاتف"><input type="tel" dir="ltr" maxLength={30} value={form.phone || ''} onChange={event => set('phone', event.target.value)} placeholder="01xxxxxxxxx" /></Field>}
        {page === 'customers' && <><Field label="البريد الإلكتروني"><input type="email" dir="ltr" maxLength={150} value={form.email || ''} onChange={event => set('email', event.target.value)} placeholder="name@company.com" /></Field><Field label="العنوان" wide><textarea rows={2} maxLength={500} value={form.address || ''} onChange={event => set('address', event.target.value)} placeholder="المدينة، الشارع، رقم المبنى" /></Field></>}
        {page === 'employees' && <><Field label="المسمى الوظيفي *"><input required maxLength={100} value={form.role || ''} onChange={event => set('role', event.target.value)} placeholder="مثال: مسؤول مبيعات" /></Field><Field label="الراتب الشهري *"><input required type="number" min="0" max="1000000000" step="0.01" value={form.salary || ''} onChange={event => set('salary', event.target.value)} placeholder="0.00" /></Field><div className="form-hint field-wide">الراتب معلومة إدارية. سجّل أي راتب مدفوع في قسم المصروفات ليظهر في التقارير المالية.</div></>}
        {page === 'projects' && <>
          <Field label="العميل *"><select required value={form.customerId || ''} onChange={event => set('customerId', event.target.value)}><option value="">اختر العميل</option>{data.customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></Field>
          <Field label="قيمة العمل *"><input required type="number" min="0" max="1000000000" step="0.01" value={form.value || ''} onChange={event => set('value', event.target.value)} placeholder="0.00" /></Field>
          <Field label="الحالة"><select value={form.status || 'planned'} onChange={event => set('status', event.target.value)}>{Object.entries(projectLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
          <Field label="موعد التسليم *"><input required type="date" value={form.dueDate || ''} onChange={event => set('dueDate', event.target.value)} /></Field>
          {!data.customers.length && <p className="form-hint field-wide">أضف عميلًا من قسم العملاء أولًا لتتمكن من ربط العمل به.</p>}
          <p className="form-hint field-wide">قيمة العمل للتخطيط والمتابعة؛ تُحتسب المبيعات ماليًا عند إصدار فاتورة.</p>
        </>}
        {page === 'receipts' && <>
          <Field label="الفاتورة *" wide><select autoFocus required value={form.invoiceId || ''} onChange={event => { set('invoiceId', event.target.value); set('amount', String(remaining(event.target.value))); }}><option value="">اختر فاتورة غير مسددة</option>{data.invoices.filter(invoice => remaining(invoice.id) > 0).map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.number} — {customerName(invoice.customerId)} — متبقي {money(remaining(invoice.id))}</option>)}</select></Field>
          <Field label="المبلغ المحصل *"><input required type="number" min="0.01" max={form.invoiceId ? remaining(form.invoiceId) : 1000000000} step="0.01" value={form.amount || ''} onChange={event => set('amount', event.target.value)} placeholder="0.00" /></Field>
          <Field label="طريقة القبض"><select value={form.method || 'cash'} onChange={event => set('method', event.target.value)}>{Object.entries(methodLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
          <Field label="تاريخ القبض *"><input required type="date" value={form.date || ''} onChange={event => set('date', event.target.value)} /></Field>
          <Field label="ملاحظات" wide><textarea rows={2} maxLength={1000} value={form.notes || ''} onChange={event => set('notes', event.target.value)} placeholder="تفاصيل الدفعة أو رقم التحويل (اختياري)" /></Field>
          {!data.invoices.some(invoice => remaining(invoice.id) > 0) && <p className="form-hint field-wide">لا توجد فواتير مستحقة. أضف فاتورة جديدة من قسم الفواتير أولًا.</p>}
        </>}
        {page === 'expenses' && <>
          <Field label="بيان المصروف *" wide><input autoFocus required maxLength={150} value={form.title || ''} onChange={event => set('title', event.target.value)} placeholder="مثال: إيجار المكتب لشهر أكتوبر" /></Field>
          <Field label="المبلغ *"><input required type="number" min="0.01" max="1000000000" step="0.01" value={form.amount || ''} onChange={event => set('amount', event.target.value)} placeholder="0.00" /></Field>
          <Field label="التصنيف"><select value={form.category || 'تشغيل'} onChange={event => set('category', event.target.value)}>{[...new Set([...categories, ...(form.category ? [form.category] : [])])].map(category => <option key={category}>{category}</option>)}</select></Field>
          <Field label="التاريخ *"><input required type="date" value={form.date || ''} onChange={event => set('date', event.target.value)} /></Field>
          <Field label="الموظف (اختياري)"><select value={form.employeeId || ''} onChange={event => set('employeeId', event.target.value)}><option value="">غير مرتبط بموظف</option>{data.employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></Field>
          <Field label="ملاحظات" wide><textarea rows={2} maxLength={1000} value={form.notes || ''} onChange={event => set('notes', event.target.value)} placeholder="تفاصيل إضافية (اختياري)" /></Field>
        </>}
      </div>{error && <p className="form-error" role="alert">{error}</p>}</div><div className="modal-footer"><button type="submit" className="primary-button" disabled={busy}>{busy ? 'جارٍ الحفظ…' : editing ? 'حفظ التعديلات' : `حفظ ${heading.singular}`}</button><button type="button" className="secondary-button" disabled={busy} onClick={() => setModal(false)}>إلغاء</button></div></form>
    </section></div>}
    {deleting && <div className="modal-backdrop"><section className="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="delete-title"><div className="modal-header"><h2 id="delete-title">حذف {heading.singular}</h2><button className="icon-button" aria-label="إغلاق" disabled={busy} onClick={() => setDeleting(null)}><X size={20} /></button></div><div className="modal-body"><p>هل تريد حذف «{deletedRecord ? recordName(deletedRecord) : 'السجل'}»؟ لا يمكن التراجع عن هذه العملية.</p>{page === 'receipts' && <p className="muted">سيُعاد احتساب رصيد الفاتورة بعد حذف سند القبض.</p>}{error && <p className="form-error" role="alert">{error}</p>}</div><div className="modal-footer"><button className="primary-button danger-button" disabled={busy} onClick={remove}>{busy ? 'جارٍ الحذف…' : 'تأكيد الحذف'}</button><button className="secondary-button" disabled={busy} onClick={() => setDeleting(null)}>إلغاء</button></div></section></div>}
    {voucherRecord && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setVoucher(null); }}><section className="modal invoice-modal invoice-preview" role="dialog" aria-modal="true" aria-labelledby="voucher-title">
      <div className="modal-header no-print"><div><h2 id="voucher-title">{voucherTitle}</h2><p>معاينة السند المحفوظ قبل الطباعة.</p></div><div className="inline-actions"><button className="secondary-button" onClick={() => window.print()}><Printer size={16} />طباعة / PDF</button><button className="icon-button" aria-label="إغلاق" onClick={() => setVoucher(null)}><X size={20} /></button></div></div>
      <article className="print-invoice invoice-document">
        <header className="invoice-document-header"><div><div className="invoice-brand"><ReceiptText size={28} /><h2>{data.settings.companyName}</h2></div><p>{data.settings.companySubtitle}</p>{data.settings.address && <p>{data.settings.address}</p>}{(data.settings.phone || data.settings.email) && <p>{[data.settings.phone, data.settings.email].filter(Boolean).join(' · ')}</p>}{data.settings.taxNumber && <p>الرقم الضريبي: {data.settings.taxNumber}</p>}</div><div className="invoice-document-number"><h1>{voucherTitle}</h1><strong dir="ltr">{voucherNumber}</strong><span className={`badge ${voucherReceipt ? 'badge-success' : 'badge-neutral'}`}>{voucherReceipt ? 'مبلغ محصل' : 'مصروف مسجل'}</span></div></header>
        <div className="invoice-document-details">
          <div><span>{voucherReceipt ? 'استلمنا من العميل' : voucherEmployee ? 'صرف إلى الموظف' : 'المستفيد / البيان'}</span><h3>{voucherCustomer?.name || voucherEmployee?.name || voucherExpense?.title}</h3>{voucherCustomer?.address && <p>{voucherCustomer.address}</p>}{voucherEmployee?.role && <p>{voucherEmployee.role}</p>}{(voucherCustomer?.phone || voucherEmployee?.phone) && <p dir="ltr">{voucherCustomer?.phone || voucherEmployee?.phone}</p>}{voucherCustomer?.email && <p dir="ltr">{voucherCustomer.email}</p>}</div>
          <div><span>تاريخ {voucherReceipt ? 'القبض' : 'الصرف'}</span><h3>{new Date(`${voucherRecord.date}T12:00:00`).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' })}</h3>{voucherReceipt ? <><span>طريقة القبض</span><p>{methodLabels[voucherReceipt.method]}</p></> : <><span>تصنيف المصروف</span><p>{voucherExpense?.category}</p></>}</div>
        </div>
        <table className="invoice-document-lines"><thead><tr><th>البيان</th>{voucherReceipt && <th>مرجع الفاتورة</th>}<th>المبلغ</th></tr></thead><tbody><tr><td>{voucherReceipt ? `تحصيل دفعة من ${voucherCustomer?.name || 'العميل'}` : voucherExpense?.title}</td>{voucherReceipt && <td dir="ltr">{voucherInvoice?.number || '—'}</td>}<td className="amount">{money(voucherRecord.amount)}</td></tr></tbody></table>
        <div className="invoice-document-totals">{voucherInvoice && <div><span>قيمة الفاتورة المرتبطة</span><strong>{money(invoiceTotal(voucherInvoice))}</strong></div>}<div><span>{voucherReceipt ? 'إجمالي المبلغ المقبوض' : 'إجمالي المبلغ المصروف'}</span><strong>{money(voucherRecord.amount)}</strong></div></div>
        {voucherRecord.notes && <div className="invoice-notes"><h4>ملاحظات</h4><p>{voucherRecord.notes}</p></div>}
        <div className="invoice-document-details" style={{ marginTop: 45 }}><div><h3>{voucherReceipt ? 'توقيع المحصّل' : 'اعتماد المسؤول'}</h3><p>........................................</p></div><div><h3>{voucherReceipt ? 'توقيع العميل' : 'توقيع المستلم'}</h3><p>........................................</p></div></div>
        <footer className="invoice-document-footer"><p>{voucherTitle} صادر عن {data.settings.companyName}</p><small>تم إعداد السند باستخدام مدى</small></footer>
      </article><div className="modal-footer no-print"><span className="muted">يمكن حفظ نسخة PDF من نافذة الطباعة.</span><button className="secondary-button" onClick={() => setVoucher(null)}>تم</button></div>
    </section></div>}
  </div>;
}
