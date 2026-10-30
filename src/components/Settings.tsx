import { useEffect, useRef, useState } from 'react';
import { Building2, Database, Puzzle, Save, Download, Upload, Plus, Trash2, X, ShieldCheck, FileJson, CheckCircle2, FlaskConical } from 'lucide-react';
import type { AppData, ModuleProps } from '../types';
import { createDemoData, createEmptyData, downloadBackup, id, parseBackup, MAX_BACKUP_BYTES } from '../lib/data';

type Confirmation = { kind: 'restore'; data: AppData } | { kind: 'reset' } | { kind: 'demo' } | { kind: 'delete-module'; moduleId: string; name: string };

export default function Settings({ data, onUpdate, notify }: ModuleProps) {
  const [tab, setTab] = useState<'company' | 'data' | 'extensions'>('company');
  const [form, setForm] = useState(data.settings);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [newModule, setNewModule] = useState(false);
  const [moduleName, setModuleName] = useState('');
  const [fields, setFields] = useState(['اسم السجل', 'ملاحظات']);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { setForm(data.settings); }, [data.settings]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) { setNewModule(false); setConfirmation(null); setError(''); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [busy]);
  const update = async (next: AppData, success: string) => {
    setBusy(true); setError('');
    try { await onUpdate(next); notify(success); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذّر حفظ البيانات. حاول مرة أخرى.'); return false; }
    finally { setBusy(false); }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    setError('');
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('حجم الملف أكبر من 30 ميجابايت. اختر نسخة احتياطية أصغر.');
      const restored = parseBackup(await file.text());
      setConfirmation({ kind: 'restore', data: restored });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'ملف النسخة الاحتياطية غير صالح.'); }
    if (fileInput.current) fileInput.current.value = '';
  };
  const confirm = async () => {
    if (!confirmation) return;
    let next: AppData;
    let success: string;
    if (confirmation.kind === 'restore') { next = confirmation.data; success = 'تم استرجاع النسخة الاحتياطية بنجاح'; }
    else if (confirmation.kind === 'reset') { next = createEmptyData(data.settings); success = 'مساحتك جاهزة لإضافة بيانات شركتك'; }
    else if (confirmation.kind === 'demo') { next = createDemoData(); success = 'تم تحميل البيانات التجريبية'; }
    else { next = { ...data, modules: data.modules.filter(module => module.id !== confirmation.moduleId) }; success = 'تم حذف القسم وسجلاته'; }
    if (await update(next, success)) setConfirmation(null);
  };
  const addModule = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    const name = moduleName.trim();
    const cleaned = fields.map(field => field.trim());
    if (!name || cleaned.some(field => !field)) { setError('أدخل اسم القسم وأسماء جميع الحقول.'); return; }
    if (new Set(cleaned).size !== cleaned.length) { setError('أسماء الحقول يجب أن تكون مختلفة.'); return; }
    if (data.modules.some(module => module.name === name)) { setError('يوجد قسم بهذا الاسم بالفعل.'); return; }
    const next = { ...data, modules: [...data.modules, { id: id(), name, fields: cleaned, records: [] }] };
    if (await update(next, 'تمت إضافة القسم؛ ستجده في القائمة الجانبية')) { setNewModule(false); setModuleName(''); setFields(['اسم السجل', 'ملاحظات']); }
  };
  return <>
    <div className="page-heading"><div><span className="eyebrow">مساحتك، بطريقتك</span><h1>إعدادات الشركة</h1><p>خصص بيانات شركتك، واحمِ سجلاتك، وأضف أقسامًا جديدة.</p></div></div>
    <div className="settings-tabs" role="tablist" aria-label="أقسام الإعدادات">
      {([{ key: 'company', label: 'بيانات الشركة', icon: Building2 }, { key: 'data', label: 'البيانات والنسخ الاحتياطي', icon: Database }, { key: 'extensions', label: 'الأقسام والإضافات', icon: Puzzle }] as const).map(item => <button key={item.key} role="tab" aria-selected={tab === item.key} className={tab === item.key ? 'active' : ''} onClick={() => { setTab(item.key); setError(''); }}><item.icon size={18}/>{item.label}</button>)}
    </div>
    {error && !confirmation && !newModule && <div className="form-error" role="alert">{error}</div>}
    {tab === 'company' && <form className="settings-card" onSubmit={async event => { event.preventDefault(); if (!form.companyName.trim()) { setError('اسم الشركة مطلوب.'); return; } await update({ ...data, settings: { ...form, companyName: form.companyName.trim() } }, 'تم حفظ إعدادات الشركة'); }}>
      <div className="settings-section-heading"><div className="settings-icon"><Building2 size={23}/></div><div><h2>هوية شركتك</h2><p>تظهر هذه البيانات تلقائيًا في الفواتير المطبوعة.</p></div></div>
      <div className="form-grid">
        <label className="field">اسم الشركة<input required maxLength={120} value={form.companyName} onChange={event => setForm({ ...form, companyName: event.target.value })}/></label>
        <label className="field">وصف النشاط<input maxLength={160} placeholder="مثل: للتجارة والتوريدات" value={form.companySubtitle} onChange={event => setForm({ ...form, companySubtitle: event.target.value })}/></label>
        <label className="field">رقم الهاتف<input dir="ltr" type="tel" maxLength={40} value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })}/></label>
        <label className="field">البريد الإلكتروني<input dir="ltr" type="email" maxLength={160} value={form.email} onChange={event => setForm({ ...form, email: event.target.value })}/></label>
        <label className="field">عنوان الشركة<input maxLength={240} value={form.address} onChange={event => setForm({ ...form, address: event.target.value })}/></label>
        <label className="field">الرقم الضريبي<input maxLength={60} value={form.taxNumber} onChange={event => setForm({ ...form, taxNumber: event.target.value })}/></label>
        <label className="field">عملة العرض<select value={form.currency} onChange={event => setForm({ ...form, currency: event.target.value })}><option value="EGP">الجنيه المصري — EGP</option><option value="SAR">الريال السعودي — SAR</option><option value="AED">الدرهم الإماراتي — AED</option><option value="USD">الدولار الأمريكي — USD</option><option value="EUR">اليورو — EUR</option>{!['EGP', 'SAR', 'AED', 'USD', 'EUR'].includes(form.currency) && <option value={form.currency}>{form.currency}</option>}</select><small>تغيير العملة يغيّر التسمية فقط، ولا يحوّل قيم المبالغ.</small></label>
        <label className="field">نسبة الضريبة الافتراضية %<input type="number" min="0" max="100" step="0.01" required value={form.defaultTax} onChange={event => setForm({ ...form, defaultTax: Number(event.target.value) })}/><small>تطبّق على الفواتير الجديدة ويمكن تعديلها لكل فاتورة.</small></label>
      </div><div className="settings-actions"><button className="primary-button" disabled={busy}><Save size={17}/>{busy ? 'جارٍ الحفظ…' : 'حفظ التغييرات'}</button></div>
    </form>}
    {tab === 'data' && <div className="settings-grid">
      <section className="settings-card"><div className="settings-section-heading"><div className="settings-icon"><ShieldCheck size={23}/></div><div><h2>بياناتك تحت سيطرتك</h2><p>حفظ محلي في المتصفح، دون إرسال بيانات الشركة لخادم.</p></div></div><p className="settings-description">تُحفظ السجلات في قاعدة بيانات هذا المتصفح على الجهاز الذي تستخدمه، وتبقى بعد إغلاق الصفحة. البيانات في المعاينة السحابية لا تنتقل تلقائيًا إلى جهاز آخر.</p><p className="settings-description">قد يؤدي مسح بيانات المتصفح أو تغيير عنوان التطبيق إلى فقد الوصول للسجلات. احتفظ بنسخة احتياطية خارج المتصفح بشكل دوري. هذه النسخة مخصصة لمستخدم محلي واحد.</p><div className="local-storage-note"><CheckCircle2 size={18}/>الحفظ المحلي التلقائي مفعّل</div></section>
      <section className="settings-card"><div className="settings-section-heading"><div className="settings-icon"><FileJson size={23}/></div><div><h2>النسخ الاحتياطي والاسترجاع</h2><p>نسخة كاملة تشمل بيانات الشركة وكل الأقسام.</p></div></div><div className="backup-summary"><span><strong>{data.invoices.length}</strong> فاتورة</span><span><strong>{data.customers.length}</strong> عميل</span><span><strong>{data.modules.length}</strong> قسم مخصص</span></div><div className="settings-actions"><button className="primary-button" onClick={() => { try { downloadBackup(data); notify('تم تجهيز ملف النسخة الاحتياطية للتنزيل'); } catch { setError('تعذّر إنشاء النسخة الاحتياطية.'); } }}><Download size={17}/>تنزيل نسخة احتياطية</button><button className="secondary-button" onClick={() => fileInput.current?.click()}><Upload size={17}/>استرجاع من ملف</button><input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="ملف النسخة الاحتياطية" onChange={event => void importFile(event.target.files?.[0])}/></div></section>
      <section className="settings-card danger-zone"><h2>إدارة مساحة العمل</h2><p>ابدأ ببياناتك الحقيقية أو جرّب المزايا باستخدام سجلات نموذجية. أي من الخيارين يستبدل السجلات الحالية؛ نزّل نسخة احتياطية أولًا.</p><div className="settings-actions"><button className="secondary-button" onClick={() => { setError(''); setConfirmation({ kind: 'reset' }); }}><Database size={17}/>البدء بمساحة فارغة</button><button className="secondary-button" onClick={() => { setError(''); setConfirmation({ kind: 'demo' }); }}><FlaskConical size={17}/>تحميل بيانات تجريبية</button></div></section>
    </div>}
    {tab === 'extensions' && <><div className="settings-card extension-intro"><div><div className="settings-icon"><Puzzle size={24}/></div><h2>البرنامج يكبر مع شغلك</h2><p>أضف قسمًا مثل الموردين أو المعدات أو متابعة الطلبات، وحدد حقوله بنفسك. ستظهر سجلاته في القائمة الجانبية دون الحاجة إلى تعديل البرنامج.</p><small>الأقسام المخصصة سجلات نصية مرنة. ربطها بالحسابات أو إضافة منطق آلي يحتاج تطويرًا إضافيًا.</small></div><button className="primary-button" onClick={() => { setError(''); setNewModule(true); }}><Plus size={18}/>إضافة قسم جديد</button></div>
      <div className="settings-grid extension-grid">{data.modules.map(module => <article className="settings-card extension-card" key={module.id}><div className="settings-section-heading"><div className="settings-icon"><Puzzle size={22}/></div><div><h3>{module.name}</h3><span className="muted">{module.records.length} سجل · {module.fields.length} حقول</span></div><button className="icon-button danger-text" aria-label={`حذف قسم ${module.name}`} onClick={() => { setError(''); setConfirmation({ kind: 'delete-module', moduleId: module.id, name: module.name }); }}><Trash2 size={17}/></button></div><div className="extension-field-tags">{module.fields.map(field => <span className="badge badge-neutral" key={field}>{field}</span>)}</div></article>)}</div>
      {!data.modules.length && <div className="empty-state"><Puzzle size={36}/><h3>مساحة لكل فكرة جديدة</h3><p>أضف أول قسم مخصص لتنظيم تفاصيل نشاطك.</p></div>}</>}
    {newModule && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="module-title"><form onSubmit={addModule}><div className="modal-header"><div><h2 id="module-title">إضافة قسم مخصص</h2><p>اختر اسمًا واضحًا والحقول التي تحتاج تسجيلها.</p></div><button type="button" className="icon-button" aria-label="إغلاق" disabled={busy} onClick={() => { setNewModule(false); setError(''); }}><X size={20}/></button></div><div className="modal-body"><label className="field">اسم القسم<input autoFocus required maxLength={60} placeholder="مثل: الموردون" value={moduleName} onChange={event => setModuleName(event.target.value)}/></label><div className="custom-fields-list">{fields.map((field, index) => <label className="field" key={index}>الحقل {index + 1}<div className="input-action"><input required maxLength={60} value={field} onChange={event => setFields(fields.map((value, i) => i === index ? event.target.value : value))}/><button type="button" className="icon-button" disabled={fields.length <= 1} aria-label={`حذف الحقل ${index + 1}`} onClick={() => setFields(fields.filter((_, i) => i !== index))}><Trash2 size={17}/></button></div></label>)}</div><button className="secondary-button" type="button" disabled={fields.length >= 12} onClick={() => setFields([...fields, ''])}><Plus size={16}/>إضافة حقل</button>{error && <div className="form-error" role="alert">{error}</div>}</div><div className="modal-footer"><button className="primary-button" disabled={busy}><Plus size={17}/>{busy ? 'جارٍ الحفظ…' : 'إنشاء القسم'}</button><button type="button" className="secondary-button" disabled={busy} onClick={() => { setNewModule(false); setError(''); }}>إلغاء</button></div></form></section></div>}
    {confirmation && <div className="modal-backdrop"><section className="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="confirmation-title"><div className="modal-header"><h2 id="confirmation-title">{confirmation.kind === 'restore' ? 'استرجاع النسخة الاحتياطية' : confirmation.kind === 'delete-module' ? 'حذف القسم' : 'استبدال بيانات مساحة العمل'}</h2><button className="icon-button" aria-label="إغلاق" disabled={busy} onClick={() => { setConfirmation(null); setError(''); }}><X size={20}/></button></div><div className="modal-body"><p>{confirmation.kind === 'restore' ? `النسخة تخص «${confirmation.data.settings.companyName}» وتحتوي على ${confirmation.data.customers.length} عميل و${confirmation.data.invoices.length} فاتورة و${confirmation.data.modules.length} قسم مخصص.` : confirmation.kind === 'delete-module' ? `سيُحذف قسم «${confirmation.name}» وجميع سجلاته.` : confirmation.kind === 'reset' ? 'سيتم حذف جميع السجلات الحالية والبدء بمساحة فارغة، مع الاحتفاظ ببيانات الشركة.' : 'ستستبدل جميع البيانات الحالية ببيانات نموذجية للتجربة، بما فيها بيانات الشركة.'}</p><p className="danger-text">هذه العملية تستبدل البيانات الحالية ولا يمكن التراجع عنها دون نسخة احتياطية. احفظ نسخة من بياناتك أولًا.</p>{error && <div className="form-error" role="alert">{error}</div>}</div><div className="modal-footer"><button className="primary-button" disabled={busy} onClick={() => void confirm()}>{busy ? 'جارٍ التنفيذ…' : confirmation.kind === 'delete-module' ? 'تأكيد الحذف' : 'تأكيد الاستبدال'}</button><button className="secondary-button" disabled={busy} onClick={() => { setConfirmation(null); setError(''); }}>إلغاء</button></div></section></div>}
  </>;
}
