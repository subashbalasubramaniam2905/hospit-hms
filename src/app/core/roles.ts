import { Role, RoleId } from './models';

export const ROLES: Role[] = [
  { id: 'super-admin', name: 'Super administrator', description: 'All branches, settings and security', userName: 'Super Admin (demo)', initials: 'SA', dashboard: 'admin' },
  { id: 'admin', name: 'Hospital administrator', description: 'Operations, finance and reports for the branch', userName: 'Meera Rao', initials: 'MR', dashboard: 'admin' },
  { id: 'doctor', name: 'Doctor', description: 'My patients, consultations, orders and prescriptions', userName: 'Dr. Sana Iqbal', initials: 'SI', dashboard: 'doctor' },
  { id: 'nurse', name: 'Nurse', description: 'Triage, ward patients, medication and handover', userName: 'Rekha Pillai', initials: 'RP', dashboard: 'nurse' },
  { id: 'receptionist', name: 'Receptionist', description: 'Registration, appointments, queue and billing desk', userName: 'Arun Prakash', initials: 'AP', dashboard: 'reception' },
  { id: 'pharmacist', name: 'Pharmacist', description: 'Dispensing, stock, expiry and purchases', userName: 'Farzana Ali', initials: 'FA', dashboard: 'pharmacy' },
  { id: 'lab-tech', name: 'Laboratory technician', description: 'Samples, result entry and verification', userName: 'Santosh Gowda', initials: 'SG', dashboard: 'lab' },
  { id: 'radiologist', name: 'Radiologist', description: 'Imaging worklist and reporting', userName: 'Dr. Farah Siddiqui', initials: 'FS', dashboard: 'radiology' },
  { id: 'billing', name: 'Billing executive', description: 'Invoices, payments, refunds and claims', userName: 'Kiran Shetty', initials: 'KS', dashboard: 'billing' },
  { id: 'hr', name: 'HR manager', description: 'Staff, rosters, attendance and leave', userName: 'Lavanya HR', initials: 'LH', dashboard: 'hr' },
  { id: 'inventory', name: 'Inventory manager', description: 'Stores, requisitions, purchase orders and assets', userName: 'Store manager', initials: 'SM', dashboard: 'inventory' },
  { id: 'patient', name: 'Patient', description: 'Opens the patient portal', userName: 'Lakshmi Narayan', initials: 'LN', dashboard: 'portal' },
];
export const role = (id: RoleId) => ROLES.find(r => r.id === id)!;

export interface NavItem { label: string; icon: string; path: string; roles?: RoleId[]; }
export interface NavGroup { label: string; items: NavItem[]; }
const A: RoleId[] = ['super-admin', 'admin'];
const CLIN: RoleId[] = [...A, 'doctor', 'nurse'];

export const NAV: NavGroup[] = [
  { label: 'Home', items: [
    { label: 'Dashboard', icon: 'layout-grid', path: '/dashboard' },
    { label: 'Alerts', icon: 'bell-ring', path: '/alerts' },
    { label: 'AI assistant', icon: 'sparkles', path: '/assistant', roles: [...A, 'doctor', 'billing'] },
  ] },
  { label: 'Front desk', items: [
    { label: 'Patients', icon: 'users', path: '/patients', roles: [...CLIN, 'receptionist', 'billing', 'lab-tech', 'pharmacist', 'radiologist'] },
    { label: 'Appointments', icon: 'calendar-days', path: '/appointments', roles: [...A, 'doctor', 'receptionist', 'nurse'] },
    { label: 'Queue & journey', icon: 'activity', path: '/queue', roles: [...CLIN, 'receptionist'] },
  ] },
  { label: 'Clinical', items: [
    { label: 'Consultation', icon: 'stethoscope', path: '/consultation', roles: [...A, 'doctor'] },
    { label: 'Prescriptions', icon: 'file-pen-line', path: '/prescriptions', roles: [...A, 'doctor', 'pharmacist'] },
    { label: 'Nursing', icon: 'heart-handshake', path: '/nursing', roles: CLIN },
    { label: 'Emergency', icon: 'siren', path: '/emergency', roles: [...CLIN, 'receptionist'] },
    { label: 'Inpatients & beds', icon: 'bed-double', path: '/ipd', roles: [...CLIN, 'receptionist', 'billing'] },
    { label: 'Operation theatre', icon: 'scissors', path: '/ot', roles: [...A, 'doctor', 'nurse'] },
  ] },
  { label: 'Diagnostics', items: [
    { label: 'Laboratory', icon: 'flask-conical', path: '/lab/orders', roles: [...A, 'doctor', 'lab-tech', 'nurse'] },
    { label: 'Radiology', icon: 'scan-line', path: '/radiology', roles: [...A, 'doctor', 'radiologist'] },
  ] },
  { label: 'Pharmacy & stock', items: [
    { label: 'Pharmacy', icon: 'pill', path: '/pharmacy/dispense', roles: [...A, 'pharmacist'] },
    { label: 'Pharmacy stock', icon: 'package', path: '/pharmacy/inventory', roles: [...A, 'pharmacist', 'inventory'] },
    { label: 'Hospital inventory', icon: 'boxes', path: '/inventory', roles: [...A, 'inventory'] },
    { label: 'Procurement', icon: 'truck', path: '/procurement', roles: [...A, 'inventory', 'pharmacist'] },
  ] },
  { label: 'Finance', items: [
    { label: 'Billing', icon: 'indian-rupee', path: '/billing', roles: [...A, 'billing', 'receptionist'] },
    { label: 'Insurance & TPA', icon: 'shield-check', path: '/insurance', roles: [...A, 'billing'] },
    { label: 'Expenses', icon: 'wallet', path: '/expenses', roles: [...A, 'billing'] },
    { label: 'Tally export', icon: 'file-spreadsheet', path: '/tally', roles: [...A, 'billing'] },
    { label: 'Revenue leakage', icon: 'trending-down', path: '/revenue-leakage', roles: [...A, 'billing'] },
  ] },
  { label: 'Insights', items: [
    { label: 'Reports', icon: 'chart-column', path: '/reports', roles: [...A, 'billing', 'hr'] },
    { label: 'Follow-ups', icon: 'calendar-clock', path: '/follow-ups', roles: [...A, 'doctor', 'receptionist'] },
    { label: 'Clinical safety', icon: 'shield-alert', path: '/clinical-safety', roles: [...A, 'doctor', 'pharmacist', 'nurse'] },
    { label: 'Branches', icon: 'building-2', path: '/branches', roles: A },
  ] },
  { label: 'Organisation', items: [
    { label: 'Staff & rosters', icon: 'id-card', path: '/staff', roles: [...A, 'hr'] },
    { label: 'Notifications', icon: 'message-square-text', path: '/notifications', roles: [...A, 'receptionist'] },
    { label: 'Users & roles', icon: 'user-cog', path: '/admin/users', roles: A },
    { label: 'Audit logs', icon: 'scroll-text', path: '/admin/audit', roles: A },
    { label: 'Hospital settings', icon: 'settings', path: '/admin/config', roles: A },
    { label: 'Integrations', icon: 'plug', path: '/admin/integrations', roles: A },
    { label: 'Workflow builder', icon: 'workflow', path: '/admin/workflows', roles: A },
  ] },
];
