import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUpLeft, Banknote, CheckCircle2, FileText, Pencil, Plus, Printer, ShoppingCart, Trash2, Wallet, X } from 'lucide-react';
import type { AppData, ModuleProps, PurchaseInvoice, PurchaseItem, SupplierPayment } from '../types';
import { formatMoney, id, invoiceLineTotal, purchasePaid, purchaseStatus, purchaseSubtotal, purchaseTotal, today } from '../lib/data';

type Draft = Omit<PurchaseInvoice, 'id' | 'number'>;
type PaymentDraft = Omit<SupplierPayment, 'id' | 'purchaseId' | 'supplierId'>;
type Filter = 'all' | 'paid' | 'pending' | 'overdue';
const units: PurchaseItem['unit'][] = ['ورقة', 'رزمة', 'طن', 'كيلوجرام', 'قطعة', 'رول', 'خدمة'];
const statusNames = { paid: 'مدفوعة', partial: 'مدفوعة جزئيًا', pending: 'بانتظار السداد', overdue: 'متأخرة' };
const statusClasses = { paid: 'badge-success', partial: 'badge-warning', pending: 'badge-neutral', overdue: 'badge-danger' };
const methodNames = { cash: 'نقدي', bank: 'تحويل بنكي', wallet: 'محفظة إلكترونية' };
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100);
const validMoney = (value: number) => Number.isFinite(value) && value >= 0 && Math.abs(value * 100 - Math.round(value * 100)) < 0.0001;
const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' });
const freshDraft = (tax: number): Draft => ({ supplierId: '', supplierInvoiceNumber: '', date: today(), dueDate: today(), items: [{ description: '', unit: 'ورقة', quantity: 1, price: 0 }], taxRate: tax, discount: 0, notes: '' });
const freshPayment = (amount: number): PaymentDraft => ({ amount, date: today(), method: 'cash', notes: '' });

export default function Purchases({ data, onUpdate, notify, query }: ModuleProps & { query: string }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [editor, setEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(freshDraft(data.settings.defaultTax));
  const [initialPayment, setInitialPayment] = useState(0);
  const [initialMethod, setInitialMethod] = useState<SupplierPayment['method']>('cash');
  const [paymentPurchaseId, setPaymentPurchaseId] = useState<string | null>(null);
  const [paymentEditingId, setPaymentEditingId] = useState<string | null>(null);
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft>(freshPayment(0));
  const [deleting, setDeleting] = useState<{ kind: 'purchase' | 'payment'; id: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const money = (value: number) => formatMoney(value, data.settings.currency);
  const selected = data.purchases.find(p => p.id === selectedId);
  const editing = data.purchases.find(p => p.id === editingId);
  const selectedSupplier = data.suppliers.find(s => s.id === selected?.supplierId);
  const paymentPurchase = data.purchases.find(p => p.id === paymentPurchaseId);
  const editingPayment = data.supplierPayments.find(p => p.id === paymentEditingId);
  const hasEditingPayments = !!editingId && data.supplierPayments.some(p => p.purchaseId === editingId);
  const deletingPurchase = deleting?.kind === 'purchase' ? data.purchases.find(p => p.id === deleting.id) : undefined;
  const deletingPayment = deleting?.kind === 'payment' ? data.supplierPayments.find(p => p.id === deleting.id) : undefined;
  const hasDeletingPayments = !!deletingPurchase && data.supplierPayments.some(p => p.purchaseId === deletingPurchase.id);
  const selectedPayments = selected ? data.supplierPayments.filter(p => p.purchaseId === selected.id).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const paymentLimit = paymentPurchase ? (cents(purchaseTotal(paymentPurchase)) - cents(purchasePaid(data, paymentPurchase.id)) + cents(editingPayment?.amount ?? 0)) / 100 : 0;
  const subtotal = purchaseSubtotal(draft);
  const draftTotal = purchaseTotal(draft);
  const safeDraftTotal = Number.isFinite(draftTotal) ? Math.max(0, draftTotal) : 0;
  const totalPurchases = data.purchases.reduce((sum, p) => sum + cents(purchaseTotal(p)), 0) / 100;
  const totalPaid = data.supplierPayments.reduce((sum, p) => sum + cents(p.amount), 0) / 100;
  const filtered = [...data.purchases].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)).filter(p => {
    const status = purchaseStatus(data, p);
    const supplier = data.suppliers.find(s => s.id === p.supplierId);
    return (filter === 'all' || filter === status || (filter === 'pending' && status === 'partial')) && `${p.number} ${p.supplierInvoiceNumber} ${supplier?.name ?? ''} ${p.notes} ${p.items.map(i => i.description).join(' ')}`.toLocaleLowerCase('ar').includes(query.trim().toLocaleLowerCase('ar'));
  });

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      if (deleting) setDeleting(null);
      else if (paymentPurchaseId) setPaymentPurchaseId(null);
      else if (editor) setEditor(false);
      else setSelectedId(null);
      setError('');
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [busy, deleting, paymentPurchaseId, editor]);

  const openCreate = () => { setDraft(freshDraft(data.settings.defaultTax)); setEditingId(null); setInitialPayment(0); setInitialMethod('cash'); setError(''); setEditor(true); };
  const openEdit = (p: PurchaseInvoice) => {
    setDraft({ supplierId: p.supplierId, supplierInvoiceNumber: p.supplierInvoiceNumber, date: p.date, dueDate: p.dueDate, items: p.items.map(item => ({ ...item })), taxRate: p.taxRate, discount: p.discount, notes: p.notes });
    setEditingId(p.id); setSelectedId(null); setInitialPayment(0); setError(''); setEditor(true);
  };
  const openPayment = (purchase: PurchaseInvoice, payment?: SupplierPayment) => {
    const remainder = Math.max(0, (cents(purchaseTotal(purchase)) - cents(purchasePaid(data, purchase.id))) / 100);
    setPaymentPurchaseId(purchase.id); setPaymentEditingId(payment?.id ?? null);
    setPaymentDraft(payment ? { amount: payment.amount, date: payment.date, method: payment.method, notes: payment.notes } : freshPayment(remainder)); setError('');
  };
  const patchItem = (index: number, key: keyof PurchaseItem, value: string | number) => setDraft(previous => ({ ...previous, items: previous.items.map((item, i) => i === index ? { ...item, [key]: value } : item) }));
  const persist = async (next: AppData, success: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true); setError('');
    try { await onUpdate(next); notify(success); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذّر حفظ التغييرات. أعد المحاولة.'); return false; }
    finally { setBusy(false); }
  };

  const savePurchase = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setError('');
    if (!data.suppliers.some(s => s.id === draft.supplierId)) return setError('اختر موردًا مسجلًا. أضف المورد أولًا من قسم الموردين.');
    if (!draft.items.length || draft.items.some(item => !item.description.trim() || !Number.isFinite(item.quantity) || item.quantity <= 0 || Math.abs(item.quantity * 1000 - Math.round(item.quantity * 1000)) > 0.0001 || !validMoney(item.price) || !units.includes(item.unit))) return setError('أكمل اسم كل صنف ووحدته؛ الكمية أكبر من صفر وحتى ثلاث منازل، والسعر حتى منزلتين عشريتين.');
    if (draft.dueDate < draft.date) return setError('تاريخ الاستحقاق لا يمكن أن يسبق تاريخ الشراء.');
    if (!validMoney(draft.discount) || cents(draft.discount) > cents(subtotal)) return setError('الخصم يجب ألا يتجاوز مجموع الأصناف، وبحد أقصى منزلتين عشريتين.');
    if (!Number.isFinite(draft.taxRate) || draft.taxRate < 0 || draft.taxRate > 100 || Math.abs(draft.taxRate * 100 - Math.round(draft.taxRate * 100)) > 0.0001) return setError('أدخل نسبة ضريبة بين صفر و١٠٠ وبحد أقصى منزلتين عشريتين.');
    if (!Number.isFinite(draftTotal) || draftTotal <= 0) return setError('إجمالي فاتورة الشراء يجب أن يكون أكبر من صفر.');
    const external = draft.supplierInvoiceNumber.trim();
    if (external && data.purchases.some(p => p.id !== editingId && p.supplierId === draft.supplierId && p.supplierInvoiceNumber.trim().toUpperCase() === external.toUpperCase())) return setError('رقم فاتورة المورد مسجل بالفعل لهذا المورد. راجع الفاتورة السابقة قبل إضافته مرة أخرى.');
    if (editing && hasEditingPayments && draft.supplierId !== editing.supplierId) return setError('لا يمكن تغيير مورد فاتورة مرتبطة بمدفوعات.');
    if (editing && cents(draftTotal) < cents(purchasePaid(data, editing.id))) return setError(`لا يمكن أن يقل إجمالي الفاتورة عن المدفوع (${money(purchasePaid(data, editing.id))}). راجع دفعات المورد أولًا.`);
    if (!editing && (!validMoney(initialPayment) || initialPayment < 0 || cents(initialPayment) > cents(draftTotal))) return setError('الدفعة الأولى يجب أن تكون بين صفر وإجمالي الفاتورة وبحد أقصى منزلتين عشريتين.');
    const prefix = `PUR-${draft.date.slice(0, 4)}-`;
    const sequence = data.purchases.reduce((max, p) => p.number.startsWith(prefix) ? Math.max(max, Number(p.number.slice(prefix.length)) || 0) : max, 0) + 1;
    const purchase: PurchaseInvoice = { ...draft, id: editing?.id ?? id(), number: editing?.number ?? prefix + String(sequence).padStart(4, '0'), supplierInvoiceNumber: external, items: draft.items.map(item => ({ ...item, description: item.description.trim() })), notes: draft.notes.trim() };
    const first: SupplierPayment[] = !editing && initialPayment > 0 ? [{ id: id(), purchaseId: purchase.id, supplierId: purchase.supplierId, amount: initialPayment, date: purchase.date, method: initialMethod, notes: 'دفعة عند تسجيل فاتورة الشراء' }] : [];
    const next = { ...data, purchases: editing ? data.purchases.map(p => p.id === purchase.id ? purchase : p) : [...data.purchases, purchase], supplierPayments: [...data.supplierPayments, ...first] };
    if (await persist(next, editing ? 'تم حفظ تعديلات فاتورة الشراء' : 'تم حفظ فاتورة الشراء ومدفوعاتها')) { setEditor(false); setEditingId(null); setSelectedId(purchase.id); }
  };

  const savePayment = async (event: FormEvent) => {
    event.preventDefault(); if (busy || !paymentPurchase) return; setError('');
    if (!validMoney(paymentDraft.amount) || paymentDraft.amount <= 0 || cents(paymentDraft.amount) > cents(paymentLimit)) return setError(`أدخل مبلغًا أكبر من صفر ولا يتجاوز المتبقي (${money(paymentLimit)}).`);
    if (!paymentDraft.date) return setError('حدد تاريخ الدفع.');
    const payment: SupplierPayment = { ...paymentDraft, id: editingPayment?.id ?? id(), purchaseId: paymentPurchase.id, supplierId: paymentPurchase.supplierId, notes: paymentDraft.notes.trim() };
    const next = { ...data, supplierPayments: editingPayment ? data.supplierPayments.map(p => p.id === payment.id ? payment : p) : [...data.supplierPayments, payment] };
    if (await persist(next, editingPayment ? 'تم تحديث دفعة المورد وإعادة احتساب الرصيد' : 'تم تسجيل دفعة المورد وتحديث رصيد الفاتورة')) { setPaymentPurchaseId(null); setPaymentEditingId(null); }
  };

  const remove = async () => {
    if (!deleting || busy) return;
    if (deletingPurchase) {
      if (hasDeletingPayments) { setError('لا يمكن حذف فاتورة لها مدفوعات. راجع الدفعات المرتبطة وألغِ أي دفعة مسجلة بالخطأ أولًا.'); return; }
      if (await persist({ ...data, purchases: data.purchases.filter(p => p.id !== deleting.id) }, 'تم حذف فاتورة الشراء')) { if (selectedId === deleting.id) setSelectedId(null); setDeleting(null); }
    } else if (deletingPayment) {
      if (await persist({ ...data, supplierPayments: data.supplierPayments.filter(p => p.id !== deleting.id) }, 'تم حذف الدفعة وإعادة احتساب المستحق للمورد')) setDeleting(null);
    }
  };

  return <>
    <div className="page-heading"><div><div className="eyebrow">من فاتورة المورد إلى آخر دفعة</div><h1>المشتريات</h1><p>أصناف وكميات وأسعار فعلية، ورصيد واضح لكل فاتورة ومورد.</p></div><button className="primary-button" onClick={openCreate}><Plus size={18}/>فاتورة شراء جديدة</button></div>
    <div className="invoice-summary-grid"><div className="mini-stat"><span>إجمالي فواتير الشراء</span><strong>{money(totalPurchases)}</strong><small>{data.purchases.length} فاتورة مسجلة</small></div><div className="mini-stat"><span>مدفوعات الموردين</span><strong>{money(totalPaid)}</strong><small>تظهر تلقائيًا في التدفقات النقدية</small></div><div className="mini-stat"><span>المستحق للموردين</span><strong>{money(Math.max(0, (cents(totalPurchases) - cents(totalPaid)) / 100))}</strong><small>المتبقي على فواتير الشراء</small></div></div>
    <section className="table-card"><div className="table-toolbar"><div className="tabs">{([['all', 'كل المشتريات'], ['paid', 'مدفوعة'], ['pending', 'بانتظار السداد'], ['overdue', 'متأخرة']] as const).map(([value, label]) => <button className={filter === value ? 'tab active' : 'tab'} onClick={() => setFilter(value)} key={value}>{label}<span>{data.purchases.filter(p => value === 'all' || purchaseStatus(data, p) === value || (value === 'pending' && purchaseStatus(data, p) === 'partial')).length}</span></button>)}</div><span className="muted">{filtered.length} فاتورة</span></div>
      {filtered.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>الفاتورة</th><th>المورد</th><th>تاريخ الشراء</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>{filtered.map(p => { const supplier = data.suppliers.find(s => s.id === p.supplierId); const status = purchaseStatus(data, p); const balance = Math.max(0, (cents(purchaseTotal(p)) - cents(purchasePaid(data, p.id))) / 100); return <tr key={p.id}><td><button className="text-button invoice-number" onClick={() => { setSelectedId(p.id); setError(''); }}><FileText size={16}/><span dir="ltr">{p.number}</span></button>{p.supplierInvoiceNumber && <small className="cell-note">رقم المورد: {p.supplierInvoiceNumber}</small>}</td><td><div className="table-person"><span className="avatar">{supplier?.name.slice(0, 1) || 'م'}</span><div><strong>{supplier?.name}</strong><small>{supplier?.phone}</small></div></div></td><td>{dateLabel(p.date)}</td><td className="amount-cell">{money(purchaseTotal(p))}</td><td>{money(purchasePaid(data, p.id))}</td><td className="amount-cell">{money(balance)}</td><td><span className={`badge ${statusClasses[status]}`}>{statusNames[status]}</span></td><td><div className="row-actions"><button className="icon-button" title="عرض وطباعة" aria-label={`عرض فاتورة الشراء ${p.number}`} onClick={() => { setSelectedId(p.id); setError(''); }}><ArrowUpLeft size={17}/></button><button className="icon-button" title="تعديل الفاتورة" aria-label={`تعديل فاتورة الشراء ${p.number}`} onClick={() => openEdit(p)}><Pencil size={16}/></button><button className="icon-button" title="تسجيل دفعة" disabled={balance <= 0} aria-label={`تسجيل دفعة ${p.number}`} onClick={() => openPayment(p)}><Banknote size={17}/></button><button className="icon-button danger-text" title="حذف الفاتورة" aria-label={`حذف فاتورة الشراء ${p.number}`} onClick={() => { setDeleting({ kind: 'purchase', id: p.id }); setError(''); }}><Trash2 size={16}/></button></div></td></tr>; })}</tbody></table></div> : <div className="empty-state"><ShoppingCart size={38}/><h3>{query ? 'لا توجد مشتريات مطابقة' : 'جهّز أول فاتورة مشتريات'}</h3><p>{query ? 'جرّب اسم المورد أو وصف الصنف أو رقم الفاتورة.' : data.suppliers.length ? 'أضف الأصناف والكميات والأسعار، وحدد المدفوع نقدًا أو اترك الرصيد آجلًا.' : 'ابدأ بإضافة مورد من قسم الموردين، ثم سجّل فاتورة الشراء هنا.'}</p><button className="secondary-button" onClick={openCreate}><Plus size={17}/>إنشاء فاتورة شراء</button></div>}
    </section>
    <p className="report-note">مدفوعات الموردين تُحتسب في التدفق النقدي تلقائيًا؛ لا تحتاج تسجيلها مرة أخرى في المصروفات. تسجيل فاتورة شراء هنا لا يحدّث مخزونًا آليًا.</p>

    {editor && <div className="modal-backdrop"><section className="modal invoice-modal purchase-editor-modal" role="dialog" aria-modal="true" aria-labelledby="purchase-editor-title"><div className="modal-header"><div><h2 id="purchase-editor-title">{editing ? 'تعديل فاتورة الشراء' : 'فاتورة شراء جديدة'}</h2><p>سجّل مشتريات الورق والخامات والخدمات بالأرقام.</p></div><button className="icon-button" aria-label="إغلاق" disabled={busy} onClick={() => setEditor(false)}><X size={20}/></button></div><form onSubmit={savePurchase} className="invoice-editor"><div className="modal-body">
      {!data.suppliers.length && <div className="form-error" role="alert">أضف موردًا من قسم الموردين قبل حفظ فاتورة الشراء.</div>}
      <div className="form-grid"><label className="field">المورد<select aria-label="المورد" required disabled={hasEditingPayments} value={draft.supplierId} onChange={event => setDraft({ ...draft, supplierId: event.target.value })}><option value="">اختر المورد</option>{data.suppliers.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label><label className="field">رقم فاتورة المورد<input maxLength={100} placeholder="رقم الفاتورة الأصلية (اختياري)" value={draft.supplierInvoiceNumber} onChange={event => setDraft({ ...draft, supplierInvoiceNumber: event.target.value })}/></label><label className="field">تاريخ الشراء<input required type="date" value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })}/></label><label className="field">تاريخ الاستحقاق<input required type="date" min={draft.date} value={draft.dueDate} onChange={event => setDraft({ ...draft, dueDate: event.target.value })}/></label></div>
      {hasEditingPayments && <p className="form-hint">الفاتورة مرتبطة بمدفوعات؛ المورد ثابت، ولا يمكن تقليل الإجمالي عن المبلغ المدفوع.</p>}
      <div className="section-label"><h3>أصناف المشتريات</h3><span>قيمة كل بند = الكمية × سعر الوحدة</span></div>
      <div className="purchase-items">{draft.items.map((item, index) => <div className="purchase-item-row" key={index}><label className="field">الصنف / البيان<input aria-label={`وصف صنف ${index + 1}`} required maxLength={500} placeholder="مثل: ورق دوبلكس ٣٥٠ جم" value={item.description} onChange={event => patchItem(index, 'description', event.target.value)}/></label><label className="field">الوحدة<select aria-label={`وحدة صنف ${index + 1}`} value={item.unit} onChange={event => patchItem(index, 'unit', event.target.value)}>{units.map(unit => <option key={unit}>{unit}</option>)}</select></label><label className="field">الكمية<input aria-label={`كمية صنف ${index + 1}`} required type="number" min="0.001" max="1000000" step="0.001" value={item.quantity} onChange={event => patchItem(index, 'quantity', event.target.value === '' ? '' : Number(event.target.value))}/></label><label className="field">سعر الوحدة<input aria-label={`سعر صنف ${index + 1}`} required type="number" min="0" max="1000000000" step="0.01" value={item.price} onChange={event => patchItem(index, 'price', event.target.value === '' ? '' : Number(event.target.value))}/></label><div className="field purchase-line-total"><span>الإجمالي</span><strong>{money(Number.isFinite(invoiceLineTotal(item)) ? invoiceLineTotal(item) : 0)}</strong></div><button type="button" className="icon-button danger-text" aria-label={`حذف صنف ${index + 1}`} disabled={draft.items.length <= 1} onClick={() => setDraft({ ...draft, items: draft.items.filter((_, i) => i !== index) })}><Trash2 size={17}/></button></div>)}</div>
      <button type="button" className="text-button" disabled={draft.items.length >= 100} onClick={() => setDraft({ ...draft, items: [...draft.items, { description: '', unit: 'ورقة', quantity: 1, price: 0 }] })}><Plus size={16}/>إضافة صنف</button>
      <div className="form-grid invoice-adjustments"><label className="field">ضريبة المشتريات (%)<input type="number" min="0" max="100" step="0.01" required value={draft.taxRate} onChange={event => setDraft({ ...draft, taxRate: Number(event.target.value) })}/></label><label className="field">خصم المشتريات<input type="number" min="0" max={Math.max(0, subtotal)} step="0.01" required value={draft.discount} onChange={event => setDraft({ ...draft, discount: Number(event.target.value) })}/></label><label className="field field-wide">ملاحظات الشراء<textarea maxLength={2000} rows={2} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })}/></label></div>
      <div className="purchase-total-breakdown"><span>مجموع الأصناف <strong>{money(Number.isFinite(subtotal) ? subtotal : 0)}</strong></span><span>الخصم <strong>{money(Number.isFinite(draft.discount) ? draft.discount : 0)}</strong></span><span>الضريبة <strong>{money(Number.isFinite(draftTotal - subtotal + draft.discount) ? draftTotal - subtotal + draft.discount : 0)}</strong></span></div>
      <div className="invoice-total-strip"><span>إجمالي فاتورة الشراء</span><strong>{money(safeDraftTotal)}</strong></div>
      {!editing && <div className="form-grid invoice-adjustments"><label className="field">دفعة أولى عند الشراء<input aria-label="دفعة أولى عند الشراء" type="number" min="0" max={safeDraftTotal} step="0.01" required value={initialPayment} onChange={event => setInitialPayment(Number(event.target.value))}/><small>اتركها صفرًا للشراء الآجل، أو أدخل إجمالي الفاتورة للسداد الكامل.</small></label><label className="field">طريقة دفع الدفعة الأولى<select value={initialMethod} onChange={event => setInitialMethod(event.target.value as SupplierPayment['method'])}>{Object.entries(methodNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><div className="field field-wide form-hint">المتبقي للمورد بعد هذه الدفعة: <strong>{money(Math.max(0, (cents(safeDraftTotal) - cents(initialPayment || 0)) / 100))}</strong></div></div>}
      {error && <div className="form-error" role="alert">{error}</div>}
    </div><div className="modal-footer"><button className="primary-button" disabled={busy || !data.suppliers.length}><ShoppingCart size={17}/>{busy ? 'جارٍ الحفظ…' : editing ? 'حفظ تعديلات الشراء' : 'حفظ فاتورة الشراء'}</button><button type="button" className="secondary-button" disabled={busy} onClick={() => setEditor(false)}>إلغاء</button></div></form></section></div>}

    {selected && !paymentPurchaseId && !deleting && <div className="modal-backdrop"><section className="modal invoice-modal invoice-preview" role="dialog" aria-modal="true" aria-labelledby="purchase-view-title"><div className="modal-header no-print"><div><h2 id="purchase-view-title">تفاصيل فاتورة الشراء</h2><p dir="ltr">{selected.number}</p></div><div className="inline-actions purchase-actions-wrap"><button className="secondary-button" onClick={() => window.print()}><Printer size={16}/>طباعة / PDF</button><button className="icon-button" aria-label="إغلاق" onClick={() => setSelectedId(null)}><X size={20}/></button></div></div><article className="print-invoice invoice-document"><header className="invoice-document-header"><div><div className="invoice-brand"><ShoppingCart size={28}/><h2>{data.settings.companyName}</h2></div><p>{data.settings.companySubtitle}</p><p>{data.settings.address}</p><p>{data.settings.phone}</p>{data.settings.taxNumber && <p>الرقم الضريبي: {data.settings.taxNumber}</p>}</div><div className="invoice-document-number"><h1>فاتورة شراء</h1><strong dir="ltr">{selected.number}</strong><span className={`badge ${statusClasses[purchaseStatus(data, selected)]}`}>{statusNames[purchaseStatus(data, selected)]}</span></div></header><div className="invoice-details"><div><span>المورد</span><h3>{selectedSupplier?.name}</h3><p>{selectedSupplier?.address}</p><p dir="ltr">{selectedSupplier?.phone}</p>{selectedSupplier?.taxNumber && <p>الرقم الضريبي: {selectedSupplier.taxNumber}</p>}{selected.supplierInvoiceNumber && <p>رقم فاتورة المورد: <strong dir="ltr">{selected.supplierInvoiceNumber}</strong></p>}</div><div><span>تاريخ الشراء</span><strong>{dateLabel(selected.date)}</strong><span>تاريخ الاستحقاق</span><strong>{dateLabel(selected.dueDate)}</strong></div></div><div className="table-scroll"><table className="data-table invoice-lines"><thead><tr><th>الصنف / البيان</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>{selected.items.map((item, index) => <tr key={index}><td>{item.description}</td><td>{item.unit}</td><td>{item.quantity}</td><td>{money(item.price)}</td><td>{money(invoiceLineTotal(item))}</td></tr>)}</tbody></table></div><div className="invoice-totals"><div><span>مجموع الأصناف</span><strong>{money(purchaseSubtotal(selected))}</strong></div><div><span>الخصم</span><strong>{money(selected.discount)}</strong></div><div><span>الضريبة ({selected.taxRate}%)</span><strong>{money(purchaseTotal(selected) - purchaseSubtotal(selected) + selected.discount)}</strong></div><div className="grand-total"><span>الإجمالي المستحق</span><strong>{money(purchaseTotal(selected))}</strong></div><div><span>المدفوع للمورد</span><strong>{money(purchasePaid(data, selected.id))}</strong></div><div><span>المتبقي للمورد</span><strong>{money(Math.max(0, (cents(purchaseTotal(selected)) - cents(purchasePaid(data, selected.id))) / 100))}</strong></div></div>{selected.notes && <div className="invoice-notes"><h4>ملاحظات</h4><p>{selected.notes}</p></div>}<section className="purchase-ledger"><div className="section-label"><h3>سجل دفعات المورد</h3><span>{selectedPayments.length} دفعة</span></div>{selectedPayments.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>التاريخ</th><th>طريقة الدفع</th><th>المبلغ</th><th>البيان</th><th className="no-print">إجراءات</th></tr></thead><tbody>{selectedPayments.map(payment => <tr key={payment.id}><td>{dateLabel(payment.date)}</td><td>{methodNames[payment.method]}</td><td className="amount-cell">{money(payment.amount)}</td><td>{payment.notes || '—'}</td><td className="no-print"><div className="row-actions"><button className="icon-button" aria-label={`تعديل دفعة ${payment.id}`} title="تعديل الدفعة" onClick={() => openPayment(selected, payment)}><Pencil size={15}/></button><button className="icon-button danger-text" aria-label={`حذف دفعة ${payment.id}`} title="حذف دفعة مسجلة بالخطأ" onClick={() => { setDeleting({ kind: 'payment', id: payment.id }); setError(''); }}><Trash2 size={15}/></button></div></td></tr>)}</tbody></table></div> : <p className="muted">لا توجد دفعات مسجلة لهذه الفاتورة بعد.</p>}</section><footer className="invoice-document-footer"><span>مستند داخلي لتوثيق فاتورة المورد ومدفوعاتها</span><small>تم الإعداد باستخدام مدى</small></footer></article><div className="modal-footer no-print"><button className="primary-button" disabled={cents(purchasePaid(data, selected.id)) >= cents(purchaseTotal(selected))} onClick={() => openPayment(selected)}><Banknote size={17}/>تسجيل دفعة للمورد</button><button className="secondary-button" onClick={() => openEdit(selected)}><Pencil size={16}/>تعديل الفاتورة</button><button className="secondary-button" onClick={() => setSelectedId(null)}>إغلاق</button></div></section></div>}

    {paymentPurchase && <div className="modal-backdrop"><section className="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="supplier-payment-title"><div className="modal-header"><div><h2 id="supplier-payment-title">{editingPayment ? 'تعديل دفعة المورد' : 'تسجيل دفعة للمورد'}</h2><p>{data.suppliers.find(s => s.id === paymentPurchase.supplierId)?.name} · <span dir="ltr">{paymentPurchase.number}</span></p></div><button className="icon-button" aria-label="إغلاق" disabled={busy} onClick={() => setPaymentPurchaseId(null)}><X size={20}/></button></div><form onSubmit={savePayment}><div className="modal-body"><div className="local-storage-note"><Wallet size={18}/>المتاح للسداد: {money(paymentLimit)}</div><div className="form-grid"><label className="field field-wide">المبلغ المدفوع<input aria-label="المبلغ المدفوع" autoFocus required type="number" min="0.01" max={paymentLimit} step="0.01" value={paymentDraft.amount} onChange={event => setPaymentDraft({ ...paymentDraft, amount: Number(event.target.value) })}/></label><label className="field">تاريخ دفع المورد<input type="date" required value={paymentDraft.date} onChange={event => setPaymentDraft({ ...paymentDraft, date: event.target.value })}/></label><label className="field">طريقة دفع المورد<select value={paymentDraft.method} onChange={event => setPaymentDraft({ ...paymentDraft, method: event.target.value as SupplierPayment['method'] })}>{Object.entries(methodNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="field field-wide">ملاحظات الدفعة<textarea maxLength={2000} rows={2} value={paymentDraft.notes} onChange={event => setPaymentDraft({ ...paymentDraft, notes: event.target.value })}/></label></div><p className="form-hint">تُخصم هذه الدفعة من رصيد الفاتورة، وتظهر في التقرير كتدفق نقدي خارج.</p>{error && <div className="form-error" role="alert">{error}</div>}</div><div className="modal-footer"><button className="primary-button" disabled={busy || paymentLimit <= 0}><CheckCircle2 size={17}/>{busy ? 'جارٍ الحفظ…' : 'حفظ دفعة المورد'}</button><button type="button" className="secondary-button" disabled={busy} onClick={() => setPaymentPurchaseId(null)}>إلغاء</button></div></form></section></div>}

    {deleting && <div className="modal-backdrop"><section className="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="purchase-delete-title"><div className="modal-header"><h2 id="purchase-delete-title">{deleting.kind === 'purchase' ? 'حذف فاتورة الشراء' : 'حذف دفعة المورد'}</h2><button className="icon-button" aria-label="إغلاق" disabled={busy} onClick={() => setDeleting(null)}><X size={20}/></button></div><div className="modal-body">{deleting.kind === 'purchase' ? <p>سيُحذف المستند <strong dir="ltr">{deletingPurchase?.number}</strong> وتُعاد حسابات المشتريات. لا يمكن التراجع دون نسخة احتياطية.</p> : <p>ستُحذف دفعة بقيمة <strong>{money(deletingPayment?.amount ?? 0)}</strong>، ويُعاد هذا المبلغ إلى المستحق للمورد. استخدم ذلك لتصحيح دفعة مسجلة بالخطأ.</p>}{hasDeletingPayments && <p className="form-error" role="alert">لا يمكن حذف فاتورة لها مدفوعات. راجع سجل الدفعات وألغِ المدفوعات المسجلة بالخطأ أولًا.</p>}{error && <div className="form-error" role="alert">{error}</div>}</div><div className="modal-footer"><button className="danger-button" disabled={busy || hasDeletingPayments} onClick={() => void remove()}>{busy ? 'جارٍ الحذف…' : 'تأكيد الحذف'}</button><button className="secondary-button" disabled={busy} onClick={() => setDeleting(null)}>إلغاء</button></div></section></div>}
  </>;
}
