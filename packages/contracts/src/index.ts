import { z } from 'zod';

const uuid = z.string().uuid();
const minute = z.number().int().min(0).max(1440);
export const PHONE_COUNTRY_PRESETS = [
  { code: 'IN', name: 'India', dial: '+91', min: 10, max: 10 },
  { code: 'US', name: 'United States', dial: '+1', min: 10, max: 10 },
  { code: 'GB', name: 'United Kingdom', dial: '+44', min: 9, max: 10 },
  { code: 'CA', name: 'Canada', dial: '+1', min: 10, max: 10 },
  { code: 'AU', name: 'Australia', dial: '+61', min: 9, max: 9 },
  { code: 'AE', name: 'United Arab Emirates', dial: '+971', min: 9, max: 9 },
  { code: 'SG', name: 'Singapore', dial: '+65', min: 8, max: 8 },
  { code: 'DE', name: 'Germany', dial: '+49', min: 7, max: 11 },
  { code: 'FR', name: 'France', dial: '+33', min: 9, max: 9 },
  { code: 'NZ', name: 'New Zealand', dial: '+64', min: 8, max: 10 },
] as const;
const timeZone = z.string().min(1).max(64).refine((value) => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; }
  catch { return false; }
}, 'Use a valid IANA timezone');
const e164Phone = z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Use an international phone number with 8–15 digits, including country code').refine((value) => {
  const preset = PHONE_COUNTRY_PRESETS.find((country) => value.startsWith(country.dial));
  if (!preset) return true;
  const nationalDigits = value.slice(preset.dial.length).length;
  return nationalDigits >= preset.min && nationalDigits <= preset.max;
}, 'The number length does not match the selected country');
const cleanText = (max: number, min = 0) => z.string().trim().min(min).max(max).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'Control characters are not allowed');
// `.test` is a reserved, non-routable domain intended for examples and local tests.
// Demo accounts use it, so accept it alongside normal email addresses in shared forms.
const emailAddress = z.string().trim().max(320).refine((value) => {
  if (z.email().safeParse(value).success) return true;
  const [localPart, domain, ...extra] = value.split('@');
  return Boolean(localPart && domain && !extra.length && domain.toLowerCase().endsWith('.test') && domain.length > 5);
}, 'Enter a valid email address');
const postalCode = cleanText(20).refine((value) => value === '' || /^[\p{L}\p{N}][\p{L}\p{N} -]{0,19}$/u.test(value), 'Use letters, numbers, spaces, or hyphens');

export const LoginInput = z.object({
  email: emailAddress,
  password: z.string().min(1).max(128),
});

export const ChangePasswordInput = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128),
}).refine((value) => value.currentPassword !== value.newPassword, {
  message: 'Choose a password different from your current password',
  path: ['newPassword'],
});

export const RegistrationInput = z.object({
  email: emailAddress,
  fullName: z.string().trim().min(2).max(160),
  phone: e164Phone.optional(),
  password: z.string().min(12).max(128),
  practice: z.object({
    name: z.string().trim().min(2).max(180),
    timezone: timeZone.default('Asia/Kolkata'),
    currency: z.string().length(3).default('INR'),
  }),
});

export const CustomerRegistrationInput = z.object({
  email: emailAddress,
  fullName: z.string().trim().min(2).max(160),
  phone: e164Phone.optional(),
  password: z.string().min(12).max(128),
});

export const CustomerProfileUpdateInput = z.object({
  fullName: z.string().trim().min(2).max(160).optional(),
  phone: e164Phone.nullable().optional(),
}).refine((input) => input.fullName !== undefined || input.phone !== undefined, 'Provide at least one profile field to update');

export const PracticeCreateInput = z.object({
  name: z.string().trim().min(2).max(180),
  timezone: timeZone.default('Asia/Kolkata'),
  currency: z.string().length(3).default('INR'),
});

export const PracticeUpdateInput = z.object({
  name: z.string().trim().min(2).max(180).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  phone: e164Phone.nullable().optional(),
  website: z.url().max(500).nullable().optional(),
  timezone: timeZone.optional(),
  serviceMode: z.enum(['appointments', 'walk_ins', 'both']).optional(),
  publicBookingEnabled: z.boolean().optional(),
  publicListingEnabled: z.boolean().optional(),
  sessionRecordingEnabled: z.boolean().optional(),
  sessionRecordingRetentionDays: z.number().int().min(1).max(3650).optional(),
}).refine((value) => Object.keys(value).length > 0);

export const LocationInput = z.object({
  name: z.string().trim().min(2).max(140),
  address: z.object({
    line1: cleanText(160, 1),
    line2: cleanText(160).optional(),
    city: cleanText(100, 1),
    state: cleanText(100).optional(),
    postalCode: postalCode.optional(),
    countryCode: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  }).refine((value) => (value.latitude === undefined) === (value.longitude === undefined), 'Enter both latitude and longitude'),
  timezone: timeZone.optional(),
});
export const LocationUpdateInput = LocationInput.partial().extend({ active: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0);

export const StaffAssignmentInput = z.object({
  email: emailAddress,
  roles: z.array(z.enum(['admin', 'professional', 'scheduler'])).min(1).max(3).refine((roles) => new Set(roles).size === roles.length, 'Roles must be unique'),
  locationIds: z.array(uuid).max(100).default([]),
});
export const StaffRolesInput = z.object({
  roles: z.array(z.enum(['admin', 'professional', 'scheduler'])).min(1).max(3)
    .refine((roles) => new Set(roles).size === roles.length, 'Roles must be unique'),
});
export const StaffLocationsInput = z.object({ locationIds: z.array(uuid).max(100) });
export const MembershipStatusInput = z.object({ status: z.enum(['active', 'suspended']) });
export const MembershipPermissionOverridesInput = z.object({
  overrides: z.array(z.object({
    permissionCode: z.string().min(1).max(100),
    locationId: uuid.nullable().default(null),
    effect: z.enum(['allow', 'deny']),
  })).max(100),
}).refine((value) => {
  const keys = value.overrides.map((item) => `${item.permissionCode}:${item.locationId ?? 'practice'}`);
  return new Set(keys).size === keys.length;
}, 'A permission can only have one override per scope');
export const PracticeRolePermissionSettingsInput = z.object({
  resetToDefaults: z.boolean().default(false),
  settings: z.array(z.object({
    permissionCode: z.string().min(1).max(100),
    enabled: z.boolean(),
    scope: z.enum(['practice', 'assigned_locations', 'own']),
  })).max(200),
}).refine((value) => {
  const codes = value.settings.map((item) => item.permissionCode);
  return new Set(codes).size === codes.length;
}, 'A permission can only have one role setting');
export const StaffInvitationInput = z.object({
  email: emailAddress,
  roles: z.array(z.enum(['admin', 'professional', 'scheduler'])).min(1).max(3)
    .refine((roles) => new Set(roles).size === roles.length, 'Roles must be unique'),
  locationIds: z.array(uuid).max(100).default([]),
});
export const AcceptStaffInvitationInput = z.object({
  token: z.string().min(40).max(64),
  fullName: z.string().trim().min(2).max(160),
  password: z.string().min(12).max(128),
});
export const AcceptExistingStaffInvitationInput = z.object({ token: z.string().min(40).max(64) });

export const LocationProfessionInput = z.object({
  practiceProfessionId: uuid,
  enabled: z.boolean().default(true),
});

export const LocationScopeQuery = z.object({ locationId: uuid.optional() });

export const GeographyOptionsQuery = z.object({
  q: z.string().trim().max(80).optional(),
  countryCode: z.string().trim().length(2).optional(),
  state: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const ProfessionalProfileInput = z.object({
  practiceProfessionId: uuid,
  headline: z.string().trim().max(160).nullable().optional(),
  bio: z.string().trim().max(4000).nullable().optional(),
  profileAttributes: z.record(z.string(), z.union([z.string().max(500), z.array(z.string().max(200)).max(30)])).default({}),
  publicProfile: z.boolean().default(false),
  locationIds: z.array(uuid).max(100).default([]),
});

export const ServiceInput = z.object({
  practiceProfessionId: uuid,
  name: z.string().trim().min(2).max(160),
  description: z.string().max(2000).optional(),
  durationMinutes: z.number().int().min(5).max(720),
  bufferBeforeMinutes: z.number().int().min(0).max(240).default(0),
  bufferAfterMinutes: z.number().int().min(0).max(240).default(0),
  priceMinor: z.number().int().min(0).max(2_147_483_647).nullable().default(null),
  currency: z.string().length(3).default('INR'),
  onlineBookable: z.boolean().default(true),
  active: z.boolean().default(true),
  professionalUserIds: z.array(uuid).max(100).default([]),
  locationIds: z.array(uuid).max(100).default([]),
});

export const PracticeProfessionInput = z.object({
  professionCode: z.string().trim().min(2).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(2).max(120),
  termOverrides: z.object({
    professionalSingular: z.string().trim().min(1).max(40).optional(),
    professionalPlural: z.string().trim().min(1).max(40).optional(),
    clientSingular: z.string().trim().min(1).max(40).optional(),
    clientPlural: z.string().trim().min(1).max(40).optional(),
    serviceSingular: z.string().trim().min(1).max(40).optional(),
    servicePlural: z.string().trim().min(1).max(40).optional(),
    appointmentSingular: z.string().trim().min(1).max(40).optional(),
    locationSingular: z.string().trim().min(1).max(40).optional(),
  }).default({}),
});

export const CreatePracticeProfessionInput = PracticeProfessionInput.extend({ locationIds: z.array(uuid).max(100).default([]) });

export const PracticeProfessionUpdateInput = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  enabled: z.boolean().optional(),
  termOverrides: z.object({
    professionalSingular: z.string().trim().min(1).max(40).optional(),
    professionalPlural: z.string().trim().min(1).max(40).optional(),
    clientSingular: z.string().trim().min(1).max(40).optional(),
    clientPlural: z.string().trim().min(1).max(40).optional(),
    serviceSingular: z.string().trim().min(1).max(40).optional(),
    servicePlural: z.string().trim().min(1).max(40).optional(),
    appointmentSingular: z.string().trim().min(1).max(40).optional(),
    locationSingular: z.string().trim().min(1).max(40).optional(),
  }).optional(),
}).refine((value) => Object.keys(value).length > 0);

export const AvailabilityRuleInput = z.object({
  scope: z.enum(['practice', 'location', 'professional', 'professional_location']),
  practiceProfessionId: uuid.nullable().default(null),
  locationId: uuid.nullable().default(null),
  professionalUserId: uuid.nullable().default(null),
  weekday: z.number().int().min(0).max(6),
  startMinute: minute,
  endMinute: minute,
  slotIntervalMinutes: z.number().int().min(5).max(240).default(30),
}).refine((rule) => rule.startMinute < rule.endMinute, {
  message: 'End time must be after start time', path: ['endMinute'],
}).refine((rule) => {
  if (rule.scope === 'practice') return !rule.locationId && !rule.professionalUserId && !rule.practiceProfessionId;
  if (rule.scope === 'location') return Boolean(rule.locationId) && !rule.professionalUserId && !rule.practiceProfessionId;
  if (rule.scope === 'professional') return !rule.locationId && Boolean(rule.professionalUserId) && Boolean(rule.practiceProfessionId);
  return Boolean(rule.locationId) && Boolean(rule.professionalUserId) && Boolean(rule.practiceProfessionId);
}, { message: 'Selected scope and branch/professional must match' });

export const AvailabilityExceptionInput = z.object({
  locationId: uuid.nullable().default(null),
  professionalUserId: uuid.nullable().default(null),
  practiceProfessionId: uuid.nullable().default(null),
  date: z.iso.date(),
  kind: z.enum(['closed', 'extra_hours']),
  startMinute: minute.nullable().default(null),
  endMinute: minute.nullable().default(null),
  reason: z.string().trim().max(240).optional(),
}).refine((item) => item.locationId || item.professionalUserId, { message: 'A branch or professional scope is required' })
  .refine((item) => item.startMinute === null && item.endMinute === null || item.startMinute !== null && item.endMinute !== null && item.startMinute < item.endMinute, { message: 'Exception times must be a valid pair' })
  .refine((item) => !item.professionalUserId || Boolean(item.practiceProfessionId), { message: 'Professional exceptions require a profession' })
  .refine((item) => !item.practiceProfessionId || Boolean(item.professionalUserId), { message: 'Profession scope requires a professional' })
  .refine((item) => item.kind !== 'extra_hours' || item.startMinute !== null, { message: 'Extra hours require a time range' });

export const AvailabilityExceptionQuery = z.object({
  locationId: uuid.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
}).refine((query) => !query.from || !query.to || query.from <= query.to, 'End date must not precede start date');

export const AvailabilityBatchInput = z.object({ rules: z.array(AvailabilityRuleInput).max(84) });

export const ProfessionalScheduleInput = z.object({
  practiceProfessionId: uuid,
  locationId: uuid,
  rules: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    startMinute: minute,
    endMinute: minute,
    slotIntervalMinutes: z.number().int().min(5).max(240),
  }).refine((rule) => rule.startMinute < rule.endMinute, 'End time must be after start time')).max(7)
    .refine((rules) => new Set(rules.map((rule) => rule.weekday)).size === rules.length, 'Use one availability window per day'),
});

export const BookingPolicyInput = z.object({
  maxAdvanceDays: z.number().int().min(1).max(365),
  minNoticeMinutes: z.number().int().min(0).max(525600),
  cancellationCutoffMinutes: z.number().int().min(0).max(525600),
  patientReschedulingEnabled: z.boolean(),
  reschedulingCutoffMinutes: z.number().int().min(0).max(525600),
  guestBookingEnabled: z.boolean(),
  patientCancellationEnabled: z.boolean(),
  emailNotificationsEnabled: z.boolean(),
  requirePrepayment: z.boolean(),
  confirmationMode: z.enum(['immediate', 'approval']),
});

export const PublicAvailabilityQuery = z.object({
  serviceId: uuid,
  locationId: uuid,
  professionalUserId: uuid.optional(),
  from: z.iso.date(),
  to: z.iso.date(),
});

export const PublicDirectoryQuery = z.object({ q: z.string().trim().max(80).optional() });

export const PublicBookingInput = z.object({
  serviceId: uuid,
  locationId: uuid,
  professionalUserId: uuid,
  startsAt: z.iso.datetime({ offset: true }),
  holdId: uuid.optional(),
  note: z.string().trim().max(1000).optional(),
});

export const GuestPublicBookingInput = z.object({
  serviceId: uuid,
  locationId: uuid,
  professionalUserId: uuid,
  startsAt: z.iso.datetime({ offset: true }),
  fullName: z.string().trim().min(2).max(160),
  email: emailAddress.optional(),
  phone: e164Phone.optional(),
  note: z.string().trim().max(1000).optional(),
}).refine((value) => Boolean(value.email || value.phone), 'Add an email address or phone number so the practice can contact you');

export const PublicBookingHoldInput = z.object({
  serviceId: uuid,
  locationId: uuid,
  professionalUserId: uuid,
  startsAt: z.iso.datetime({ offset: true }),
});

export const CreateFollowUpInput = z.object({
  sourceAppointmentId: uuid,
  clientId: uuid,
  serviceId: uuid,
  locationId: uuid,
  professionalUserId: uuid,
  startsAt: z.iso.datetime({ offset: true }),
  note: z.string().trim().max(1000).optional(),
});

// Attach an already-booked visit to the completed visit it follows. This is
// useful when a follow-up was arranged outside the dedicated scheduling flow.
export const LinkFollowUpInput = z.object({ sourceAppointmentId: uuid });

export const AppointmentStatusInput = z.object({
  status: z.enum(['confirmed', 'checked_in', 'in_progress', 'completed', 'interrupted', 'no_show', 'cancelled']),
  reason: z.string().trim().max(240).optional(),
}).refine((value) => value.status !== 'interrupted' || Boolean(value.reason && value.reason.length >= 5), {
  message: 'Add a short reason when a visit is interrupted', path: ['reason'],
});

export const AppointmentServiceChangeInput = z.object({
  serviceId: uuid,
  reason: z.string().trim().min(5).max(500),
});

export const AppointmentStatusCorrectionInput = z.object({
  status: z.enum(['confirmed', 'checked_in', 'in_progress', 'completed']),
  reason: z.string().trim().min(10).max(500),
});

export const AppointmentRescheduleInput = z.object({ startsAt: z.iso.datetime({ offset: true }) });
export const AppointmentReassignmentInput = z.object({ professionalUserId: z.uuid(), startsAt: z.iso.datetime({ offset: true }), reason: z.string().trim().min(5).max(500) });
export const BulkRescheduleOptionsInput = z.object({ appointmentIds: z.array(z.uuid()).min(1).max(50), date: z.iso.date(), allowPractitionerChange: z.boolean().default(false) });
export const BulkAppointmentRescheduleInput = z.object({ reason: z.string().trim().min(5).max(500), moves: z.array(z.object({ appointmentId: z.uuid(), startsAt: z.iso.datetime({ offset: true }), professionalUserId: z.uuid().optional() })).min(1).max(50) }).refine(({ moves }) => new Set(moves.map((move) => move.appointmentId)).size === moves.length, 'Each appointment may only be included once');
export const CustomerAppointmentCancelInput = z.object({ reason: z.string().trim().max(240).optional() });

export const AppointmentListQuery = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  locationId: uuid.optional(),
  clientId: uuid.optional(),
  status: z.enum(['pending', 'confirmed', 'checked_in', 'in_progress', 'completed', 'interrupted', 'no_show', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const BillingAppointmentQuery = z.object({
  date: z.iso.date().optional(),
  clientId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const ClientListQuery = z.object({
  q: z.string().trim().min(2).max(80).optional(),
  locationId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const CreateClientInput = z.object({
  fullName: z.string().trim().min(2).max(160),
  email: emailAddress.optional(),
  phone: e164Phone.optional(),
  locationId: uuid.optional(),
});

export const UpdateClientInput = z.object({
  fullName: z.string().trim().min(2).max(160),
  email: emailAddress.nullable(),
  phone: e164Phone.nullable(),
  locationId: uuid.optional(),
});
export const ClientMergeInput = z.object({ targetClientId: uuid, reason: z.string().trim().min(10).max(500) });
export const ClientAccountLinkInput = z.object({ accountEmail: emailAddress, reason: z.string().trim().min(10).max(500), identityAndConsentVerified: z.literal(true) });

export const ManualAppointmentInput = z.object({
  clientId: uuid.optional(),
  newClient: CreateClientInput.optional(),
  serviceId: uuid,
  locationId: uuid,
  professionalUserId: uuid,
  startsAt: z.iso.datetime({ offset: true }),
  isWalkIn: z.boolean().default(false),
  historicalEntry: z.boolean().default(false),
  visitDescription: z.string().trim().max(1000).optional(),
  durationMinutes: z.number().int().min(5).max(720).optional(),
  priceMinor: z.number().int().min(0).max(2_147_483_647).nullable().optional(),
  amountPaidMinor: z.number().int().min(0).max(2_147_483_647).default(0),
  paymentMethod: z.enum(['cash', 'upi', 'card', 'bank_transfer', 'insurance', 'other']).optional(),
  note: z.string().trim().max(1000).optional(),
}).refine((value) => Boolean(value.clientId) !== Boolean(value.newClient), 'Choose an existing client or enter a new client, but not both')
  .refine((value) => value.amountPaidMinor === 0 || Boolean(value.paymentMethod), 'Select how the payment was received')
  .refine((value) => !value.historicalEntry || value.isWalkIn, 'Historical visits must be recorded as walk-ins')
  .refine((value) => !value.historicalEntry || new Date(value.startsAt) < new Date(), 'Historical visit time must be in the past');

export const AppointmentPaymentInput = z.object({
  amountPaidMinor: z.number().int().min(0).max(2_147_483_647),
  paymentMethod: z.enum(['cash', 'upi', 'card', 'bank_transfer', 'insurance', 'other']).nullable().optional(),
}).refine((value) => value.amountPaidMinor === 0 || Boolean(value.paymentMethod), 'Select how the payment was received');

const InvoiceAddress = z.object({
  line1: cleanText(160).optional(),
  line2: cleanText(160).optional(),
  city: cleanText(100).optional(),
  state: cleanText(100).optional(),
  stateCode: z.string().trim().max(3).optional(),
  postalCode: postalCode.optional(),
  countryCode: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()).optional(),
});

export const BillingProfileInput = z.object({
  legalName: z.string().trim().min(2).max(180).nullable().optional(),
  gstin: z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/).nullable().optional(),
  address: InvoiceAddress.nullable().optional(),
  email: emailAddress.nullable().optional(),
  phone: e164Phone.nullable().optional(),
  invoicePrefix: z.string().trim().regex(/^[A-Z0-9-]{1,12}$/).optional(),
}).refine((input) => Object.keys(input).length > 0, 'Provide a billing profile field to update');

export const InvoiceCreateInput = z.object({
  clientId: uuid,
  appointmentId: uuid.optional(),
  locationId: uuid.optional(),
  kind: z.enum(['tax_invoice', 'bill_of_supply', 'receipt']),
  issueDate: z.iso.date(),
  dueDate: z.iso.date().optional(),
  recipientAddress: InvoiceAddress.optional(),
  recipientGstin: z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/).optional(),
  placeOfSupply: z.string().trim().max(120).optional(),
  sacCode: z.string().trim().regex(/^[0-9A-Z-]{4,12}$/i).optional(),
  taxMode: z.enum(['none', 'cgst_sgst', 'igst']).default('none'),
  taxRateBps: z.number().int().min(0).max(2800).default(0),
  discountMinor: z.number().int().min(0).max(1000000000).default(0),
  notes: z.string().trim().max(1000).optional(),
  lines: z.array(z.object({
    description: z.string().trim().min(1).max(500),
    sacCode: z.string().trim().regex(/^[0-9A-Z-]{4,12}$/i).optional(),
    quantityMilli: z.number().int().min(1).max(1000000).default(1000),
    unitPriceMinor: z.number().int().min(0).max(1000000000),
  })).min(1).max(30),
}).refine((input) => (input.taxMode !== 'none') === (input.taxRateBps > 0), {
  message: 'Choose a tax mode and a non-zero rate together, or choose no tax.', path: ['taxRateBps'],
}).refine((input) => input.kind === 'tax_invoice' || input.taxMode === 'none', {
  message: 'Bill of supply and receipt documents cannot charge GST.', path: ['taxMode'],
});

export const InvoicePaymentInput = z.object({
  amountMinor: z.number().int().min(1).max(1000000000),
  method: z.enum(['cash', 'card', 'bank_transfer', 'upi', 'insurance', 'other']),
  reference: z.string().trim().max(120).optional(),
});

export const InvoiceVoidInput = z.object({ reason: z.string().trim().min(3).max(300) });

export const ClientDocumentUploadInput = z.object({
  clientId: uuid,
  appointmentId: uuid.optional(),
  locationId: uuid.optional(),
  category: z.enum(['prescription', 'lab_result', 'report', 'referral', 'consent', 'insurance', 'other']),
  description: z.string().trim().max(500).optional(),
  customerVisible: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
});

export type LoginInput = z.infer<typeof LoginInput>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordInput>;
export type RegistrationInput = z.infer<typeof RegistrationInput>;
export type CustomerRegistrationInput = z.infer<typeof CustomerRegistrationInput>;
export type CustomerProfileUpdateInput = z.infer<typeof CustomerProfileUpdateInput>;
export type PracticeCreateInput = z.infer<typeof PracticeCreateInput>;
export type PracticeUpdateInput = z.infer<typeof PracticeUpdateInput>;
export type LocationInput = z.infer<typeof LocationInput>;
export type LocationUpdateInput = z.infer<typeof LocationUpdateInput>;
export type StaffAssignmentInput = z.infer<typeof StaffAssignmentInput>;
export type StaffRolesInput = z.infer<typeof StaffRolesInput>;
export type StaffLocationsInput = z.infer<typeof StaffLocationsInput>;
export type MembershipStatusInput = z.infer<typeof MembershipStatusInput>;
export type MembershipPermissionOverridesInput = z.infer<typeof MembershipPermissionOverridesInput>;
export type PracticeRolePermissionSettingsInput = z.infer<typeof PracticeRolePermissionSettingsInput>;
export type StaffInvitationInput = z.infer<typeof StaffInvitationInput>;
export type AcceptStaffInvitationInput = z.infer<typeof AcceptStaffInvitationInput>;
export type AcceptExistingStaffInvitationInput = z.infer<typeof AcceptExistingStaffInvitationInput>;
export type LocationProfessionInput = z.infer<typeof LocationProfessionInput>;
export type LocationScopeQuery = z.infer<typeof LocationScopeQuery>;
export type ProfessionalProfileInput = z.infer<typeof ProfessionalProfileInput>;
export type ServiceInput = z.infer<typeof ServiceInput>;
export type PracticeProfessionInput = z.infer<typeof PracticeProfessionInput>;
export type CreatePracticeProfessionInput = z.infer<typeof CreatePracticeProfessionInput>;
export type PracticeProfessionUpdateInput = z.infer<typeof PracticeProfessionUpdateInput>;
export type AvailabilityBatchInput = z.infer<typeof AvailabilityBatchInput>;
export type ProfessionalScheduleInput = z.infer<typeof ProfessionalScheduleInput>;
export type AvailabilityExceptionInput = z.infer<typeof AvailabilityExceptionInput>;
export type AvailabilityExceptionQuery = z.infer<typeof AvailabilityExceptionQuery>;
export type BookingPolicyInput = z.infer<typeof BookingPolicyInput>;
export type PublicAvailabilityQuery = z.infer<typeof PublicAvailabilityQuery>;
export type PublicDirectoryQuery = z.infer<typeof PublicDirectoryQuery>;
export type GeographyOptionsQuery = z.infer<typeof GeographyOptionsQuery>;
export type PublicBookingInput = z.infer<typeof PublicBookingInput>;
export type GuestPublicBookingInput = z.infer<typeof GuestPublicBookingInput>;
export type PublicBookingHoldInput = z.infer<typeof PublicBookingHoldInput>;
export type CreateFollowUpInput = z.infer<typeof CreateFollowUpInput>;
export type LinkFollowUpInput = z.infer<typeof LinkFollowUpInput>;
export type AppointmentStatusInput = z.infer<typeof AppointmentStatusInput>;
export type AppointmentServiceChangeInput = z.infer<typeof AppointmentServiceChangeInput>;
export type AppointmentStatusCorrectionInput = z.infer<typeof AppointmentStatusCorrectionInput>;
export type AppointmentRescheduleInput = z.infer<typeof AppointmentRescheduleInput>;
export type AppointmentReassignmentInput = z.infer<typeof AppointmentReassignmentInput>;
export type BulkRescheduleOptionsInput = z.infer<typeof BulkRescheduleOptionsInput>;
export type BulkAppointmentRescheduleInput = z.infer<typeof BulkAppointmentRescheduleInput>;
export type CustomerAppointmentCancelInput = z.infer<typeof CustomerAppointmentCancelInput>;
export type AppointmentListQuery = z.infer<typeof AppointmentListQuery>;
export type BillingAppointmentQuery = z.infer<typeof BillingAppointmentQuery>;
export type ClientListQuery = z.infer<typeof ClientListQuery>;
export type CreateClientInput = z.infer<typeof CreateClientInput>;
export type UpdateClientInput = z.infer<typeof UpdateClientInput>;
export type ClientMergeInput = z.infer<typeof ClientMergeInput>;
export type ClientAccountLinkInput = z.infer<typeof ClientAccountLinkInput>;
export type ManualAppointmentInput = z.infer<typeof ManualAppointmentInput>;
export type AppointmentPaymentInput = z.infer<typeof AppointmentPaymentInput>;
export type BillingProfileInput = z.infer<typeof BillingProfileInput>;
export type InvoiceCreateInput = z.infer<typeof InvoiceCreateInput>;
export type InvoicePaymentInput = z.infer<typeof InvoicePaymentInput>;
export type InvoiceVoidInput = z.infer<typeof InvoiceVoidInput>;
export type ClientDocumentUploadInput = z.infer<typeof ClientDocumentUploadInput>;
