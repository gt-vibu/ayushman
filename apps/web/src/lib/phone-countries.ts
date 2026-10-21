import { PHONE_COUNTRY_PRESETS } from '@ayushman-v2/contracts';

export const PHONE_COUNTRIES = PHONE_COUNTRY_PRESETS;

export function toE164(countryCode: string, nationalNumber: string) {
  const country = PHONE_COUNTRIES.find((item) => item.code === countryCode);
  const digits = nationalNumber.replace(/\D/g, '');
  return country && digits ? `${country.dial}${digits}` : '';
}
