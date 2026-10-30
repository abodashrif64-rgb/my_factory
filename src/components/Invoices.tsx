import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpLeft, ChevronLeft, FileText, Pencil, Plus, Printer, ReceiptText, Trash2, X } from 'lucide-react';
import type { Invoice, InvoiceItem, ModuleProps } from '../types';
import { id, today, invoiceTotal, invoicePaid, invoiceStatus, formatMoney, invoiceSubtotal, invoiceLineTotal } from '../lib/data';

type Props = ModuleProps & { query: string; createRequested?: number };
type Status = 'all' | 'paid' | 'pending' | 'overdue';
const statusNames = { paid: 'مدفوعة', partial: 'مدفوعة جزئيًا', overdue: 'متأخرة', pending: 'بانتظار السداد' };
const statusClasses = { paid: 'badge-success', partial: 'badge-warning', overdue: 'badge-danger', pending: 'badge-neutral' };
const displayDate = (value: string) => new Date(value + 'T12:00:00').toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' });
const newDraft = (tax: number): Omit<Invoice, 'id' | 'number'> => ({ customerId: '', date: today(), dueDate: today(), items: [{ description: '', quantity: 1, price: 0 }], taxRate: tax, discount: 0, notes: '' });

export default function Invoices({ data, onUpdate, notify, query, createRequested = 0 }: Props) {
  const [filter, setFilter] = useState<Status>('all');
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState(newDraft(data.settings.defaultTax));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const lastRequest = useRef(0);
  const money = (value: number) => formatMoney(value, data.settings.currency);
  const openCreate = () => { setDraft(newDraft(data.settings.defaultTax)); setEditingId(null); setError(''); setEditing(true); };
  const openEdit = (invoice: Invoice) => {
    setDraft({ customerId: invoice.customerId, date: invoice.date, dueDate: invoice.dueDate, items: invoice.items.map(item => ({ ...item })), taxRate: invoice.taxRate, discount: invoice.discount, notes: invoice.notes });
    setEditingId(invoice.id); setSelected(null); setError(''); setEditing(true);
  };
  useEffect(() => { if (createRequested > lastRequest.current) { lastRequest.current = createRequested; openCreate(); } }, [createRequested]);
  useEffect(() => {
    if (!editing && !selected && !deletingId) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) { setEditing(false); setSelected(null); setDeletingId(null); } };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [editing, selected, deletingId, saving]);
  const invoices = [...data.invoices].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  const filtered = invoices.filter(invoice => {
    const state = invoiceStatus(data, invoice);
    const customer = data.customers.find(c => c.id === invoice.customerId);
    const matchesFilter = filter === 'all' || state === filter || (filter === 'pending' && state === 'partial');
    return matchesFilter && `${invoice.number} ${customer?.name ?? ''} ${invoice.notes}`.toLowerCase().includes(query.toLowerCase());
  });
  const current = data.invoices.find(invoice => invoice.id === selected);
  const editingInvoice = data.invoices.find(invoice => invoice.id === editingId);
  const deletingInvoice = data.invoices.find(invoice => invoice.id === deletingId);
  const editingHasReceipts = !!editingId && data.receipts.some(receipt => receipt.invoiceId === editingId);
  const deletingHasReceipts = !!deletingId && data.receipts.some(receipt => receipt.invoiceId === deletingId);
  const customer = data.customers.find(c => c.id === current?.customerId);
  const totalSales = data.invoices.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0);
  const totalPaid = data.invoices.reduce((sum, invoice) => sum + invoicePaid(data, invoice.id), 0);
  const patchItem = (index: number, field: keyof InvoiceItem, value: string | number) => setDraft(prev => ({ ...prev, items: prev.items.map((item, i) => i === index ? { ...item, [field]: value } : item) }));
  const subtotal = invoiceSubtotal(draft);
  const draftTotal = invoiceTotal(draft);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (!data.customers.some(c => c.id === draft.customerId)) return setError('اختر عميلًا مسجلًا أولًا. يمكنك إضافة العملاء من قسم العملاء.');
    if (!draft.items.length || draft.items.some(item => !item.description.trim() || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.price) || item.price < 0)) return setError('أكمل وصف كل بند، وأدخل كمية أكبر من صفر وسعرًا صحيحًا.');
    if (draft.dueDate < draft.date) return setError('تاريخ الاستحقاق يجب أن يساوي تاريخ الفاتورة أو يأتي بعده.');
    if (!Number.isFinite(draft.discount) || draft.discount < 0 || draft.discount > subtotal) return setError('قيمة الخصم يجب أن تكون بين صفر وإجمالي البنود.');
    if (!Number.isFinite(draft.taxRate) || draft.taxRate < 0 || draft.taxRate > 100) return setError('نسبة الضريبة يجب أن تكون بين صفر و١٠٠.');
    if (editingInvoice && editingHasReceipts && draft.customerId !== editingInvoice.customerId) return setError('لا يمكن تغيير عميل فاتورة مرتبطة بسندات قبض.');
    if (editingInvoice && Math.round(draftTotal * 100) < Math.round(invoicePaid(data, editingInvoice.id) * 100)) return setError(`لا يمكن أن يقل إجمالي الفاتورة عن المبلغ المحصل (${money(invoicePaid(data, editingInvoice.id))}). راجع سندات القبض أولًا.`);
    const prefix = `INV-${draft.date.slice(0, 4)}-`;
    const maxNumber = data.invoices.reduce((max, invoice) => invoice.number.startsWith(prefix) ? Math.max(max, Number(invoice.number.slice(prefix.length)) || 0) : max, 0);
    const invoice: Invoice = { ...draft, items: draft.items.map(item => ({ ...item, description: item.description.trim() })), id: editingInvoice?.id ?? id(), number: editingInvoice?.number ?? prefix + String(maxNumber + 1).padStart(4, '0') };
    setSaving(true);
    try { await onUpdate({ ...data, invoices: editingInvoice ? data.invoices.map(item => item.id === invoice.id ? invoice : item) : [...data.invoices, invoice] }); setEditing(false); setSelected(invoice.id); notify(editingInvoice ? 'تم حفظ تعديلات الفاتورة' : 'تم إنشاء الفاتورة وحفظها على هذا الجهاز'); }
    catch (err) { setError(err instanceof Error ? err.message : 'تعذّر حفظ الفاتورة. أعد المحاولة.'); }
    finally { setSaving(false); }
  }

  async function deleteInvoice() {
    if (!deletingInvoice || saving) return;
    if (deletingHasReceipts) return setError('لا يمكن حذف فاتورة مرتبطة بسندات قبض. راجع سندات القبض أولًا للحفاظ على السجل المالي.');
    setSaving(true); setError('');
    try { await onUpdate({ ...data, invoices: data.invoices.filter(invoice => invoice.id !== deletingId) }); setDeletingId(null); notify('تم حذف الفاتورة'); }
    catch (err) { setError(err instanceof Error ? err.message : 'تعذّر حذف الفاتورة. أعد المحاولة.'); }
    finally { setSaving(false); }
  }

  return <>
    <div className="page-heading">
      <div><div className="eyebrow">مبيعاتك، من العرض إلى التحصيل</div><h1>الفواتير والمبيعات</h1><p>أنشئ فواتير واضحة، وتابع مستحقاتك أولًا بأول.</p></div>
      <button className="primary-button" onClick={openCreate}><Plus size={18} /> فاتورة جديدة</button>
    </div>
    <div className="invoice-summary-grid">
      <div className="mini-stat"><span>إجمالي المبيعات</span><strong>{money(totalSales)}</strong><small>{data.invoices.length} فاتورة مسجلة</small></div>
      <div className="mini-stat"><span>المبالغ المحصلة</span><strong>{money(totalPaid)}</strong><small>من الفواتير المسجلة</small></div>
      <div className="mini-stat"><span>مستحقات العملاء</span><strong>{money(Math.max(0, totalSales - totalPaid))}</strong><small>تابع السداد من قسم القبض</small></div>
    </div>
    <section className="table-card">
      <div className="table-toolbar"><div className="tabs">{([['all', 'كل الفواتير'], ['paid', 'مدفوعة'], ['pending', 'بانتظار السداد'], ['overdue', 'متأخرة']] as const).map(([value, label]) => <button key={value} className={filter === value ? 'tab active' : 'tab'} onClick={() => setFilter(value)}>{label}<span>{value === 'all' ? data.invoices.length : data.invoices.filter(invoice => invoiceStatus(data, invoice) === value || (value === 'pending' && invoiceStatus(data, invoice) === 'partial')).length}</span></button>)}</div><span className="muted">{filtered.length} فاتورة</span></div>
      {filtered.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>رقم الفاتورة</th><th>العميل</th><th>تاريخ الإصدار</th><th>الإجمالي</th><th>الحالة</th><th aria-label="الإجراءات"></th></tr></thead><tbody>{filtered.map(invoice => {
        const client = data.customers.find(c => c.id === invoice.customerId); const status = invoiceStatus(data, invoice);
        return <tr key={invoice.id}><td><button className="text-button invoice-number" onClick={() => setSelected(invoice.id)}><FileText size={16} /> <span dir="ltr">{invoice.number}</span></button></td><td><div className="table-person"><span className="avatar">{client?.name.slice(0, 1) || 'ع'}</span><div><strong>{client?.name || 'عميل غير متاح'}</strong><small>{client?.phone}</small></div></div></td><td>{displayDate(invoice.date)}</td><td className="amount-cell">{money(invoiceTotal(invoice))}</td><td><span className={`badge ${statusClasses[status]}`}>{statusNames[status]}</span></td><td><div className="row-actions"><button className="icon-button" onClick={() => setSelected(invoice.id)} title="عرض الفاتورة" aria-label={`عرض الفاتورة ${invoice.number}`}><ArrowUpLeft size={18} /></button><button className="icon-button" onClick={() => openEdit(invoice)} title="تعديل الفاتورة" aria-label={`تعديل الفاتورة ${invoice.number}`}><Pencil size={16}/></button><button className="icon-button danger-text" onClick={() => { setDeletingId(invoice.id); setError(''); }} title="حذف الفاتورة" aria-label={`حذف الفاتورة ${invoice.number}`}><Trash2 size={16}/></button></div></td></tr>;
      })}</tbody></table></div> : <div className="empty-state"><ReceiptText size={38} /><h3>لا توجد فواتير هنا بعد</h3><p>{query ? 'جرّب البحث باسم عميل أو رقم فاتورة آخر.' : 'ابدأ بفاتورتك الأولى، وستظهر كل التفاصيل هنا.'}</p>{!query && <button className="secondary-button" onClick={openCreate}><Plus size={16} /> إنشاء فاتورة</button>}</div>}
    </section>

    {editing && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setEditing(false); }}><section className="modal invoice-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-editor-title"><div className="modal-header"><div><h2 id="invoice-editor-title">{editingId ? 'تعديل الفاتورة' : 'فاتورة جديدة'}</h2><p>كل التفاصيل التي يحتاجها عميلك، في مكان واحد.</p></div><button type="button" className="icon-button" aria-label="إغلاق" disabled={saving} onClick={() => setEditing(false)}><X size={20}/></button></div><form onSubmit={save} className="invoice-editor"><div className="modal-body">
      {!data.customers.length && <div className="form-error">أضف عميلًا من قسم العملاء قبل إنشاء فاتورة.</div>}
      <div className="form-grid"><label className="field field-full">العميل<select required disabled={editingHasReceipts} aria-label="العميل" value={draft.customerId} onChange={event => setDraft({ ...draft, customerId: event.target.value })}><option value="">اختر العميل</option>{data.customers.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label className="field">تاريخ الفاتورة<input type="date" required value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })}/></label><label className="field">تاريخ الاستحقاق<input type="date" required min={draft.date} value={draft.dueDate} onChange={event => setDraft({ ...draft, dueDate: event.target.value })}/></label></div>
      {editingHasReceipts && <p className="form-hint">هذه الفاتورة مرتبطة بسندات قبض؛ لا يمكن تغيير العميل أو تقليل الإجمالي عن المبلغ المحصل.</p>}
      <div className="section-label"><h3>بنود الفاتورة</h3><span>الأسعار قبل الضريبة</span></div>
      <div className="invoice-items">{draft.items.map((item, index) => <div className="invoice-item-row" key={index}><label className="field item-description">وصف البند<input aria-label={`وصف البند ${index + 1}`} required maxLength={500} placeholder="منتج أو خدمة" value={item.description} onChange={event => patchItem(index, 'description', event.target.value)}/></label><label className="field">الكمية<input aria-label={`كمية البند ${index + 1}`} type="number" min="0.01" max="1000000" step="0.01" required value={item.quantity} onChange={event => patchItem(index, 'quantity', event.target.value === '' ? '' : Number(event.target.value))}/></label><label className="field">سعر الوحدة<input aria-label={`سعر البند ${index + 1}`} type="number" min="0" max="1000000000" step="0.01" required value={item.price} onChange={event => patchItem(index, 'price', event.target.value === '' ? '' : Number(event.target.value))}/></label><button type="button" className="icon-button danger" aria-label={`حذف البند ${index + 1}`} disabled={draft.items.length === 1} onClick={() => setDraft({ ...draft, items: draft.items.filter((_, i) => i !== index) })}><Trash2 size={17}/></button></div>)}</div>
      <button type="button" className="text-button" disabled={draft.items.length >= 100} onClick={() => setDraft({ ...draft, items: [...draft.items, { description: '', quantity: 1, price: 0 }] })}><Plus size={16}/> إضافة بند</button>
      <div className="form-grid invoice-adjustments"><label className="field">الضريبة (%)<input type="number" min="0" max="100" step="0.01" required value={draft.taxRate} onChange={event => setDraft({ ...draft, taxRate: Number(event.target.value) })}/></label><label className="field">خصم ثابت<input type="number" min="0" max={subtotal} step="0.01" required value={draft.discount} onChange={event => setDraft({ ...draft, discount: Number(event.target.value) })}/></label><label className="field field-full">ملاحظات للعميل<textarea rows={2} maxLength={2000} placeholder="شروط الدفع أو تفاصيل إضافية (اختياري)" value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })}/></label></div>
      <div className="invoice-total-strip"><span>إجمالي الفاتورة شامل الضريبة</span><strong>{money(Number.isFinite(draftTotal) ? draftTotal : 0)}</strong></div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div><div className="modal-footer"><button type="submit" className="primary-button" disabled={saving || !data.customers.length}><FileText size={17}/>{saving ? 'جارٍ الحفظ…' : editingId ? 'حفظ التعديلات' : 'حفظ الفاتورة'}</button><button type="button" className="secondary-button" disabled={saving} onClick={() => setEditing(false)}>إلغاء</button></div></form></section></div>}

    {deletingInvoice && <div className="modal-backdrop"><section className="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="delete-invoice-title"><div className="modal-header"><h2 id="delete-invoice-title">حذف الفاتورة</h2><button className="icon-button" aria-label="إغلاق" disabled={saving} onClick={() => setDeletingId(null)}><X size={20}/></button></div><div className="modal-body"><p>هل تريد حذف الفاتورة <strong dir="ltr">{deletingInvoice.number}</strong>؟ سيُعاد احتساب المبيعات، ولا يمكن التراجع عن الحذف دون نسخة احتياطية.</p>{deletingHasReceipts && <p className="form-error" role="alert">لا يمكن حذف فاتورة مرتبطة بسندات قبض. راجع سندات القبض أولًا للحفاظ على السجل المالي.</p>}{error && <p className="form-error" role="alert">{error}</p>}</div><div className="modal-footer"><button className="primary-button danger-button" disabled={saving || deletingHasReceipts} onClick={deleteInvoice}>{saving ? 'جارٍ الحذف…' : 'تأكيد حذف الفاتورة'}</button><button className="secondary-button" disabled={saving} onClick={() => setDeletingId(null)}>إلغاء</button></div></section></div>}

    {current && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSelected(null); }}><section className="modal invoice-modal invoice-preview" role="dialog" aria-modal="true" aria-labelledby="invoice-view-title"><div className="modal-header no-print"><div><h2 id="invoice-view-title">تفاصيل الفاتورة</h2><p dir="ltr">{current.number}</p></div><div className="inline-actions"><button className="secondary-button" onClick={() => window.print()}><Printer size={16}/> طباعة / PDF</button><button className="icon-button" aria-label="إغلاق" onClick={() => setSelected(null)}><X size={20}/></button></div></div><article className="print-invoice invoice-document"><header className="invoice-document-header"><div><div className="invoice-brand"><ReceiptText size={28}/><h2>{data.settings.companyName}</h2></div><p>{data.settings.companySubtitle}</p><p>{data.settings.address}</p><p>{data.settings.phone}{data.settings.email ? ` · ${data.settings.email}` : ''}</p>{data.settings.taxNumber && <p>الرقم الضريبي: {data.settings.taxNumber}</p>}</div><div className="invoice-document-number"><h1>فاتورة</h1><strong dir="ltr">{current.number}</strong><span className={`badge ${statusClasses[invoiceStatus(data, current)]}`}>{statusNames[invoiceStatus(data, current)]}</span></div></header><div className="invoice-details"><div><span>فاتورة إلى</span><h3>{customer?.name}</h3><p>{customer?.address}</p><p dir="ltr">{customer?.phone}</p>{customer?.email && <p>{customer.email}</p>}</div><div><span>تاريخ الإصدار</span><strong>{displayDate(current.date)}</strong><span>تاريخ الاستحقاق</span><strong>{displayDate(current.dueDate)}</strong></div></div><div className="table-scroll"><table className="data-table invoice-lines"><thead><tr><th>البيان</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>{current.items.map((item, index) => <tr key={index}><td>{item.description}</td><td>{item.quantity}</td><td>{money(item.price)}</td><td>{money(invoiceLineTotal(item))}</td></tr>)}</tbody></table></div><div className="invoice-totals"><div><span>الإجمالي قبل الخصم والضريبة</span><strong>{money(invoiceSubtotal(current))}</strong></div><div><span>الخصم</span><strong>{money(current.discount)}</strong></div><div><span>الضريبة ({current.taxRate}%)</span><strong>{money(invoiceTotal(current) - (invoiceSubtotal(current) - current.discount))}</strong></div><div className="grand-total"><span>الإجمالي المستحق</span><strong>{money(invoiceTotal(current))}</strong></div><div><span>المدفوع</span><strong>{money(invoicePaid(data, current.id))}</strong></div><div><span>المتبقي</span><strong>{money(Math.max(0, invoiceTotal(current) - invoicePaid(data, current.id)))}</strong></div></div>{current.notes && <div className="invoice-notes"><h4>ملاحظات</h4><p>{current.notes}</p></div>}<footer className="invoice-document-footer"><span>شكرًا لثقتكم وتعاملكم معنا</span><small>تم إعداد هذه الفاتورة باستخدام مدى</small></footer></article><div className="modal-footer no-print"><span className="muted">لتسجيل دفعة، استخدم قسم القبض والتحصيل.</span><button className="secondary-button" onClick={() => setSelected(null)}>تم <ChevronLeft size={16}/></button></div></section></div>}
  </>;
}
