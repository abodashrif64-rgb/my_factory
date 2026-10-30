export type Page = 'dashboard' | 'invoices' | 'customers' | 'employees' | 'projects' | 'receipts' | 'expenses' | 'reports' | 'settings' | 'machines' | 'production';
export interface Customer { id: string; name: string; phone: string; email: string; address: string; }
export interface Employee { id: string; name: string; role: string; phone: string; salary: number; }
export interface Project { id: string; name: string; customerId: string; value: number; status: 'planned' | 'active' | 'done'; dueDate: string; }
export interface InvoiceItem { description: string; quantity: number; price: number; }
export interface Invoice { id: string; number: string; customerId: string; date: string; dueDate: string; items: InvoiceItem[]; taxRate: number; discount: number; notes: string; }
export interface Receipt { id: string; invoiceId: string; customerId: string; amount: number; date: string; method: 'cash' | 'bank' | 'wallet'; notes: string; }
export interface Expense { id: string; title: string; category: string; amount: number; date: string; employeeId: string; notes: string; }
export interface CustomModule { id: string; name: string; fields: string[]; records: { id: string; values: Record<string, string> }[]; }
export interface Settings { companyName: string; companySubtitle: string; phone: string; address: string; email: string; taxNumber: string; currency: string; defaultTax: number; }
export interface Machine { id: string; name: string; type: string; code: string; status: 'active' | 'maintenance' | 'inactive'; hourlyRate: number; notes: string; }
export interface ProductionOrder { id: string; number: string; customerId: string; machineId: string; title: string; quantity: number; completedQuantity: number; wasteQuantity: number; unit: 'ورقة' | 'كرتونة' | 'قطعة' | 'كيلوجرام'; status: 'queued' | 'running' | 'done'; date: string; dueDate: string; notes: string; }
export interface AppData { version: 1; demo: boolean; settings: Settings; customers: Customer[]; employees: Employee[]; projects: Project[]; invoices: Invoice[]; receipts: Receipt[]; expenses: Expense[]; modules: CustomModule[]; machines: Machine[]; productionOrders: ProductionOrder[]; }
export type DataUpdater = (next: AppData) => Promise<void>;
export interface ModuleProps { data: AppData; onUpdate: DataUpdater; notify: (message: string) => void; }
