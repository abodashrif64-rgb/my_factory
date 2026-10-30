import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Check, ClipboardList, Cog, Factory, Pencil, Plus, Settings2, Trash2, X } from 'lucide-react';
import type { Machine, ModuleProps, Page, ProductionOrder } from '../types';
import { formatMoney, id, today } from '../lib/data';

const machineStatus = { active: 'جاهزة للعمل', maintenance: 'تحت الصيانة', inactive: 'متوقفة' };
const orderStatus = { queued: 'في الانتظار', running: 'قيد التشغيل', done: 'مكتمل' };
const machineBadge = { active: 'badge-success', maintenance: 'badge-warning', inactive: 'badge-neutral' };
const orderBadge = { queued: 'badge-neutral', running: 'badge-warning', done: 'badge-success' };
const units: ProductionOrder['unit'][] = ['ورقة', 'كرتونة', 'قطعة', 'كيلوجرام'];
type Props = ModuleProps & { page: Page; query: string };

function newOrderNumber(orders: ProductionOrder[]) {
  const year = today().slice(0, 4);
  const prefix = `PO-${year}-`;
  const last = orders.reduce((max, order) => order.number.startsWith(prefix) ? Math.max(max, Number(order.number.slice(prefix.length)) || 0) : max, 0);
  return `${prefix}${String(last + 1).padStart(4, '0')}`;
}

export default function Production({ data, onUpdate, notify, page, query }: Props) {
  const machinesPage = page === 'machines';
  const [machine, setMachine] = useState<Machine | null>(null);
  const [order, setOrder] = useState<ProductionOrder | null>(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [remove, setRemove] = useState<{ kind: 'machine' | 'order'; itemId: string; name: string } | null>(null);
  useEffect(() => { setFilter('all'); }, [page]);
  const normalized = query.trim().toLocaleLowerCase('ar');
  const filteredMachines = useMemo(() => data.machines.filter(item =>
    (!normalized || [item.name, item.code, item.type].join(' ').toLocaleLowerCase('ar').includes(normalized)) &&
    (filter === 'all' || item.status === filter)
  ), [data.machines, normalized, filter]);
  const filteredOrders = useMemo(() => data.productionOrders.filter(item => {
    const customer = data.customers.find(c => c.id === item.customerId)?.name || '';
    const machineName = data.machines.find(m => m.id === item.machineId)?.name || '';
    return (!normalized || [item.title, item.number, customer, machineName].join(' ').toLocaleLowerCase('ar').includes(normalized)) &&
      (filter === 'all' || item.status === filter);
  }), [data.productionOrders, data.customers, data.machines, normalized, filter]);

  function openMachine(item?: Machine) {
    setError('');
    setMachine(item ? { ...item } : { id: id(), name: '', type: 'تكسير ورق', code: '', status: 'active', hourlyRate: 0, notes: '' });
  }
  function openOrder(item?: ProductionOrder) {
    setError('');
    setOrder(item ? { ...item } : { id: id(), number: newOrderNumber(data.productionOrders), customerId: data.customers[0]?.id || '', machineId: data.machines.find(m => m.status === 'active')?.id || '', title: '', quantity: 1000, completedQuantity: 0, wasteQuantity: 0, unit: 'ورقة', status: 'queued', date: today(), dueDate: today(), notes: '' });
  }
  async function saveMachine(event: FormEvent) {
    event.preventDefault();
    if (!machine || saving) return;
    const next = { ...machine, name: machine.name.trim(), type: machine.type.trim(), code: machine.code.trim() };
    if (!next.name || !next.type || !next.code) return setError('اكتب اسم الماكينة ونوعها وكودها.');
    if (!Number.isFinite(next.hourlyRate) || next.hourlyRate < 0) return setError('تكلفة الساعة يجب أن تكون صفرًا أو أكبر.');
    if (data.machines.some(m => m.id !== next.id && m.code.toLocaleLowerCase() === next.code.toLocaleLowerCase())) return setError('كود الماكينة مستخدم بالفعل. اختر كودًا آخر.');
    setSaving(true); setError('');
    try {
      await onUpdate({ ...data, machines: data.machines.some(m => m.id === next.id) ? data.machines.map(m => m.id === next.id ? next : m) : [...data.machines, next] });
      setMachine(null); notify('تم حفظ الماكينة بنجاح');
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر حفظ الماكينة. حاول مرة أخرى.'); }
    finally { setSaving(false); }
  }
  async function saveOrder(event: FormEvent) {
    event.preventDefault();
    if (!order || saving) return;
    const next = { ...order, title: order.title.trim() };
    if (!next.title || !data.customers.some(c => c.id === next.customerId) || !data.machines.some(m => m.id === next.machineId)) return setError('أكمل وصف أمر التشغيل والعميل والماكينة.');
    const quantities = [next.quantity, next.completedQuantity, next.wasteQuantity];
    if (!quantities.every(Number.isFinite) || next.quantity <= 0 || next.completedQuantity < 0 || next.wasteQuantity < 0) return setError('أدخل كميات صحيحة؛ الكمية المطلوبة أكبر من صفر.');
    if (quantities.some(value => value > 1_000_000_000 || Math.abs(value - Math.round(value * 1000) / 1000) > Number.EPSILON * Math.max(1, Math.abs(value)) * 4)) return setError('أدخل الكميات بثلاث منازل عشرية كحد أقصى، وبقيمة لا تتجاوز مليار وحدة.');
    // Compare fixed thousandths so normal decimal input, such as 0.1 + 0.2,
    // never causes an overproduction or incomplete-order error through float noise.
    const [requestedUnits, completedUnits, wasteUnits] = quantities.map(value => Math.round(value * 1000));
    if (completedUnits + wasteUnits > requestedUnits) return setError('مجموع المنفذ والهالك لا يمكن أن يتجاوز الكمية المطلوبة.');
    if (next.status === 'done' && completedUnits + wasteUnits !== requestedUnits) return setError('لإكمال أمر التشغيل، يجب تسجيل الكمية المطلوبة بالكامل بين المنفذ والهالك.');
    if (next.dueDate < next.date) return setError('تاريخ التسليم لا يمكن أن يسبق تاريخ الأمر.');
    const selectedMachine = data.machines.find(m => m.id === next.machineId);
    const existingOrder = data.productionOrders.find(item => item.id === next.id);
    const startsNewRun = next.status === 'running' && (existingOrder?.status !== 'running' || existingOrder.machineId !== next.machineId);
    if (startsNewRun && selectedMachine?.status !== 'active') return setError('لتشغيل هذا الأمر، اختر ماكينة جاهزة للعمل أو غيّر حالة الماكينة أولًا.');
    setSaving(true); setError('');
    try {
      await onUpdate({ ...data, productionOrders: data.productionOrders.some(o => o.id === next.id) ? data.productionOrders.map(o => o.id === next.id ? next : o) : [next, ...data.productionOrders] });
      setOrder(null); notify('تم حفظ أمر التشغيل بنجاح');
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر حفظ أمر التشغيل. حاول مرة أخرى.'); }
    finally { setSaving(false); }
  }
  async function removeItem() {
    if (!remove || saving) return;
    if (remove.kind === 'machine' && data.productionOrders.some(o => o.machineId === remove.itemId)) return setError('هذه الماكينة مرتبطة بأوامر تشغيل. يمكنك إيقافها من تعديل الماكينة للحفاظ على السجل.');
    setSaving(true); setError('');
    try {
      await onUpdate(remove.kind === 'machine' ? { ...data, machines: data.machines.filter(m => m.id !== remove.itemId) } : { ...data, productionOrders: data.productionOrders.filter(o => o.id !== remove.itemId) });
      setRemove(null); notify(remove.kind === 'machine' ? 'تم حذف الماكينة' : 'تم حذف أمر التشغيل');
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر الحذف. حاول مرة أخرى.'); }
    finally { setSaving(false); }
  }
  const closeModal = () => { if (!saving) { setMachine(null); setOrder(null); setRemove(null); setError(''); } };

  return <>
    <div className="page-heading"><div><div className="eyebrow">{machinesPage ? 'أصول المصنع' : 'إدارة الإنتاج'}</div><h1>{machinesPage ? 'الماكينات والمعدات' : 'أوامر التشغيل'}</h1><p>{machinesPage ? 'كل ماكينة في مكانها. أضف معدات جديدة وتابع جاهزيتها للعمل.' : 'من طلب العميل إلى آخر ورقة. تابع التشغيل والكميات والهالك بوضوح.'}</p></div><button className="primary-button" onClick={() => machinesPage ? openMachine() : openOrder()}><Plus size={18}/>{machinesPage ? 'إضافة ماكينة' : 'أمر تشغيل جديد'}</button></div>

    <div className="production-summary settings-grid" style={{ marginBottom: 24 }}>
      {(machinesPage ? [
        { icon: Factory, label: 'إجمالي الماكينات', value: data.machines.length, text: 'ماكينة مسجلة' },
        { icon: Check, label: 'جاهزة للعمل', value: data.machines.filter(m => m.status === 'active').length, text: 'متاحة للتشغيل' },
        { icon: Settings2, label: 'تحت الصيانة', value: data.machines.filter(m => m.status === 'maintenance').length, text: 'تحتاج إلى متابعة' },
      ] : [
        { icon: ClipboardList, label: 'كل أوامر التشغيل', value: data.productionOrders.length, text: 'أمر تشغيل مسجل' },
        { icon: Cog, label: 'قيد التشغيل', value: data.productionOrders.filter(o => o.status === 'running').length, text: 'يجري تنفيذها الآن' },
        { icon: Check, label: 'أوامر مكتملة', value: data.productionOrders.filter(o => o.status === 'done').length, text: 'تم تسجيل إنتاجها' },
      ]).map(stat => <div key={stat.label} className="settings-card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 22 }}><div className="avatar"><stat.icon size={22}/></div><div><span style={{ color: 'var(--text-muted, #8b91a2)', fontSize: 12 }}>{stat.label}</span><div style={{ fontSize: 27, fontWeight: 800, lineHeight: 1.6 }}>{stat.value.toLocaleString('ar-EG')}</div><small style={{ color: 'var(--text-muted, #8b91a2)' }}>{stat.text}</small></div></div>)}
    </div>

    <div className="table-card">
      <div className="table-toolbar"><div><h3>{machinesPage ? 'سجل الماكينات' : 'سجل أوامر التشغيل'}</h3><span className="muted">{machinesPage ? filteredMachines.length : filteredOrders.length} {machinesPage ? 'ماكينة' : 'أمر تشغيل'}</span></div><label className="field" style={{ minWidth: 160 }}><span className="sr-only">تصفية حسب الحالة</span><select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">كل الحالات</option>{Object.entries(machinesPage ? machineStatus : orderStatus).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      {machinesPage ? filteredMachines.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>الماكينة</th><th>الكود</th><th>نوع النشاط</th><th>تكلفة الساعة</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{filteredMachines.map(m => <tr key={m.id}><td><div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><span className="avatar"><Factory size={19}/></span><div><strong>{m.name}</strong><small className="muted" style={{ display: 'block' }}>{data.productionOrders.filter(o => o.machineId === m.id).length} أمر تشغيل</small></div></div></td><td><span dir="ltr">{m.code}</span></td><td>{m.type}</td><td>{formatMoney(m.hourlyRate, data.settings.currency)}</td><td><span className={`badge ${machineBadge[m.status]}`}>{machineStatus[m.status]}</span></td><td><div style={{ display: 'flex', gap: 5 }}><button className="icon-button" title="تعديل الماكينة" aria-label={`تعديل ${m.name}`} onClick={() => openMachine(m)}><Pencil size={16}/></button><button className="icon-button" title="حذف الماكينة" aria-label={`حذف ${m.name}`} onClick={() => { setError(''); setRemove({ kind: 'machine', itemId: m.id, name: m.name }); }}><Trash2 size={16}/></button></div></td></tr>)}</tbody></table></div> : <div className="empty-state"><Factory size={38}/><h3>{normalized || filter !== 'all' ? 'لا توجد ماكينات مطابقة' : 'أول ماكينة، بداية الإنتاج'}</h3><p>{normalized || filter !== 'all' ? 'جرّب تغيير البحث أو تصفية الحالة.' : 'أضف ماكينات التكسير أو القص أو أي نشاط جديد في مصنعك.'}</p>{!normalized && filter === 'all' && <button className="secondary-button" onClick={() => openMachine()}><Plus size={16}/>إضافة ماكينة</button>}</div> : filteredOrders.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>أمر التشغيل</th><th>العميل</th><th>الماكينة</th><th>الإنتاج</th><th>موعد التسليم</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{filteredOrders.map(o => <tr key={o.id}><td><strong>{o.title}</strong><small className="muted" style={{ display: 'block' }} dir="ltr">{o.number}</small></td><td>{data.customers.find(c => c.id === o.customerId)?.name || '—'}</td><td>{data.machines.find(m => m.id === o.machineId)?.name || '—'}</td><td><div style={{ minWidth: 140 }}><strong>{o.completedQuantity.toLocaleString('ar-EG')}</strong><span className="muted"> / {o.quantity.toLocaleString('ar-EG')} {o.unit}</span><div style={{ height: 5, marginTop: 8, background: '#eceaf6', borderRadius: 9, overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.min(100, o.completedQuantity / o.quantity * 100)}%`, background: '#7963ed', borderRadius: 9 }}/></div>{o.wasteQuantity > 0 && <small className="muted">الهالك: {o.wasteQuantity.toLocaleString('ar-EG')} {o.unit}</small>}</div></td><td>{new Date(o.dueDate + 'T12:00:00').toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })}</td><td><span className={`badge ${orderBadge[o.status]}`}>{orderStatus[o.status]}</span></td><td><div style={{ display: 'flex', gap: 5 }}><button className="icon-button" title="تحديث أمر التشغيل" aria-label={`تعديل ${o.number}`} onClick={() => openOrder(o)}><Pencil size={16}/></button><button className="icon-button" title="حذف أمر التشغيل" aria-label={`حذف ${o.number}`} onClick={() => { setError(''); setRemove({ kind: 'order', itemId: o.id, name: o.number }); }}><Trash2 size={16}/></button></div></td></tr>)}</tbody></table></div> : <div className="empty-state"><ClipboardList size={38}/><h3>{normalized || filter !== 'all' ? 'لا توجد أوامر مطابقة' : 'حوّل طلبات العملاء إلى إنتاج'}</h3><p>{normalized || filter !== 'all' ? 'جرّب تغيير البحث أو تصفية الحالة.' : 'أضف العميل والماكينة، ثم أنشئ أول أمر تشغيل لمتابعة الكميات.'}</p>{!normalized && filter === 'all' && <button className="secondary-button" onClick={() => openOrder()}><Plus size={16}/>إنشاء أمر تشغيل</button>}</div>}
    </div>

    {(machine || order || remove) && <div className="modal-backdrop"><section className={`modal ${order ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="production-modal-title"><div className="modal-header"><div><h2 id="production-modal-title">{remove ? 'تأكيد الحذف' : machine ? data.machines.some(m => m.id === machine.id) ? 'تعديل الماكينة' : 'إضافة ماكينة جديدة' : data.productionOrders.some(o => o.id === order!.id) ? 'تحديث أمر التشغيل' : 'أمر تشغيل جديد'}</h2><p>{remove ? 'راجع العملية قبل المتابعة.' : machine ? 'يمكنك إضافة أي نوع ماكينة أو نشاط جديد.' : 'حدد تفاصيل العمل وتابع تقدم التنفيذ.'}</p></div><button className="icon-button" aria-label="إغلاق" onClick={closeModal} disabled={saving}><X size={20}/></button></div>
      {remove ? <><div className="modal-body"><p>هل تريد حذف <strong>{remove.name}</strong>؟ لا يمكن التراجع عن الحذف.</p>{remove.kind === 'machine' && data.productionOrders.some(o => o.machineId === remove.itemId) && <p className="form-error">هذه الماكينة مرتبطة بأوامر تشغيل. استخدم «تعديل الماكينة» لتغيير حالتها إلى «متوقفة» بدلًا من حذف سجلها.</p>}{error && <p role="alert" className="form-error">{error}</p>}</div><div className="modal-footer"><button className="secondary-button" onClick={closeModal} disabled={saving}>إلغاء</button><button className="primary-button" style={{ background: '#d94a5f' }} onClick={removeItem} disabled={saving || remove.kind === 'machine' && data.productionOrders.some(o => o.machineId === remove.itemId)}><Trash2 size={17}/>{saving ? 'جارٍ الحذف…' : 'حذف نهائي'}</button></div></> : machine ? <form onSubmit={saveMachine}><div className="modal-body"><div className="form-grid"><label className="field"><span>اسم الماكينة <b>*</b></span><input required maxLength={150} value={machine.name} onChange={e => setMachine({ ...machine, name: e.target.value })} placeholder="مثال: ماكينة التكسير الرئيسية" autoFocus/></label><label className="field"><span>كود الماكينة <b>*</b></span><input required maxLength={40} value={machine.code} onChange={e => setMachine({ ...machine, code: e.target.value })} placeholder="MC-001" dir="ltr"/></label><label className="field"><span>نوع الماكينة / النشاط <b>*</b></span><input required maxLength={100} value={machine.type} onChange={e => setMachine({ ...machine, type: e.target.value })} placeholder="تكسير ورق، قص، طباعة…"/></label><label className="field"><span>الحالة</span><select value={machine.status} onChange={e => setMachine({ ...machine, status: e.target.value as Machine['status'] })}>{Object.entries(machineStatus).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="field"><span>تكلفة ساعة التشغيل</span><input type="number" min="0" max="1000000000" step="0.01" required value={machine.hourlyRate} onChange={e => setMachine({ ...machine, hourlyRate: e.target.valueAsNumber })}/><small className="muted">قيمة مرجعية للتكلفة، ولا تُسجل كمصروف تلقائيًا.</small></label><label className="field"><span>ملاحظات</span><textarea maxLength={2000} rows={3} value={machine.notes} onChange={e => setMachine({ ...machine, notes: e.target.value })} placeholder="مواصفات الماكينة أو ملاحظات الصيانة"/></label></div>{error && <p role="alert" className="form-error">{error}</p>}</div><div className="modal-footer"><button type="button" className="secondary-button" onClick={closeModal} disabled={saving}>إلغاء</button><button type="submit" className="primary-button" disabled={saving}><Check size={17}/>{saving ? 'جارٍ الحفظ…' : 'حفظ الماكينة'}</button></div></form> : order && <form onSubmit={saveOrder}><div className="modal-body">{(!data.customers.length || !data.machines.length) && <p className="form-error">أضف عميلًا من قسم العملاء وماكينة من قسم الماكينات أولًا، ثم أنشئ أمر التشغيل.</p>}<div className="form-grid"><label className="field"><span>رقم أمر التشغيل</span><input value={order.number} readOnly dir="ltr"/></label><label className="field"><span>اسم العمل / المنتج <b>*</b></span><input required autoFocus maxLength={180} value={order.title} onChange={e => setOrder({ ...order, title: e.target.value })} placeholder="مثال: تكسير علب تغليف مقاس ٢٠ × ٣٠"/></label><label className="field"><span>العميل <b>*</b></span><select required value={order.customerId} onChange={e => setOrder({ ...order, customerId: e.target.value })}><option value="">اختر العميل</option>{data.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="field"><span>الماكينة <b>*</b></span><select required value={order.machineId} onChange={e => setOrder({ ...order, machineId: e.target.value })}><option value="">اختر الماكينة</option>{data.machines.map(m => <option key={m.id} value={m.id}>{m.name} — {machineStatus[m.status]}</option>)}</select></label><label className="field"><span>تاريخ الأمر <b>*</b></span><input type="date" required value={order.date} onChange={e => setOrder({ ...order, date: e.target.value })}/></label><label className="field"><span>موعد التسليم <b>*</b></span><input type="date" required min={order.date} value={order.dueDate} onChange={e => setOrder({ ...order, dueDate: e.target.value })}/></label><label className="field"><span>الكمية المطلوبة <b>*</b></span><input type="number" required min="0.001" max="1000000000" step="0.001" value={order.quantity} onChange={e => setOrder({ ...order, quantity: e.target.valueAsNumber })}/></label><label className="field"><span>وحدة القياس</span><select value={order.unit} onChange={e => setOrder({ ...order, unit: e.target.value as ProductionOrder['unit'] })}>{units.map(unit => <option key={unit}>{unit}</option>)}</select></label><label className="field"><span>الكمية المنفذة</span><input type="number" required min="0" max={order.quantity} step="0.001" value={order.completedQuantity} onChange={e => setOrder({ ...order, completedQuantity: e.target.valueAsNumber })}/></label><label className="field"><span>كمية الهالك</span><input type="number" required min="0" max={order.quantity} step="0.001" value={order.wasteQuantity} onChange={e => setOrder({ ...order, wasteQuantity: e.target.valueAsNumber })}/></label><label className="field"><span>حالة التشغيل</span><select value={order.status} onChange={e => setOrder({ ...order, status: e.target.value as ProductionOrder['status'] })}>{Object.entries(orderStatus).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="field"><span>ملاحظات التشغيل</span><textarea maxLength={2000} rows={3} value={order.notes} onChange={e => setOrder({ ...order, notes: e.target.value })} placeholder="مقاس الورق، نوع الخامة، تعليمات التكسير…"/></label></div>{error && <p role="alert" className="form-error">{error}</p>}</div><div className="modal-footer"><button type="button" className="secondary-button" onClick={closeModal} disabled={saving}>إلغاء</button><button type="submit" className="primary-button" disabled={saving || !data.customers.length || !data.machines.length}><Check size={17}/>{saving ? 'جارٍ الحفظ…' : 'حفظ أمر التشغيل'}</button></div></form>}
    </section></div>}
  </>;
}
