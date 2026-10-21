import { Injectable } from '@nestjs/common';
import { getCountries, getStatesByShort, getCities } from 'countrycitystatejson/server';
import type { GeographyOptionsQuery } from '@ayushman-v2/contracts';

type GeoOption = { value: string; label: string };
const countryOptions: GeoOption[] = getCountries()
  .map((country) => ({ value: country.shortName, label: country.name ?? country.shortName }))
  .sort((left, right) => left.label.localeCompare(right.label));
const timezoneNames = new Set(Intl.supportedValuesOf('timeZone'));
// Intl exposes canonical zones and omits some valid IANA links commonly used by existing data.
['Asia/Kolkata', 'Asia/Katmandu', 'Asia/Rangoon', 'Asia/Saigon', 'US/Eastern', 'US/Central', 'US/Mountain', 'US/Pacific']
  .forEach((zone) => timezoneNames.add(zone));
const timezoneOptions: GeoOption[] = [...timezoneNames]
  .map((zone) => ({ value: zone, label: `${offsetLabel(zone)} · ${zone}` }))
  .sort((left, right) => left.value.localeCompare(right.value));
const stateOptions = new Map<string, GeoOption[]>();
const cityOptions = new Map<string, GeoOption[]>();

function offsetLabel(timeZone: string) {
  const offset = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  return offset === 'GMT' ? 'UTC+00:00' : offset.replace(/^GMT/, 'UTC');
}

@Injectable()
export class GeographyService {
  countries(query: GeographyOptionsQuery) {
    return this.page(this.filter(countryOptions, query.q), query.page, query.limit);
  }

  states(query: GeographyOptionsQuery) {
    if (!query.countryCode) return this.page([], query.page, query.limit);
    const countryCode = query.countryCode.toUpperCase();
    const options = stateOptions.get(countryCode) ?? (getStatesByShort(countryCode) ?? [])
      .map((name) => ({ value: name, label: name })).sort((left, right) => left.label.localeCompare(right.label));
    stateOptions.set(countryCode, options);
    return this.page(this.filter(options, query.q), query.page, query.limit);
  }

  cities(query: GeographyOptionsQuery) {
    if (!query.countryCode || !query.state) return this.page([], query.page, query.limit);
    const key = `${query.countryCode.toUpperCase()}:${query.state}`;
    const options = cityOptions.get(key) ?? [...new Set(getCities(query.countryCode.toUpperCase(), query.state) ?? [])]
      .map((name) => ({ value: name, label: name })).sort((left, right) => left.label.localeCompare(right.label));
    if (!cityOptions.has(key) && cityOptions.size >= 100) cityOptions.delete(cityOptions.keys().next().value!);
    cityOptions.set(key, options);
    return this.page(this.filter(options, query.q), query.page, query.limit);
  }

  timezones(query: GeographyOptionsQuery) {
    return this.page(this.filter(timezoneOptions, query.q), query.page, query.limit);
  }

  private filter(options: GeoOption[], query?: string) {
    const term = query?.trim().toLocaleLowerCase('en-US');
    if (!term) return options;
    return options.filter(({ value, label }) => `${label} ${value}`.toLocaleLowerCase('en-US').includes(term))
      .sort((left, right) => Number(!left.label.toLocaleLowerCase('en-US').startsWith(term)) - Number(!right.label.toLocaleLowerCase('en-US').startsWith(term)) || left.label.localeCompare(right.label));
  }

  private page<T>(items: T[], page: number, limit: number) {
    const start = (page - 1) * limit;
    return { items: items.slice(start, start + limit), page, pageSize: limit, total: items.length, hasMore: start + limit < items.length };
  }
}
