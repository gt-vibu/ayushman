'use client';

import { useEffect, useRef, useState } from 'react';
import { PHONE_COUNTRIES, toE164 } from '@/lib/phone-countries';
import { Select } from '@/components/ui/select';

type PhoneFieldProps = {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  autoComplete?: string;
  disabled?: boolean;
};

export function PhoneField({ value, onChange, required = false, autoComplete = 'tel-national', disabled = false }: PhoneFieldProps) {
  const initialCountry = PHONE_COUNTRIES.find((item) => value.startsWith(item.dial));
  const [countryCode, setCountryCode] = useState<string>(initialCountry?.code ?? 'IN');
  const [nationalNumber, setNationalNumber] = useState(initialCountry ? value.slice(initialCountry.dial.length).replace(/\D/g, '') : value.replace(/\D/g, ''));
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastEmittedValue = useRef('');
  const country = PHONE_COUNTRIES.find((item) => item.code === countryCode) ?? PHONE_COUNTRIES[0];
  const error = nationalNumber.length > 0 && (nationalNumber.length < country.min || nationalNumber.length > country.max || toE164(country.code, nationalNumber).replace(/\D/g, '').length > 15)
    ? `${country.name} numbers should contain ${country.min === country.max ? country.min : `${country.min}–${country.max}`} digits.`
    : required && nationalNumber.length === 0 ? 'Enter a phone number.' : '';

  useEffect(() => { inputRef.current?.setCustomValidity(error); }, [error]);
  useEffect(() => {
    if (value === lastEmittedValue.current) return;
    if (value === '') { setNationalNumber(''); return; }
    if (!value.startsWith('+')) return;
    const match = PHONE_COUNTRIES.find((item) => value.startsWith(item.dial));
    if (match) { setCountryCode(match.code); setNationalNumber(value.slice(match.dial.length).replace(/\D/g, '')); }
  }, [value]);

  function updateCountry(nextCode: string) {
    setCountryCode(nextCode);
    const nextCountry = PHONE_COUNTRIES.find((item) => item.code === nextCode) ?? PHONE_COUNTRIES[0];
    const nextNumber = nationalNumber.slice(0, nextCountry.max);
    setNationalNumber(nextNumber);
    const nextValue = toE164(nextCode, nextNumber);
    lastEmittedValue.current = nextValue;
    onChange(nextValue);
    setTouched(true);
  }

  function updateNumber(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, country.max);
    setNationalNumber(digits);
    const nextValue = toE164(country.code, digits);
    lastEmittedValue.current = nextValue;
    onChange(nextValue);
  }

  return <div className="phone-field">
    <Select ariaLabel="Phone country code" value={countryCode} onChange={updateCountry} disabled={disabled} searchPlaceholder="Search countries…" options={PHONE_COUNTRIES.map((item) => ({ value: item.code, label: `${item.name} (${item.dial})`, keywords: `${item.code} ${item.dial}` }))}/>
    <div className="phone-number-wrap"><span aria-hidden="true">{country.dial}</span><input ref={inputRef} type="tel" inputMode="numeric" pattern={`[0-9]{${country.min},${country.max}}`} minLength={country.min} maxLength={country.max} autoComplete={autoComplete} required={required} disabled={disabled} value={nationalNumber} onChange={(event) => updateNumber(event.target.value)} onBlur={() => setTouched(true)} aria-invalid={Boolean(error && touched)} aria-describedby={error && touched ? 'phone-field-error' : undefined} placeholder={`${country.min === country.max ? country.min : `${country.min}–${country.max}`} digit number`}/></div>
    {error && touched && <small id="phone-field-error" className="field-error" role="alert">{error}</small>}
  </div>;
}
