export type PracticeMembership = {
  practiceId: string;
  practiceName: string;
  practiceSlug: string;
  roles: string[];
};

export type Session = {
  user: { id: string; email: string; fullName: string };
  practices: PracticeMembership[];
};

export type Practice = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  phone: string | null;
  publicBookingEnabled: boolean;
  publicListingEnabled: boolean;
  sessionRecordingEnabled?: boolean;
  sessionRecordingRetentionDays?: number;
};

export type PracticeProfession = { id: string; name: string; termOverrides: Record<string, string> };

export type Branch = {
  id: string;
  name: string;
  active: boolean;
  timezone: string | null;
  address: { line1: string; line2?: string; city: string; state?: string; postalCode?: string; countryCode: string; latitude?: number; longitude?: number } | null;
};

export type Appointment = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: 'pending' | 'confirmed' | 'checked_in' | 'in_progress' | 'completed' | 'no_show' | 'cancelled';
  locationId: string;
  professionalUserId: string;
  serviceId: string;
  serviceName: string;
  clientId: string;
  clientName: string;
  clientEmail?: string | null;
  clientPhone?: string | null;
  clientNote?: string | null;
  timezone?: string;
};

export type Client = { id: string; fullName: string; email: string | null; phone: string | null; createdAt: string };
export type Service = { id: string; practiceProfessionId: string; name: string; description?: string | null; durationMinutes: number; bufferBeforeMinutes: number; bufferAfterMinutes: number; priceMinor: number | null; currency: string; active: boolean; onlineBookable: boolean; professionalUserIds?: string[]; locationIds?: string[] };
export type StaffMember = { membershipId: string; userId: string; email: string; fullName: string; status: string; roles: string[]; locations: { id: string; name: string }[] };

export const appointmentStatusLabel: Record<Appointment['status'], string> = {
  pending: 'Pending', confirmed: 'Confirmed', checked_in: 'Checked in', in_progress: 'In progress',
  completed: 'Completed', no_show: 'No show', cancelled: 'Cancelled',
};
