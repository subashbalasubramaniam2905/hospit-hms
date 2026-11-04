/* HospitOS prototype — domain models. All data is fictional. */

export type RoleId =
  | 'super-admin' | 'admin' | 'doctor' | 'nurse' | 'receptionist' | 'pharmacist'
  | 'lab-tech' | 'radiologist' | 'billing' | 'hr' | 'inventory' | 'patient';

export interface Role { id: RoleId; name: string; description: string; userName: string; initials: string; dashboard: string; }

export interface Branch { id: string; name: string; city: string; beds: number; revenueMonth: number; visitsMonth: number; occupancy: number; doctors: number; doctorsAvailable: number; utilisation: Record<string, number>; }

export interface Department { id: string; name: string; icon: string; floor: string; head?: string; }

export interface Doctor {
  id: string; name: string; deptId: string; qualification: string; experience: number; fee: number;
  room: string; phone: string; email: string; days: string[]; start: string; end: string; slotMin: number;
  status: 'Available' | 'In OPD' | 'In OT' | 'On leave' | 'Off duty' | 'Running late'; regNo: string;
}

export interface Address { line: string; city: string; state: string; pin: string; }
export interface Insurance { providerId: string; policyNo: string; validTill: string; sumInsured: number; }
export interface PatientDoc { id: string; name: string; type: string; date: string; size: string; }

export interface Patient {
  id: string; name: string; dob: string; gender: 'Female' | 'Male' | 'Other'; mobile: string; email?: string;
  address: Address; blood: string; allergies: string[]; conditions: string[]; history: string;
  surgicalHistory?: string; familyHistory?: string; medications?: string;
  emergency: { name: string; relation: string; phone: string };
  insurance?: Insurance; abha?: string; consent: 'Given' | 'Pending' | 'Withdrawn';
  registered: string; primaryDoctorId: string; documents: PatientDoc[]; branchId: string;
  /** Server record version, used to detect concurrent edits (live mode only). */
  version?: number;
}

export type ApptStatus = 'Scheduled' | 'Confirmed' | 'Arrived' | 'Waiting' | 'In consultation' | 'Completed' | 'Cancelled' | 'No-show';
export interface Appointment {
  id: string; patientId: string; doctorId: string; deptId: string; date: string; time: string; duration: number;
  type: 'New consultation' | 'Follow-up' | 'Procedure' | 'Walk-in' | 'Teleconsult' | 'Review';
  status: ApptStatus; room: string; token?: string; notes?: string; recurring?: string; reminderSent?: boolean;
}

export const JOURNEY = ['Registration', 'Billing', 'Triage', 'Consultation', 'Lab / imaging', 'Pharmacy', 'Discharge'] as const;
export interface QueueEntry { id?: number; token: string; patientId: string; doctorId: string; deptId: string; step: number; since: number; arrivedAt: string; priority: boolean; emergency: boolean; appointmentId?: string; history: { step: number; at: string }[]; }

export interface Vitals { bp: string; hr: number | null; temp: number | null; rr: number | null; spo2: number | null; height: number | null; weight: number | null; }
export interface Diagnosis { code: string; label: string; }
export interface Consultation {
  id: string; appointmentId?: string; patientId: string; doctorId: string; date: string; template: string;
  vitals: Vitals; cc: string; hpi: string; pmh: string; fh: string; sh: string; meds: string; allergyNote: string;
  exam: string; dx: Diagnosis[]; assessment: string; plan: string; notes: string; followUp: string; followUpDate?: string;
  status: 'Draft' | 'Completed'; billed: boolean; prescriptionId?: string;
}

export interface RxItem { medId: string; name: string; generic: string; strength: string; dose: string; route: string; frequency: string; duration: string; qty: number; food: string; instructions: string; refills: number; }
export interface Prescription { id: string; consultationId?: string; patientId: string; doctorId: string; date: string; diagnosis: string; items: RxItem[]; status: 'Draft' | 'Signed' | 'Sent to pharmacy' | 'Dispensed' | 'Partially dispensed'; notes?: string; }

export interface Batch { batch: string; expiry: string; qty: number; supplierId: string; cost: number; received: string; }
export interface Medicine { id: string; generic: string; brand: string; strength: string; form: string; category: string; route: string; price: number; reorder: number; rack: string; batches: Batch[]; schedule?: string; }
export interface Supplier { id: string; name: string; contact: string; phone: string; gst: string; city: string; type: 'Pharmacy' | 'Surgical' | 'Equipment' | 'General'; rating: number; }
export interface POItem { itemId: string; name: string; qty: number; cost: number; received?: number; }
export interface PurchaseOrder { id: string; supplierId: string; date: string; kind: 'Pharmacy' | 'Inventory'; items: POItem[]; status: 'Draft' | 'Requested' | 'Approved' | 'Ordered' | 'Received' | 'Cancelled'; requestedBy: string; expected?: string; }
export interface StockMove { id: string; date: string; itemId: string; name: string; kind: 'Receipt' | 'Dispense' | 'Adjustment' | 'Transfer' | 'Return' | 'Issue'; qty: number; ref: string; by: string; note?: string; }

export interface LabParam { name: string; unit: string; low: number; high: number; critLow?: number; critHigh?: number; }
export interface LabTest { id: string; code: string; name: string; category: string; sample: string; price: number; tatHours: number; params: LabParam[]; profile?: string[]; }
export type LabStatus = 'Ordered' | 'Awaiting sample' | 'Sample collected' | 'Processing' | 'Result ready' | 'Verified' | 'Delivered';
export interface LabOrder { id: string; patientId: string; doctorId: string; testIds: string[]; date: string; time: string; status: LabStatus; priority: 'Routine' | 'Urgent' | 'STAT'; sampleId?: string; collectedAt?: string; collectedBy?: string; results: Record<string, Record<string, number | null>>; verifiedBy?: string; billed: boolean; comments?: string; }

export type ImgStatus = 'Ordered' | 'Scheduled' | 'In progress' | 'Awaiting report' | 'Reported' | 'Verified';
export interface ImagingOrder { id: string; patientId: string; doctorId: string; modality: 'X-ray' | 'CT' | 'MRI' | 'Ultrasound'; study: string; date: string; slot: string; room: string; status: ImgStatus; technician?: string; radiologist?: string; findings?: string; impression?: string; billed: boolean; price: number; priority: 'Routine' | 'Urgent'; }

export type PayMode = 'Cash' | 'UPI' | 'Card' | 'Bank transfer' | 'Online' | 'Insurance' | 'Advance';
export interface InvoiceItem { desc: string; category: 'Consultation' | 'Procedure' | 'Laboratory' | 'Imaging' | 'Pharmacy' | 'Room' | 'Nursing' | 'OT' | 'Other'; qty: number; rate: number; taxPct: number; refId?: string; }
export interface Payment { id: string; date: string; mode: PayMode; amount: number; ref?: string; }
export interface Invoice { id: string; patientId: string; date: string; items: InvoiceItem[]; discountPct: number; payments: Payment[]; refunds: Payment[]; status: 'Draft' | 'Unpaid' | 'Partially paid' | 'Paid' | 'Refunded' | 'Cancelled'; claimId?: string; admissionId?: string; createdBy: string; kind: 'OPD' | 'IPD' | 'Pharmacy' | 'Lab'; }

export interface InsuranceProvider { id: string; name: string; tpa: string; type: 'Insurer' | 'Government' | 'Corporate'; phone: string; cashless: boolean; }
export type ClaimStatus = 'Draft' | 'Submitted' | 'Under review' | 'Approved' | 'Rejected' | 'Settled';
export interface Claim { id: string; patientId: string; invoiceId?: string; admissionId?: string; providerId: string; policyNo: string; claimed: number; approved: number; copay: number; status: ClaimStatus; type: 'Pre-authorisation' | 'Final claim' | 'Reimbursement'; created: string; docs: string[]; rejectionReason?: string; history: { date: string; status: ClaimStatus; note: string }[]; }

export interface Ward { id: string; name: string; type: 'General' | 'Semi-private' | 'Private' | 'ICU' | 'Maternity' | 'Pediatric'; floor: string; rate: number; }
export type BedStatus = 'Available' | 'Occupied' | 'Reserved' | 'Cleaning' | 'Maintenance';
export interface Bed { id: string; wardId: string; label: string; status: BedStatus; admissionId?: string; }
export interface ClinicalNote { id: string; date: string; author: string; type: 'Progress' | 'Nursing' | 'Handover' | 'Doctor round'; text: string; }
export interface MarEntry { id: string; med: string; dose: string; route: string; time: string; date: string; status: 'Due' | 'Given' | 'Held' | 'Missed'; by?: string; }
export interface IOEntry { id: string; time: string; kind: 'Intake' | 'Output'; type: string; ml: number; }
export interface ObsEntry { time: string; bp: string; hr: number; temp: number; spo2: number; rr: number; pain: number; news: number; }
export interface Admission {
  id: string; patientId: string; doctorId: string; deptId: string; bedId: string; admittedOn: string; reason: string; diagnosis: string;
  type: 'Planned' | 'Emergency' | 'Day care' | 'Maternity'; status: 'Admitted' | 'Discharge planned' | 'Discharged';
  notes: ClinicalNote[]; mar: MarEntry[]; io: IOEntry[]; obs: ObsEntry[]; carePlan: string[]; dischargeDate?: string; dischargeSummary?: string; expectedDischarge: string; advance: number; nurseId?: string;
}

export interface Surgery { id: string; patientId: string; surgeonId: string; anaesthetist: string; room: string; date: string; start: string; durationMin: number; procedure: string; status: 'Scheduled' | 'Pre-op' | 'In progress' | 'Recovery' | 'Completed' | 'Cancelled'; checklist: Record<string, boolean>; anaesthesia: string; postOpNotes?: string; timeline: { at: string; event: string }[]; }

export type TriageLevel = 'Red' | 'Orange' | 'Yellow' | 'Green';
export interface ERCase { id: string; patientId?: string; label: string; age?: number; gender?: string; arrival: string; mode: 'Walk-in' | 'Ambulance' | 'Referred' | 'Police'; triage: TriageLevel; complaint: string; bay: string; doctorId?: string; vitals: { bp: string; hr: number; spo2: number; gcs: number; temp: number }; status: 'Waiting' | 'Under treatment' | 'Observation' | 'Admitted' | 'Discharged' | 'Referred'; orders: string[]; }

export interface StaffMember { id: string; name: string; role: string; category: 'Doctor' | 'Nurse' | 'Technician' | 'Admin' | 'Support' | 'Pharmacist'; deptId: string; phone: string; email: string; shift: 'Morning' | 'Evening' | 'Night' | 'General'; status: 'On duty' | 'Off duty' | 'On leave'; joined: string; salary: number; attendance: number; doctorId?: string; }
export interface LeaveRequest { id: string; staffId: string; from: string; to: string; type: 'Casual' | 'Sick' | 'Earned' | 'Maternity'; reason: string; status: 'Pending' | 'Approved' | 'Rejected'; }

export interface InventoryItem { id: string; name: string; category: 'Consumables' | 'Surgical supplies' | 'Medical equipment' | 'General supplies' | 'Linen' | 'Housekeeping'; unit: string; stock: number; reorder: number; location: string; cost: number; expiry?: string; supplierId: string; }
export interface Asset { id: string; name: string; category: string; tag: string; location: string; status: 'In use' | 'Available' | 'Under maintenance' | 'Retired'; purchased: string; value: number; nextService: string; }
export interface Requisition { id: string; date: string; dept: string; items: { itemId: string; name: string; qty: number }[]; status: 'Pending' | 'Approved' | 'Issued' | 'Rejected'; requestedBy: string; }

export type Channel = 'SMS' | 'Email' | 'WhatsApp' | 'In-app';
export interface NotificationMsg { id: string; time: string; channel: Channel; type: 'Appointment reminder' | 'Appointment confirmation' | 'Follow-up reminder' | 'Lab report ready' | 'Payment reminder' | 'Prescription' | 'Discharge' | 'System'; to: string; patientId?: string; message: string; status: 'Queued' | 'Sent' | 'Delivered' | 'Read' | 'Failed'; }
export interface InAppNote { id: string; time: string; title: string; body: string; read: boolean; link?: string; icon: string; tone: 'g' | 'a' | 'r' | 'b' | 'v'; }

export interface Alert { id: string; time: string; priority: 'Critical' | 'High' | 'Medium' | 'Low'; category: 'Clinical' | 'Lab' | 'Pharmacy' | 'Billing' | 'Operations' | 'Bed' | 'Safety' | 'System'; dept: string; title: string; detail: string; assignee: string; status: 'Open' | 'Acknowledged' | 'Resolved'; link?: string; }

export interface AuditLog { id: string; time: string; user: string; role: string; action: string; entity: string; detail: string; ip: string; branch: string; risk: 'Normal' | 'Sensitive' | 'Flagged'; }
export interface LoginEvent { id: string; time: string; user: string; role: string; ip: string; device: string; result: 'Success' | 'Failed' | 'Locked'; }
export interface UserAccount { id: string; name: string; email: string; roleId: RoleId; branches: string[]; depts: string[]; status: 'Active' | 'Invited' | 'Suspended'; lastLogin: string; mfa: boolean; }

export interface Integration { id: string; name: string; category: string; description: string; enabled: boolean; status: 'Connected' | 'Not configured' | 'Error' | 'Disabled'; lastSync?: string; fields: { key: string; label: string; value: string; secret?: boolean }[]; }
export interface WorkflowStep { kind: 'trigger' | 'condition' | 'action'; label: string; detail: string; }
export interface Workflow { id: string; name: string; enabled: boolean; runs: number; steps: WorkflowStep[]; lastRun?: string; }

export interface FollowUp { id: string; patientId: string; doctorId: string; due: string; reason: string; status: 'Due' | 'Overdue' | 'Booked' | 'Completed'; reminder: 'Not sent' | 'Sent' | 'Delivered' | 'Failed'; appointmentId?: string; }
export interface Feedback { id: string; patientId: string; date: string; rating: number; comment: string; dept: string; }

export interface ServiceItem { id: string; name: string; category: string; price: number; taxPct: number; dept?: string; }
export interface HospitalConfig {
  name: string; legalName: string; gstin: string; phone: string; email: string; address: string; registration: string;
  workingHours: { day: string; open: string; close: string; closed: boolean }[];
  apptRules: { slotMin: number; maxAdvanceDays: number; allowOverbook: boolean; noShowAfterMin: number; reminderHours: number };
  queueRules: { tokenPrefixByDept: boolean; delayAlertMin: number; emergencyJumpsQueue: boolean; seniorPriority: boolean };
  notifyRules: { key: string; label: string; sms: boolean; email: boolean; whatsapp: boolean; inapp: boolean }[];
  taxes: { name: string; rate: number; appliesTo: string }[];
}
