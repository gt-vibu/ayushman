import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LoginInput,
  ChangePasswordInput,
  RegistrationInput,
  CustomerRegistrationInput,
  CustomerProfileUpdateInput,
  PracticeCreateInput,
  PracticeUpdateInput,
  LocationInput,
  LocationUpdateInput,
  StaffAssignmentInput,
  StaffRolesInput,
  StaffLocationsInput,
  MembershipPermissionOverridesInput,
  PracticeRolePermissionSettingsInput,
  StaffInvitationInput,
  AcceptStaffInvitationInput,
  ProfessionalProfileInput,
  ServiceInput,
  PracticeProfessionInput,
  CreatePracticeProfessionInput,
  PracticeProfessionUpdateInput,
  AvailabilityRuleInput,
  ProfessionalScheduleInput,
  AvailabilityExceptionInput,
  AvailabilityBatchInput,
  BookingPolicyInput,
  PublicBookingInput,
  GuestPublicBookingInput,
  PublicBookingHoldInput,
  BookingWaitlistInput,
  BookingWaitlistStatusInput,
  BookingWaitlistOfferInput,
  CreateFollowUpInput,
  AppointmentStatusInput,
  AppointmentServiceChangeInput,
  AppointmentStatusCorrectionInput,
  AppointmentRescheduleInput,
  AppointmentReassignmentInput,
  BulkRescheduleOptionsInput,
  BulkAppointmentRescheduleInput,
  CustomerAppointmentCancelInput,
  CreateClientInput,
  UpdateClientInput,
  ClientMergeInput,
  ClientAccountLinkInput,
  ClientDependentInput,
  ManualAppointmentInput,
  AppointmentPaymentInput,
  BillingProfileInput,
  InvoiceCreateInput,
  InvoicePaymentInput,
  InvoiceVoidInput,
  ClientDocumentUploadInput,
} from '../dist/index.js';

const uuid = '00000000-0000-4000-8000-000000000001';

test('email accepts normal addresses and reserved local .test addresses', () => {
  for (const email of ['person@example.com', 'person+qa@clinic.example.test']) {
    assert.equal(LoginInput.safeParse({ email, password: 'x' }).success, true, email);
  }
});

test('email rejects malformed labels even on reserved .test domains', () => {
  for (const email of ['a@foo..test', 'a@.test', 'a..b@example.test', 'a@@example.test', 'a@foo.test.']) {
    assert.equal(LoginInput.safeParse({ email, password: 'x' }).success, false, email);
  }
});

test('Indian phone number must contain exactly ten national digits', () => {
  const base = { email: 'person@example.com', fullName: 'Test User', password: '123456789012' };
  assert.equal(CustomerRegistrationInput.safeParse({ ...base, phone: '+919876543210' }).success, true);
  for (const phone of ['+91987654321', '+9198765432101', '+91abcdefghij']) {
    assert.equal(CustomerRegistrationInput.safeParse({ ...base, phone }).success, false, phone);
  }
});

test('registration and profile updates enforce required fields and bounds', () => {
  assert.equal(RegistrationInput.safeParse({
    email: 'owner@example.com', fullName: 'Owner Name', password: '123456789012',
    practice: { name: 'Example Practice' },
  }).success, true);
  assert.equal(RegistrationInput.safeParse({
    email: 'owner@example.com', fullName: 'A', password: 'short',
    practice: { name: 'X', timezone: 'Not/AZone' },
  }).success, false);
  assert.equal(CustomerProfileUpdateInput.safeParse({}).success, false);
  assert.equal(CustomerProfileUpdateInput.safeParse({ fullName: 'Updated Name' }).success, true);
});

test('service and schedule forms reject invalid numeric ranges and duplicate weekdays', () => {
  const service = { practiceProfessionId: uuid, name: 'Consultation', durationMinutes: 30 };
  assert.equal(ServiceInput.safeParse(service).success, true);
  for (const durationMinutes of [4, 721, 30.5, Number.NaN]) {
    assert.equal(ServiceInput.safeParse({ ...service, durationMinutes }).success, false, String(durationMinutes));
  }
  const schedule = { practiceProfessionId: uuid, locationId: uuid, rules: [
    { weekday: 1, startMinute: 540, endMinute: 1020, slotIntervalMinutes: 30 },
  ] };
  assert.equal(ProfessionalScheduleInput.safeParse(schedule).success, true);
  assert.equal(ProfessionalScheduleInput.safeParse({ ...schedule, rules: [
    ...schedule.rules, { ...schedule.rules[0] },
  ] }).success, false);
  assert.equal(ProfessionalScheduleInput.safeParse({ ...schedule, rules: [
    { ...schedule.rules[0], startMinute: 1020, endMinute: 540 },
  ] }).success, false);
});

test('availability exceptions require consistent scope and paired times', () => {
  const valid = { locationId: uuid, date: '2026-11-10', kind: 'closed' };
  assert.equal(AvailabilityExceptionInput.safeParse(valid).success, true);
  assert.equal(AvailabilityExceptionInput.safeParse({ ...valid, kind: 'extra_hours' }).success, false);
  assert.equal(AvailabilityExceptionInput.safeParse({ ...valid, professionalUserId: uuid }).success, false);
  assert.equal(AvailabilityExceptionInput.safeParse({ ...valid, startMinute: 900 }).success, false);
});

test('guest booking and waitlist require a valid contact method', () => {
  const booking = { serviceId: uuid, locationId: uuid, professionalUserId: uuid, startsAt: '2026-11-10T10:00:00+05:30', fullName: 'Test User' };
  assert.equal(GuestPublicBookingInput.safeParse({ ...booking, phone: '+919876543210' }).success, true);
  assert.equal(GuestPublicBookingInput.safeParse(booking).success, false);
  const waitlist = { serviceId: uuid, locationId: uuid, requestedDate: '2026-11-10', fullName: 'Test User' };
  assert.equal(BookingWaitlistInput.safeParse({ ...waitlist, email: 'person@example.test' }).success, true);
  assert.equal(BookingWaitlistInput.safeParse(waitlist).success, false);
});

test('manual appointment requires exactly one customer source and payment method when paid', () => {
  const valid = { serviceId: uuid, locationId: uuid, professionalUserId: uuid, startsAt: '2026-11-10T10:00:00+05:30', clientId: uuid };
  assert.equal(ManualAppointmentInput.safeParse(valid).success, true);
  assert.equal(ManualAppointmentInput.safeParse({ ...valid, newClient: { fullName: 'New Client' } }).success, false);
  assert.equal(ManualAppointmentInput.safeParse({ ...valid, clientId: undefined, amountPaidMinor: 100 }).success, false);
  assert.equal(ManualAppointmentInput.safeParse({ ...valid, amountPaidMinor: 100, paymentMethod: 'upi' }).success, true);
});

test('invoice form validates dates, tax combinations, and line item bounds', () => {
  const invoice = { clientId: uuid, kind: 'receipt', issueDate: '2026-11-10', lines: [{ description: 'Session', unitPriceMinor: 10000 }] };
  assert.equal(InvoiceCreateInput.safeParse(invoice).success, true);
  assert.equal(InvoiceCreateInput.safeParse({ ...invoice, dueDate: '2026-11-09' }).success, false);
  assert.equal(InvoiceCreateInput.safeParse({ ...invoice, kind: 'tax_invoice' }).success, false);
  assert.equal(InvoiceCreateInput.safeParse({ ...invoice, lines: [] }).success, false);
  assert.equal(InvoiceCreateInput.safeParse({ ...invoice, taxMode: 'cgst_sgst', taxRateBps: 1800 }).success, false);
});

test('password, practice and location forms enforce boundaries and paired coordinates', () => {
  assert.equal(ChangePasswordInput.safeParse({ currentPassword: 'old-password', newPassword: 'new-password-123' }).success, true);
  assert.equal(ChangePasswordInput.safeParse({ currentPassword: 'same-password', newPassword: 'same-password' }).success, false);
  assert.equal(PracticeCreateInput.safeParse({ name: '  My Practice  ' }).success, true);
  assert.equal(PracticeCreateInput.safeParse({ name: 'x', currency: 'IND' }).success, false);
  assert.equal(PracticeUpdateInput.safeParse({ sessionRecordingRetentionDays: 3651 }).success, false);
  assert.equal(LocationInput.safeParse({ name: 'Main Branch', address: { line1: '1 Main St', city: 'Chennai', countryCode: 'in', latitude: 13.08 } }).success, false);
  assert.equal(LocationInput.safeParse({ name: 'Main Branch', address: { line1: '1 Main St', city: 'Chennai', countryCode: 'in', latitude: 13.08, longitude: 80.27 } }).success, true);
  assert.equal(LocationInput.safeParse({ name: 'Main Branch', address: { line1: '1 Main St', city: 'Chennai', countryCode: 'IND' } }).success, false);
  assert.equal(LocationUpdateInput.safeParse({}).success, false);
});

test('staff roles, invitations, and permission overrides reject duplicates and malformed scopes', () => {
  assert.equal(StaffAssignmentInput.safeParse({ email: 'person@example.com', roles: ['professional', 'scheduler'], locationIds: [uuid] }).success, true);
  assert.equal(StaffRolesInput.safeParse({ roles: ['scheduler', 'scheduler'] }).success, false);
  assert.equal(StaffLocationsInput.safeParse({ locationIds: ['not-a-uuid'] }).success, false);
  assert.equal(StaffInvitationInput.safeParse({ email: 'person@example.com', roles: [] }).success, false);
  assert.equal(AcceptStaffInvitationInput.safeParse({ token: 'x'.repeat(40), fullName: 'New Staff', password: '123456789012' }).success, true);
  assert.equal(AcceptStaffInvitationInput.safeParse({ token: 'short', fullName: 'A', password: 'short' }).success, false);
  assert.equal(MembershipPermissionOverridesInput.safeParse({ overrides: [
    { permissionCode: 'clients.read', effect: 'allow' }, { permissionCode: 'clients.read', effect: 'deny' },
  ] }).success, false);
  assert.equal(PracticeRolePermissionSettingsInput.safeParse({ settings: [
    { permissionCode: 'clients.read', enabled: true, scope: 'practice' },
    { permissionCode: 'clients.read', enabled: false, scope: 'own' },
  ] }).success, false);
});

test('professional profile, profession and service forms enforce text and ID bounds', () => {
  assert.equal(ProfessionalProfileInput.safeParse({ practiceProfessionId: uuid, locationIds: [uuid] }).success, true);
  assert.equal(ProfessionalProfileInput.safeParse({ practiceProfessionId: 'bad' }).success, false);
  assert.equal(PracticeProfessionInput.safeParse({ professionCode: 'physical-therapist', name: 'Physiotherapist' }).success, true);
  assert.equal(CreatePracticeProfessionInput.safeParse({ professionCode: 'Doctor!', name: 'Doctor' }).success, false);
  assert.equal(PracticeProfessionUpdateInput.safeParse({}).success, false);
  assert.equal(ServiceInput.safeParse({ practiceProfessionId: uuid, name: 'Consultation', durationMinutes: 30, priceMinor: 2_147_483_648 }).success, false);
});

test('availability and booking policy reject invalid ranges and enums', () => {
  const practiceRule = { scope: 'practice', weekday: 1, startMinute: 540, endMinute: 1020 };
  assert.equal(AvailabilityRuleInput.safeParse(practiceRule).success, true);
  assert.equal(AvailabilityRuleInput.safeParse({ ...practiceRule, scope: 'professional_location', locationId: uuid }).success, false);
  assert.equal(AvailabilityBatchInput.safeParse({ rules: Array(85).fill(practiceRule) }).success, false);
  assert.equal(BookingPolicyInput.safeParse({ maxAdvanceDays: 365, minNoticeMinutes: 0, cancellationCutoffMinutes: 0,
    patientReschedulingEnabled: true, reschedulingCutoffMinutes: 0, guestBookingEnabled: true,
    patientCancellationEnabled: true, emailNotificationsEnabled: false, requirePrepayment: false, confirmationMode: 'immediate' }).success, true);
  assert.equal(BookingPolicyInput.safeParse({ maxAdvanceDays: 0, minNoticeMinutes: -1, confirmationMode: 'manual' }).success, false);
});

test('booking, waitlist and follow-up forms validate contact and scheduling inputs', () => {
  const ids = { serviceId: uuid, locationId: uuid, professionalUserId: uuid, startsAt: '2026-11-10T10:00:00+05:30' };
  assert.equal(PublicBookingInput.safeParse(ids).success, true);
  assert.equal(PublicBookingHoldInput.safeParse({ ...ids, startsAt: 'not-a-date' }).success, false);
  assert.equal(BookingWaitlistStatusInput.safeParse({ status: 'waiting' }).success, false);
  assert.equal(BookingWaitlistOfferInput.safeParse({ professionalUserId: uuid, startsAt: ids.startsAt, expiresInHours: 73 }).success, false);
  const incompleteFollowUp = { locationId: ids.locationId, professionalUserId: ids.professionalUserId, startsAt: ids.startsAt };
  assert.equal(CreateFollowUpInput.safeParse({ ...incompleteFollowUp, sourceAppointmentId: uuid, clientId: uuid, note: 'Check progress' }).success, false);
  assert.equal(CreateFollowUpInput.safeParse({ ...ids, sourceAppointmentId: uuid, clientId: uuid, note: 'Check progress', serviceId: uuid }).success, true);
});

test('appointment actions and bulk reschedules reject invalid transitions and duplicate rows', () => {
  assert.equal(AppointmentStatusInput.safeParse({ status: 'interrupted' }).success, false);
  assert.equal(AppointmentStatusInput.safeParse({ status: 'interrupted', reason: 'Equipment issue' }).success, true);
  assert.equal(AppointmentServiceChangeInput.safeParse({ serviceId: uuid, reason: 'Changed need' }).success, true);
  assert.equal(AppointmentStatusCorrectionInput.safeParse({ status: 'cancelled', reason: 'Correction reason' }).success, false);
  assert.equal(AppointmentRescheduleInput.safeParse({ startsAt: '2026-11-10T10:00:00+05:30' }).success, true);
  assert.equal(AppointmentReassignmentInput.safeParse({ professionalUserId: uuid, startsAt: '2026-11-10T10:00:00+05:30', reason: 'Staff unavailable' }).success, true);
  assert.equal(BulkRescheduleOptionsInput.safeParse({ appointmentIds: [], date: '2026-11-10' }).success, false);
  assert.equal(BulkAppointmentRescheduleInput.safeParse({ reason: 'Provider unavailable', moves: [
    { appointmentId: uuid, startsAt: '2026-11-10T10:00:00+05:30' }, { appointmentId: uuid, startsAt: '2026-11-10T11:00:00+05:30' },
  ] }).success, false);
  assert.equal(CustomerAppointmentCancelInput.safeParse({ reason: 'Changed plans' }).success, true);
});

test('client directory, account linking and dependents validate identity safeguards', () => {
  assert.equal(CreateClientInput.safeParse({ fullName: 'Client One', phone: '+919876543210' }).success, true);
  assert.equal(CreateClientInput.safeParse({ fullName: 'A', phone: '+919876543210' }).success, false);
  assert.equal(UpdateClientInput.safeParse({ fullName: 'Client One', email: null, phone: null }).success, true);
  assert.equal(ClientMergeInput.safeParse({ targetClientId: uuid, reason: 'Same verified person' }).success, true);
  assert.equal(ClientMergeInput.safeParse({ targetClientId: uuid, reason: 'same' }).success, false);
  assert.equal(ClientAccountLinkInput.safeParse({ accountEmail: 'person@example.com', reason: 'Verified identity', identityAndConsentVerified: true }).success, true);
  assert.equal(ClientAccountLinkInput.safeParse({ accountEmail: 'person@example.com', reason: 'Verified identity', identityAndConsentVerified: false }).success, false);
  assert.equal(ClientDependentInput.safeParse({ fullName: 'Dependent One', relationship: 'guardian' }).success, true);
  assert.equal(ClientDependentInput.safeParse({ fullName: 'Dependent One', relationship: 'friend' }).success, false);
});

test('payments, billing profiles and file metadata enforce valid amounts and formats', () => {
  assert.equal(AppointmentPaymentInput.safeParse({ amountPaidMinor: 100, paymentMethod: 'upi' }).success, true);
  assert.equal(AppointmentPaymentInput.safeParse({ amountPaidMinor: 100 }).success, false);
  assert.equal(BillingProfileInput.safeParse({ invoicePrefix: 'AB 1' }).success, false);
  assert.equal(BillingProfileInput.safeParse({ gstin: '33ABCDE1234F1Z5' }).success, true);
  assert.equal(InvoicePaymentInput.safeParse({ amountMinor: 1, method: 'cash' }).success, true);
  assert.equal(InvoicePaymentInput.safeParse({ amountMinor: 0, method: 'cash' }).success, false);
  assert.equal(InvoiceVoidInput.safeParse({ reason: 'Duplicate invoice' }).success, true);
  assert.equal(ClientDocumentUploadInput.safeParse({ clientId: uuid, category: 'report', customerVisible: 'true' }).success, true);
  assert.equal(ClientDocumentUploadInput.safeParse({ clientId: 'bad', category: 'executable' }).success, false);
});
