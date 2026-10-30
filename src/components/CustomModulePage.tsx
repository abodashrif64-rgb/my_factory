import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, Puzzle, Search, Save, Hash, CalendarDays, Coins } from 'lucide-react';
import type { ModuleProps, CustomFieldType } from '../types';
import { id, formatMoney } from '../lib/data';

const fieldLabels: Record<CustomFieldType, string> = { text: 'نص', number: 'رقم / كمية', money: 'مبلغ / سعر', date: 'تاريخ' };
const numericLiteral = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
function valueError(value: string, type: CustomFieldType): string | null {
  if (!value) return null;
  if (type === 'money' || type === 'number') {
    const number = Number(value), scale = type === 'money' ? 100 : 1000;
    if (!numericLiteral.test(value) || !Number.isFinite(number) || Math.abs(number) > 1e9 || (type === 'money' && number < 0)) return type === 'money' ? 'أدخل مبلغًا من صفر إلى مليار.' : 'أدخل رقمًا بين سالب مليار ومليار.';
    if (Math.abs(number * scale - Math.round(number * scale)) > 0.0001) return type === 'money' ? 'المبلغ يقبل منزلتين عشريتين كحد أقصى.' : 'الرقم يقبل ثلاث منازل عشرية كحد أقصى.';
  } else if (type === 'date') {
    const date = new Date(`${value}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return 'أدخل تاريخًا صحيحًا.';
  }
  return null;
}
function formatQuantityTotal(values: string[]) {
  const scaled = values.reduce((total, value) => total + (value.trim() ? BigInt(Math.round(Number(value) * 1000)) : 0n), 0n);
  const absolute = scaled < 0n ? -scaled : scaled;
  const whole = new Intl.NumberFormat('en-US').format(absolute / 1000n);
  const fraction = (absolute % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return `${scaled < 0n ? '-' : ''}${whole}${fraction ? '.' + fraction : ''}`;
}

export default function CustomModulePage({ data, onUpdate, notify, moduleId, query, onNavigate }: ModuleProps & { moduleId: string; query: string; onNavigate?: (page: string) => void }) {
  const module = data.modules.find(item => item.id === moduleId);
  const [editing, setEditing] = useState<{ id: string; values: Record<string, string> } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setEditing(null); setDeleting(null); setSearch(''); setError(''); }, [moduleId]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) { setEditing(null); setDeleting(null); setError(''); } };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [busy]);
  if (!module) return <div className="empty-state"><Puzzle size={36}/><h2>القسم غير موجود</h2><p>يمكنك إنشاء قسم جديد من الإعدادات.</p></div>;
  const typeOf = (field: string): CustomFieldType => module.fieldTypes?.[field] ?? 'text';
  const numericFields = module.fields.filter(field => ['money', 'number'].includes(typeOf(field)));
  const filtered = module.records.filter(record => [query, search].every(term => !term.trim() || Object.values(record.values).some(value => value.toLocaleLowerCase('ar').includes(term.trim().toLocaleLowerCase('ar')))));
  const persist = async (records: typeof module.records, message: string) => {
    setBusy(true); setError('');
    try { await onUpdate({ ...data, modules: data.modules.map(item => item.id === moduleId ? { ...item, records } : item) }); notify(message); setEditing(null); setDeleting(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذّر حفظ التغييرات.'); }
    finally { setBusy(false); }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!editing) return;
    const record = { ...editing, values: Object.fromEntries(module.fields.map(field => [field, (editing.values[field] || '').trim()])) };
    if (!Object.values(record.values).some(Boolean)) { setError('أدخل قيمة واحدة على الأقل.'); return; }
    for (const field of module.fields) {
      const invalid = valueError(record.values[field], typeOf(field));
      if (invalid) { setError(`${field}: ${invalid}`); return; }
    }
    const exists = module.records.some(item => item.id === record.id);
    await persist(exists ? module.records.map(item => item.id === record.id ? record : item) : [record, ...module.records], exists ? 'تم تحديث السجل' : 'تمت إضافة السجل');
  };
  const display = (field: string, value: string) => {
    if (!value) return <span className="muted">—</span>;
    const type = typeOf(field);
    if (type === 'money') return formatMoney(Number(value), data.settings.currency);
    if (type === 'number') return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(Number(value));
    if (type === 'date') return new Date(`${value}T12:00:00`).toLocaleDateString('ar-EG');
    return value;
  };
  return <>
    <div className="page-heading"><div><span className="eyebrow">قسم مخصص · {module.records.length} سجل</span><h1>{module.name}</h1><p>كل التفاصيل التي تهم شغلك، في مكان واحد.</p></div><button className="primary-button" onClick={() => { setError(''); setEditing({ id: id(), values: Object.fromEntries(module.fields.map(field => [field, ''])) }); }}><Plus size={19}/>إضافة سجل</button></div>
    {onNavigate && /مشتري|شراء/.test(module.name) && <div className="demo-banner"><div className="banner-icon"><Coins size={20}/></div><div><strong>فواتير المشتريات وحسابات الموردين لها قسم متكامل</strong><span>هذا القسم يحتفظ بسجلاتك المخصصة. افتح المشتريات لحساب الكمية × السعر، والضريبة، والمدفوع والمتبقي تلقائيًا.</span></div><button onClick={() => onNavigate('purchases')}>فتح المشتريات المتكاملة</button></div>}
    <section className="table-card"><div className="table-toolbar"><div><h2>سجلات {module.name}</h2><span className="muted">{filtered.length} من {module.records.length} سجل</span></div><label className="table-search"><Search size={17}/><input aria-label="البحث في السجلات" placeholder="ابحث في السجلات…" value={search} onChange={event => setSearch(event.target.value)}/></label></div>
      {filtered.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>#</th>{module.fields.map(field => <th key={field}><span className="custom-column-heading">{typeOf(field) === 'money' ? <Coins size={13}/> : typeOf(field) === 'number' ? <Hash size={13}/> : typeOf(field) === 'date' ? <CalendarDays size={13}/> : null}{field}</span></th>)}<th>إجراءات</th></tr></thead><tbody>{filtered.map((record, index) => <tr key={record.id}><td className="muted">{String(index + 1).padStart(2, '0')}</td>{module.fields.map(field => <td className={['number', 'money'].includes(typeOf(field)) ? 'amount-cell' : ''} key={field}>{display(field, record.values[field])}</td>)}<td><div className="row-actions"><button className="icon-button" aria-label={`تعديل السجل ${index + 1}`} onClick={() => { setError(''); setEditing({ ...record, values: { ...record.values } }); }}><Pencil size={16}/></button><button className="icon-button danger-text" aria-label={`حذف السجل ${index + 1}`} onClick={() => { setError(''); setDeleting(record.id); }}><Trash2 size={16}/></button></div></td></tr>)}</tbody>{numericFields.length > 0 && <tfoot className="custom-totals"><tr><th>الإجمالي</th>{module.fields.map(field => <td className="amount-cell" key={field}>{typeOf(field) === 'number' ? formatQuantityTotal(filtered.map(record => record.values[field])) : typeOf(field) === 'money' ? formatMoney(filtered.reduce((sum, record) => sum + Math.round(Number(record.values[field] || 0) * 100), 0) / 100, data.settings.currency) : '—'}</td>)}<td/></tr></tfoot>}</table>{numericFields.length > 0 && <p className="table-footer">الإجماليات تخص النتائج المعروضة فقط. كل حقل يُجمع منفصلًا؛ لا تُحسب علاقة تلقائية بين السعر والكمية.</p>}</div> : <div className="empty-state"><Puzzle size={36}/><h3>{query || search ? 'لا توجد نتائج مطابقة' : 'القسم جاهز لأول سجل'}</h3><p>{query || search ? 'جرّب كلمة بحث مختلفة.' : 'اضغط «إضافة سجل» وابدأ تنظيم بياناتك.'}</p></div>}
    </section>
    {editing && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="record-title"><form onSubmit={save}><div className="modal-header"><div><h2 id="record-title">{module.records.some(item => item.id === editing.id) ? 'تعديل السجل' : 'إضافة سجل جديد'}</h2><p>{module.name}</p></div><button type="button" className="icon-button" aria-label="إغلاق" disabled={busy} onClick={() => setEditing(null)}><X size={20}/></button></div><div className="modal-body"><div className="form-grid">{module.fields.map((field, index) => <label className="field" key={field}>{field}<input autoFocus={index === 0} aria-label={field} type={typeOf(field) === 'date' ? 'date' : ['number', 'money'].includes(typeOf(field)) ? 'number' : 'text'} step={typeOf(field) === 'money' ? '0.01' : typeOf(field) === 'number' ? '0.001' : undefined} min={typeOf(field) === 'money' ? '0' : typeOf(field) === 'number' ? '-1000000000' : undefined} max={['number', 'money'].includes(typeOf(field)) ? '1000000000' : undefined} maxLength={2000} value={editing.values[field] || ''} onChange={event => setEditing({ ...editing, values: { ...editing.values, [field]: event.target.value } })}/><small>{fieldLabels[typeOf(field)]}{typeOf(field) === 'money' ? ' · منزلتان عشريتان' : typeOf(field) === 'number' ? ' · ثلاث منازل عشرية' : ''}</small></label>)}</div>{error && <div className="form-error" role="alert">{error}</div>}</div><div className="modal-footer"><button className="primary-button" disabled={busy}><Save size={17}/>{busy ? 'جارٍ الحفظ…' : 'حفظ السجل'}</button><button type="button" className="secondary-button" disabled={busy} onClick={() => setEditing(null)}>إلغاء</button></div></form></section></div>}
    {deleting && <div className="modal-backdrop"><section className="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="delete-record-title"><div className="modal-header"><h2 id="delete-record-title">حذف السجل</h2><button className="icon-button" aria-label="إغلاق" disabled={busy} onClick={() => setDeleting(null)}><X size={20}/></button></div><div className="modal-body"><p>هل تريد حذف هذا السجل؟ لا يمكن التراجع عن الحذف دون نسخة احتياطية.</p>{error && <div className="form-error" role="alert">{error}</div>}</div><div className="modal-footer"><button className="primary-button" disabled={busy} onClick={() => void persist(module.records.filter(item => item.id !== deleting), 'تم حذف السجل')}>{busy ? 'جارٍ الحذف…' : 'تأكيد الحذف'}</button><button className="secondary-button" disabled={busy} onClick={() => setDeleting(null)}>إلغاء</button></div></section></div>}
  </>;
}
