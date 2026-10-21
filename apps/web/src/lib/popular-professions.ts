export const POPULAR_PROFESSIONS = [
  'Consultant', 'Doctor', 'Dentist', 'Psychologist', 'Therapist',
  'Physiotherapist', 'Lawyer', 'Accountant', 'Tutor', 'Personal Trainer',
] as const;

export function professionCodeFor(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64).replace(/-$/g, '');
}
