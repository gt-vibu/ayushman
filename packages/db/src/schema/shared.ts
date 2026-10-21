import { pgEnum, timestamp } from 'drizzle-orm/pg-core';

export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const membershipRole = pgEnum('membership_role', [
  'owner',
  'admin',
  'professional',
  'scheduler',
]);
export const membershipStatus = pgEnum('membership_status', ['invited', 'active', 'suspended']);
export const availabilityScope = pgEnum('availability_scope', [
  'practice',
  'location',
  'professional',
  'professional_location',
]);
export const exceptionKind = pgEnum('exception_kind', ['closed', 'extra_hours']);
export const appointmentStatus = pgEnum('appointment_status', [
  'held',
  'pending',
  'confirmed',
  'checked_in',
  'in_progress',
  'completed',
  'no_show',
  'cancelled',
]);
export const accessScope = pgEnum('access_scope', ['practice', 'assigned_locations', 'own']);
export const permissionEffect = pgEnum('permission_effect', ['allow', 'deny']);
export const platformRole = pgEnum('platform_role', ['superadmin', 'support']);
export const invoiceKind = pgEnum('invoice_kind', ['tax_invoice', 'bill_of_supply', 'receipt']);
export const invoiceStatus = pgEnum('invoice_status', ['issued', 'partially_paid', 'paid', 'void']);
export const invoiceTaxMode = pgEnum('invoice_tax_mode', ['none', 'cgst_sgst', 'igst']);
export const invoicePaymentMethod = pgEnum('invoice_payment_method', ['cash', 'card', 'bank_transfer', 'upi', 'insurance', 'other']);
