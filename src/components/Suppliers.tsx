import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUpLeft, FileText, Pencil, Plus, Printer, Save, Trash2, Truck, X } from 'lucide-react';
import type { ModuleProps, Supplier } from '../types';
import { formatMoney, id, purchasePaid, purchaseTotal, supplierBalance, today } from '../lib/data';

const blankSupplier = (): Omit<Supplier, 'id'> => ({ name: '', phone: '', email: '', address: '', taxNumber: '' });
const displayDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' });
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100);
const methodNames = { cash: 'نقدي', bank: 'تحويل بنكي', wallet: 'محفظة إلكترونية' };

export default function Suppliers({ data, onUpdate, notify, query }: ModuleProps & { query: string }) {
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(blankSupplier);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statementId, setStatementId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const money = (value: number) => formatMoney(value, data.settings.currency);
  const supplierPurchases = (supplierId: string) => data.purchases.filter(purchase => purchase.supplierId === supplierId);
  const purchaseAmount = (supplierId: string) => supplierPurchases(supplierId).reduce((sum, purchase) => sum + cents(purchaseTotal(purchase)), 0) / 100;
  const paidAmount = (supplierId: string) => supplierPurchases(supplierId).reduce((sum, purchase) => sum + cents(purchasePaid(data, purchase.id)), 0) / 100;
  const filtered = data.suppliers.filter(supplier => `${supplier.name} ${supplier.phone} ${supplier.email} ${supplier.address} ${supplier.taxNumber}`.toLocaleLowerCase('ar').includes(query.trim().toLocaleLowerCase('ar')));
  const statementSupplier = data.suppliers.find(supplier => supplier.id === statementId);
  const deletingSupplier = data.suppliers.find(supplier => supplier.id === deletingId);
  const hasLinkedRecords = !!deletingId && (data.purchases.some(purchase => purchase.supplierId === deletingId) || data.supplierPayments.some(payment => payment.supplierId === deletingId));
  const totalPurchases = data.purchases.reduce((sum, purchase) => sum + cents(purchaseTotal(purchase)), 0) / 100;
  const totalOutstanding = data.suppliers.reduce((sum, supplier) => sum + cents(supplierBalance(data, supplier.id)), 0) / 100;

  useEffect(() => {
    if (!editing && !deletingId && !statementId) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { setEditing(false); setDeletingId(null); setStatementId(null); setError(''); }
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [editing, deletingId, statementId, busy]);

  const openEditor = (supplier?: Supplier) => {
    setEditingId(supplier?.id ?? null);
    setDraft(supplier ? { name: supplier.name, phone: supplier.phone, email: supplier.email, address: supplier.address, taxNumber: supplier.taxNumber } : blankSupplier());
    setError(''); setEditing(true);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!draft.name.trim()) { setError('أدخل اسم المورد.'); return; }
    const supplier: Supplier = { id: editingId ?? id(), name: draft.name.trim(), phone: draft.phone.trim(), email: draft.email.trim(), address: draft.address.trim(), taxNumber: draft.taxNumber.trim() };
    setBusy(true); setError('');
    try {
      await onUpdate({ ...data, suppliers: editingId ? data.suppliers.map(item => item.id === editingId ? supplier : item) : [...data.suppliers, supplier] });
      setEditing(false); notify(editingId ? 'تم حفظ تعديلات المورد' : 'تمت إضافة المورد');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذر حفظ المورد. حاول مرة أخرى.'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!deletingSupplier || busy) return;
    if (hasLinkedRecords) { setError('هذا المورد مرتبط بفواتير شراء أو مدفوعات. احتفظ به للحفاظ على السجل المالي.'); return; }
    setBusy(true); setError('');
    try {
      await onUpdate({ ...data, suppliers: data.suppliers.filter(supplier => supplier.id !== deletingSupplier.id) });
      setDeletingId(null); notify('تم حذف المورد');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذر حذف المورد. حاول مرة أخرى.'); }
    finally { setBusy(false); }
  };

  const statementRows = (() => {
    if (!statementSupplier) return [];
    const purchases = supplierPurchases(statementSupplier.id);
    const rows = [
      ...purchases.map(purchase => ({ id: `purchase:${purchase.id}`, date: purchase.date, priority: 0, reference: purchase.number, details: purchase.supplierInvoiceNumber ? `فاتورة شراء · رقم المورد ${purchase.supplierInvoiceNumber}` : 'فاتورة شراء', purchase: cents(purchaseTotal(purchase)), paid: 0 })),
      ...data.supplierPayments.filter(payment => payment.supplierId === statementSupplier.id).map(payment => ({ id: `payment:${payment.id}`, date: payment.date, priority: 1, reference: data.purchases.find(purchase => purchase.id === payment.purchaseId)?.number ?? '—', details: `دفعة للمورد · ${methodNames[payment.method]}`, purchase: 0, paid: cents(payment.amount) })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.priority - b.priority || a.reference.localeCompare(b.reference) || a.id.localeCompare(b.id));
    let balance = 0;
    return rows.map(row => { balance += row.purchase - row.paid; return { ...row, balance }; });
  })();

  return <>
    <div className="page-heading"><div><div className="eyebrow">موردوك، وصورة واضحة لكل حساب</div><h1>الموردون وحساباتهم</h1><p>سجّل بيانات المورد، وتابع فواتير الشراء والمدفوع والمتبقي.</p></div><button className="primary-button" onClick={() => openEditor()}><Plus size={18}/>إضافة مورد</button></div>
    <div className="invoice-summary-grid">
      <div className="mini-stat"><span>الموردون المسجلون</span><strong>{data.suppliers.length.toLocaleString('ar-EG')}</strong><small>كل علاقات التوريد في مكان واحد</small></div>
      <div className="mini-stat"><span>إجمالي المشتريات</span><strong>{money(totalPurchases)}</strong><small>قيمة فواتير الشراء المسجلة</small></div>
      <div className="mini-stat"><span>مستحقات الموردين</span><strong>{money(totalOutstanding)}</strong><small>قيمة الفواتير ناقص المدفوعات</small></div>
    </div>
    <section className="table-card"><div className="table-toolbar"><div><h2>سجل الموردين</h2><span className="muted">{filtered.length.toLocaleString('ar-EG')} من {data.suppliers.length.toLocaleString('ar-EG')} مورد</span></div><span className="muted">سجّل دفعات المورد من قسم المشتريات</span></div>
      {filtered.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>المورد</th><th>التواصل</th><th>عدد الفواتير</th><th>المشتريات</th><th>المدفوع</th><th>المتبقي للمورد</th><th>إجراءات</th></tr></thead><tbody>{filtered.map(supplier => <tr key={supplier.id}><td><div className="table-person"><span className="avatar"><Truck size={17}/></span><div><strong>{supplier.name}</strong><small>{supplier.taxNumber ? `رقم ضريبي: ${supplier.taxNumber}` : supplier.address || '—'}</small></div></div></td><td><div><span dir="ltr">{supplier.phone || '—'}</span>{supplier.email && <small className="cell-note" dir="ltr">{supplier.email}</small>}</div></td><td>{supplierPurchases(supplier.id).length.toLocaleString('ar-EG')}</td><td className="amount-cell">{money(purchaseAmount(supplier.id))}</td><td className="amount-cell">{money(paidAmount(supplier.id))}</td><td><span className={`badge ${supplierBalance(data, supplier.id) > 0 ? 'badge-warning' : 'badge-success'}`}>{money(supplierBalance(data, supplier.id))}</span></td><td><div className="row-actions"><button className="icon-button" aria-label={`كشف حساب ${supplier.name}`} title="كشف حساب المورد" onClick={() => { setError(''); setStatementId(supplier.id); }}><ArrowUpLeft size={17}/></button><button className="icon-button" aria-label={`تعديل المورد ${supplier.name}`} title="تعديل المورد" onClick={() => openEditor(supplier)}><Pencil size={16}/></button><button className="icon-button danger-text" aria-label={`حذف المورد ${supplier.name}`} title="حذف المورد" onClick={() => { setError(''); setDeletingId(supplier.id); }}><Trash2 size={16}/></button></div></td></tr>)}</tbody></table></div> : <div className="empty-state"><Truck size={38}/><h3>{query.trim() ? 'لا توجد نتائج مطابقة' : 'ابدأ بإضافة أول مورد'}</h3><p>{query.trim() ? 'جرّب اسم المورد أو رقم التواصل.' : 'أضف المورد، ثم أنشئ فاتورة شراء بكمياتها وأسعارها من قسم المشتريات.'}</p>{!query.trim() && <button className="secondary-button" onClick={() => openEditor()}><Plus size={16}/>إضافة مورد</button>}</div>}
    </section>

    {editing && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setEditing(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="supplier-editor-title"><form onSubmit={save}><div className="modal-header"><div><h2 id="supplier-editor-title">{editingId ? 'تعديل المورد' : 'إضافة مورد جديد'}</h2><p>بيانات التواصل تظهر في فواتير الشراء وكشف الحساب.</p></div><button type="button" className="icon-button" aria-label="إغلاق" disabled={busy} onClick={() => setEditing(false)}><X size={20}/></button></div><div className="modal-body"><div className="form-grid">
      <label className="field field-wide">اسم المورد<input aria-label="اسم المورد" required autoFocus maxLength={200} placeholder="اسم الشركة أو المورد" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })}/></label>
      <label className="field">رقم الهاتف<input aria-label="رقم هاتف المورد" type="tel" dir="ltr" maxLength={100} value={draft.phone} onChange={event => setDraft({ ...draft, phone: event.target.value })}/></label>
      <label className="field">البريد الإلكتروني<input aria-label="البريد الإلكتروني للمورد" type="email" dir="ltr" maxLength={320} value={draft.email} onChange={event => setDraft({ ...draft, email: event.target.value })}/></label>
      <label className="field">الرقم الضريبي<input aria-label="الرقم الضريبي للمورد" dir="ltr" maxLength={100} value={draft.taxNumber} onChange={event => setDraft({ ...draft, taxNumber: event.target.value })}/></label>
      <label className="field field-wide">العنوان<textarea aria-label="عنوان المورد" rows={2} maxLength={2000} value={draft.address} onChange={event => setDraft({ ...draft, address: event.target.value })}/></label>
    </div>{error && <p className="form-error" role="alert">{error}</p>}</div><div className="modal-footer"><button type="submit" className="primary-button" disabled={busy}><Save size={17}/>{busy ? 'جارٍ الحفظ…' : editingId ? 'حفظ تعديلات المورد' : 'حفظ المورد'}</button><button type="button" className="secondary-button" disabled={busy} onClick={() => setEditing(false)}>إلغاء</button></div></form></section></div>}

    {deletingSupplier && <div className="modal-backdrop"><section className="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="supplier-delete-title"><div className="modal-header"><h2 id="supplier-delete-title">حذف المورد</h2><button className="icon-button" aria-label="إغلاق" disabled={busy} onClick={() => setDeletingId(null)}><X size={20}/></button></div><div className="modal-body"><p>هل تريد حذف المورد «{deletingSupplier.name}»؟ لا يمكن التراجع عن الحذف دون نسخة احتياطية.</p>{hasLinkedRecords && <p className="form-error" role="alert">هذا المورد مرتبط بفواتير شراء أو مدفوعات؛ لا يمكن حذفه للحفاظ على السجل المالي.</p>}{error && <p className="form-error" role="alert">{error}</p>}</div><div className="modal-footer"><button className="danger-button" disabled={busy || hasLinkedRecords} onClick={() => void remove()}>{busy ? 'جارٍ الحذف…' : 'تأكيد حذف المورد'}</button><button className="secondary-button" disabled={busy} onClick={() => setDeletingId(null)}>إلغاء</button></div></section></div>}

    {statementSupplier && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setStatementId(null); }}><section className="modal invoice-modal invoice-preview" role="dialog" aria-modal="true" aria-labelledby="supplier-statement-title"><div className="modal-header no-print"><div><h2 id="supplier-statement-title">كشف حساب المورد</h2><p>{statementSupplier.name}</p></div><div className="inline-actions"><button className="secondary-button" onClick={() => window.print()}><Printer size={16}/>طباعة / PDF</button><button className="icon-button" aria-label="إغلاق" onClick={() => setStatementId(null)}><X size={20}/></button></div></div><article className="print-invoice invoice-document">
      <header className="invoice-document-header"><div><div className="invoice-brand"><FileText size={28}/><h2>{data.settings.companyName}</h2></div><p>{data.settings.companySubtitle}</p><p>{data.settings.address}</p><p>{data.settings.phone}{data.settings.email ? ` · ${data.settings.email}` : ''}</p>{data.settings.taxNumber && <p>الرقم الضريبي: {data.settings.taxNumber}</p>}</div><div className="invoice-document-number"><h1>كشف حساب مورد</h1><span>تاريخ الكشف: {displayDate(today())}</span><span className={`badge ${supplierBalance(data, statementSupplier.id) > 0 ? 'badge-warning' : 'badge-success'}`}>{supplierBalance(data, statementSupplier.id) > 0 ? 'يوجد رصيد مستحق' : 'الحساب مسدّد'}</span></div></header>
      <div className="invoice-details"><div><span>بيانات المورد</span><h3>{statementSupplier.name}</h3><p>{statementSupplier.address}</p><p dir="ltr">{statementSupplier.phone}</p>{statementSupplier.email && <p>{statementSupplier.email}</p>}{statementSupplier.taxNumber && <p>الرقم الضريبي: {statementSupplier.taxNumber}</p>}</div><div><span>عدد فواتير الشراء</span><strong>{supplierPurchases(statementSupplier.id).length.toLocaleString('ar-EG')}</strong><span>عملة الحساب</span><strong>{data.settings.currency}</strong></div></div>
      <div className="table-scroll"><table className="data-table invoice-lines supplier-statement-table"><thead><tr><th>التاريخ</th><th>المرجع / البيان</th><th>قيمة المشتريات</th><th>المدفوع</th><th>الرصيد المستحق للمورد</th></tr></thead><tbody>{statementRows.map(row => <tr key={row.id}><td>{displayDate(row.date)}</td><td style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}><strong dir="ltr">{row.reference}</strong><small className="cell-note">{row.details}</small></td><td>{row.purchase ? money(row.purchase / 100) : '—'}</td><td>{row.paid ? money(row.paid / 100) : '—'}</td><td>{money(row.balance / 100)}</td></tr>)}{!statementRows.length && <tr><td colSpan={5}>لا توجد فواتير شراء أو مدفوعات مسجلة لهذا المورد.</td></tr>}</tbody></table></div>
      <div className="invoice-totals"><div><span>إجمالي المشتريات</span><strong>{money(purchaseAmount(statementSupplier.id))}</strong></div><div><span>إجمالي المدفوعات</span><strong>{money(paidAmount(statementSupplier.id))}</strong></div><div className="grand-total"><span>المتبقي للمورد</span><strong>{money(supplierBalance(data, statementSupplier.id))}</strong></div></div><div className="invoice-notes"><p>الرصيد يُحسب من فواتير الشراء والمدفوعات المرتبطة بها، ويُرتّب حسب تاريخ الحركة. في اليوم نفسه تظهر فواتير الشراء قبل الدفعات.</p></div><footer className="invoice-document-footer"><span>كشف حساب للمراجعة والمتابعة</span><small>تم الإعداد باستخدام مدى</small></footer>
    </article><div className="modal-footer no-print"><span className="muted">كل دفعة مرتبطة بفاتورة شراء، ولا تُسجَّل مرة ثانية في المصروفات.</span><button className="secondary-button" onClick={() => setStatementId(null)}>إغلاق الكشف</button></div></section></div>}
  </>;
}
