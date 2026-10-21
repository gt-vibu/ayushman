'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, FileText, Plus, Printer, Receipt, WalletCards } from 'lucide-react';
import { api, practicePath } from '@/lib/api';
import { usePractice } from '@/lib/practice-context';
import { useApiData } from '@/lib/use-api-data';
import type { Client } from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, StatusBadge } from '@/components/app-shell';
import { PhoneField } from '@/components/ui/phone-field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { DatePicker } from '@/components/ui/date-picker';
import { Select } from '@/components/ui/select';

type BillingProfile = { legalName: string | null; gstin: string | null; email: string | null; phone: string | null; invoicePrefix: string; address: { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; countryCode?: string } | null };
type Invoice = { id: string; invoiceNumber: string; kind: string; status: string; currency: string; issueDate: string; dueDate: string | null; subtotalMinor: number; taxMinor: number; totalMinor: number; amountPaidMinor: number; clientId: string; clientName: string };
type InvoiceDetail = Invoice & { discountMinor: number; taxMode: string; centralTaxMinor: number; stateTaxMinor: number; integratedTaxMinor: number; placeOfSupply: string | null; sacCode: string | null; notes: string | null; clientEmail: string | null; supplierSnapshot: Record<string, string | null>; recipientSnapshot: Record<string, string | null>; payments: { id: string; amountMinor: number; method: string; reference: string | null; receivedAt: string }[]; lines: { id: string; description: string; sacCode: string | null; quantityMilli: number; unitPriceMinor: number; lineTotalMinor: number; taxRateBps: number; taxMinor: number }[] };
type AppointmentOption = { id: string; clientId: string; clientName: string; clientEmail: string | null; startsAt: string; timezone: string; status: string; locationId: string; locationName: string; serviceName: string; priceMinor: number | null; currency: string };

function dateInTimezone(timezone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export default function BillingPage() {
  const { practice, branches, permissions, branchId } = usePractice();
  const root = practicePath(practice.id, '/billing');
  const { data: profile, loading: profileLoading, reload: reloadProfile } = useApiData<BillingProfile | null>(`${root}/profile`);
  const { data: invoiceData, loading, error, reload } = useApiData<Invoice[]>(`${root}/invoices`);
  const invoices = invoiceData ?? [];
  const { data: clientData } = useApiData<Client[]>(practicePath(practice.id, '/clients?limit=100'));
  const clients = clientData ?? [];
  const [legalName, setLegalName] = useState(''); const [gstin, setGstin] = useState(''); const [prefix, setPrefix] = useState('');
  const [issuerEmail, setIssuerEmail] = useState(''); const [issuerPhone, setIssuerPhone] = useState('');
  const [useSharedAddress, setUseSharedAddress] = useState(false);
  const [line1, setLine1] = useState(''); const [line2, setLine2] = useState(''); const [city, setCity] = useState(''); const [state, setState] = useState(''); const [postalCode, setPostalCode] = useState(''); const [country, setCountry] = useState('IN');
  const [clientId, setClientId] = useState(''); const [locationId, setLocationId] = useState(branchId); const [appointmentId, setAppointmentId] = useState(''); const [appointmentOptions, setAppointmentOptions] = useState<AppointmentOption[]>([]); const [kind, setKind] = useState('receipt');
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentClientFilter, setAppointmentClientFilter] = useState('');
  const [appointmentOptionsLoading, setAppointmentOptionsLoading] = useState(true); const [appointmentOptionsError, setAppointmentOptionsError] = useState('');
  const [description, setDescription] = useState(''); const [price, setPrice] = useState(''); const [dueDate, setDueDate] = useState(''); const [taxMode, setTaxMode] = useState('none'); const [taxPercent, setTaxPercent] = useState('0');
  const [sacCode, setSacCode] = useState(''); const [recipientGstin, setRecipientGstin] = useState(''); const [placeOfSupply, setPlaceOfSupply] = useState(''); const [notes, setNotes] = useState('');
  const [notice, setNotice] = useState(''); const [formError, setFormError] = useState(''); const [busy, setBusy] = useState(false); const [selected, setSelected] = useState<Invoice | null>(null);
  const [invalidField, setInvalidField] = useState('');
  const [details, setDetails] = useState<InvoiceDetail | null>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null); const [paymentAmount, setPaymentAmount] = useState(''); const [paymentMethod, setPaymentMethod] = useState('upi'); const [paymentReference, setPaymentReference] = useState('');
  const profileDefaultsApplied = useRef(false);

  useEffect(() => {
    if (!locationId && branchId) setLocationId(branchId);
  }, [branchId, locationId]);

  useEffect(() => {
    if (profileLoading || profileDefaultsApplied.current) return;
    profileDefaultsApplied.current = true;
    setLegalName(profile?.legalName ?? practice.name);
    setGstin(profile?.gstin ?? ''); setPrefix(profile?.invoicePrefix || 'INV');
    setIssuerEmail(profile?.email ?? ''); setIssuerPhone(profile?.phone ?? practice.phone ?? '');
    setUseSharedAddress(Boolean(profile?.address));
    setLine1(profile?.address?.line1 ?? ''); setLine2(profile?.address?.line2 ?? ''); setCity(profile?.address?.city ?? ''); setState(profile?.address?.state ?? '');
    setPostalCode(profile?.address?.postalCode ?? ''); setCountry(profile?.address?.countryCode ?? 'IN');
  }, [profileLoading, profile, practice.name, practice.phone, branches, locationId]);

  useEffect(() => {
    let active = true;
    setAppointmentOptions([]); setAppointmentOptionsLoading(true); setAppointmentOptionsError('');
    const dateFilter = appointmentDate ? `date=${encodeURIComponent(appointmentDate)}&` : '';
    const clientFilter = appointmentClientFilter ? `&clientId=${encodeURIComponent(appointmentClientFilter)}` : '';
    api<AppointmentOption[]>(`${root}/appointments?${dateFilter}limit=200${clientFilter}`)
      .then((options) => { if (active) setAppointmentOptions(options); })
      .catch((cause) => { if (active) { setAppointmentOptions([]); setAppointmentOptionsError(cause instanceof Error ? cause.message : 'Could not load sessions.'); } })
      .finally(() => { if (active) setAppointmentOptionsLoading(false); });
    return () => { active = false; };
  }, [appointmentDate, appointmentClientFilter, root]);

  function selectAppointment(id: string) {
    setAppointmentId(id);
    const appointment = appointmentOptions.find((item) => item.id === id);
    if (!appointment) {
      setLocationId(branchId); setDescription(''); setPrice('');
      return;
    }
    setClientId(appointment.clientId);
    setAppointmentClientFilter(appointment.clientId);
    setLocationId(appointment.locationId);
    setDescription(appointment.serviceName);
    setPrice(appointment.priceMinor === null ? '' : (appointment.priceMinor / 100).toFixed(2));
  }

  function selectBranch(id: string) {
    setLocationId(id);
    const branch = branches.find((item) => item.id === id);
    if (useSharedAddress && !profile?.address && branch?.address) {
      setLine1(branch.address.line1 ?? ''); setLine2(branch.address.line2 ?? ''); setCity(branch.address.city ?? '');
      setState(branch.address.state ?? ''); setPostalCode(branch.address.postalCode ?? ''); setCountry(branch.address.countryCode ?? 'IN');
    }
  }

  function toggleSharedAddress(enabled: boolean) {
    setUseSharedAddress(enabled);
    const address = branches.find((branch) => branch.id === locationId)?.address;
    if (enabled && !profile?.address && address) {
      setLine1(address.line1 ?? ''); setLine2(address.line2 ?? ''); setCity(address.city ?? '');
      setState(address.state ?? ''); setPostalCode(address.postalCode ?? ''); setCountry(address.countryCode ?? 'IN');
    }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setNotice(''); setFormError(''); try { await api(`${root}/profile`, { method: 'PATCH', body: JSON.stringify({ legalName, gstin: gstin || null, email: issuerEmail || null, phone: issuerPhone || null, invoicePrefix: prefix, address: useSharedAddress ? { line1, ...(line2 ? { line2 } : {}), city, ...(state ? { state } : {}), ...(postalCode ? { postalCode } : {}), countryCode: country || 'IN' } : null }) }); setNotice('Billing details saved.'); await reloadProfile(); } catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Could not save billing details.'); } finally { setBusy(false); } }
  async function createInvoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice(''); setFormError('');
    const form = event.currentTarget;
    const firstInvalid = Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')).find((field) => !field.checkValidity());
    if (firstInvalid) {
      setInvalidField(firstInvalid.name);
      firstInvalid.setAttribute('aria-invalid', 'true'); firstInvalid.classList.add('field-invalid');
      const label = firstInvalid.closest('label')?.childNodes[0]?.textContent?.trim() || 'This field';
      setFormError(`${label}: ${firstInvalid.validationMessage}`); firstInvalid.focus(); firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
    }
    if (!selectedAppointment && !clientId) { setInvalidField('clientId'); setFormError('Customer: choose a customer or link an appointment.'); return; }
    if (!description.trim()) { setInvalidField('description'); setFormError('Item / service description: enter a description.'); return; }
    if (!Number.isFinite(Number(price)) || Number(price) <= 0) { setInvalidField('price'); setFormError('Amount: enter an amount greater than zero.'); return; }
    if (taxMode !== 'none' && (!Number.isFinite(Number(taxPercent)) || Number(taxPercent) <= 0 || Number(taxPercent) > 28)) { setInvalidField('taxPercent'); setFormError('Tax rate: enter a rate greater than zero and no more than 28%.'); return; }
    setBusy(true);
    const amountMinor = Math.round(Number(price) * 100);
    try {
      await api(`${root}/invoices`, { method: 'POST', body: JSON.stringify({ clientId, appointmentId: appointmentId || undefined, locationId: locationId || undefined, kind, issueDate: today, dueDate: dueDate || undefined, taxMode, taxRateBps: taxMode === 'none' ? 0 : Math.round(Number(taxPercent) * 100), discountMinor: 0, sacCode: sacCode || undefined, recipientGstin: recipientGstin || undefined, placeOfSupply: placeOfSupply || undefined, notes: notes || undefined, lines: [{ description, sacCode: sacCode || undefined, quantityMilli: 1000, unitPriceMinor: amountMinor }] }) });
      setDescription(''); setPrice(''); setDueDate(''); setAppointmentId(''); setNotice('Invoice issued and numbered.');
      const dateFilter = appointmentDate ? `date=${encodeURIComponent(appointmentDate)}&` : '';
      await Promise.all([reload(), api<AppointmentOption[]>(`${root}/appointments?${dateFilter}limit=200${appointmentClientFilter ? `&clientId=${encodeURIComponent(appointmentClientFilter)}` : ''}`).then(setAppointmentOptions)]);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not issue invoice.';
      if (message.toLowerCase().includes('address')) setInvalidField('locationId');
      else if (message.toLowerCase().includes('gstin')) setInvalidField(message.toLowerCase().includes('charging gst') ? 'gstin' : 'recipientGstin');
      else if (message.toLowerCase().includes('appointment') || message.toLowerCase().includes('session')) setInvalidField('appointmentId');
      setFormError(message);
    } finally { setBusy(false); }
  }
  function pay(invoice: Invoice) { setPaymentInvoice(invoice); setPaymentAmount(((invoice.totalMinor - invoice.amountPaidMinor) / 100).toFixed(2)); setPaymentMethod('upi'); setPaymentReference(''); setFormError(''); }
  async function recordPayment(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (!paymentInvoice) return; const amountMinor = Math.round(Number(paymentAmount) * 100); if (!Number.isFinite(amountMinor) || amountMinor <= 0) { setFormError('Enter a valid positive payment amount.'); return; } setBusy(true); setFormError(''); try { await api(`${root}/invoices/${paymentInvoice.id}/payments`, { method: 'POST', body: JSON.stringify({ amountMinor, method: paymentMethod, reference: paymentReference || undefined }) }); setNotice('Payment recorded.'); setPaymentInvoice(null); await reload(); if (selected?.id === paymentInvoice.id) setDetails(await api<InvoiceDetail>(`${root}/invoices/${paymentInvoice.id}`)); } catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Could not record payment.'); } finally { setBusy(false); } }
  async function openInvoice(invoice: Invoice) { setSelected(invoice); setDetails(null); try { setDetails(await api<InvoiceDetail>(`${root}/invoices/${invoice.id}`)); } catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Could not load invoice details.'); } }
  const currency = practice.currency || 'INR';
  const today = dateInTimezone(practice.timezone);
  const selectedAppointment = appointmentOptions.find((item) => item.id === appointmentId);
  function money(minor: number, code = currency) { return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(minor / 100); }
  function addressText(value: string | null | undefined) { if (!value) return ''; try { const parsed = JSON.parse(value) as Record<string, string>; return [parsed.line1, parsed.line2, parsed.city, parsed.state, parsed.postalCode, parsed.countryCode].filter(Boolean).join(', '); } catch { return value; } }
  function documentTitle(invoice: Invoice) {
    if (invoice.kind === 'tax_invoice') return 'TAX INVOICE';
    if (invoice.kind === 'bill_of_supply') return 'BILL OF SUPPLY';
    return invoice.status === 'paid' && invoice.amountPaidMinor > 0 ? 'PAYMENT RECEIPT' : 'INVOICE';
  }
  function paymentStatus(status: string) {
    if (status === 'paid') return 'Paid';
    if (status === 'partially_paid') return 'Partially paid';
    if (status === 'void') return 'Voided';
    return 'Unpaid';
  }
  function emailInvoice(invoice: InvoiceDetail) {
    if (!invoice.clientEmail) return;
    const subject = encodeURIComponent(`Invoice ${invoice.invoiceNumber} from ${invoice.supplierSnapshot.name || practice.name}`);
    const body = encodeURIComponent(`Hello ${invoice.recipientSnapshot.name || invoice.clientName},\n\nPlease find invoice ${invoice.invoiceNumber} for ${money(invoice.totalMinor, invoice.currency)}. The outstanding balance is ${money(invoice.totalMinor - invoice.amountPaidMinor, invoice.currency)}.\n\nPlease attach the downloaded invoice PDF before sending.\n\n${invoice.supplierSnapshot.name || practice.name}`);
    window.location.href = `mailto:${encodeURIComponent(invoice.clientEmail)}?subject=${subject}&body=${body}`;
  }

  return <><PageHeader eyebrow="FINANCIAL OPERATIONS" title="Invoices & payments" description="Issue numbered invoices, track payments, and keep a clear record for each customer." action={permissions['billing.manage'] ? <a className="button button-primary" href="#new-invoice"><Plus size={15}/> Create invoice</a> : undefined}/>
    {permissions['billing.manage'] && <section className="section-card resource-card billing-setup"><div className="section-heading"><div><p className="eyebrow">INVOICE ISSUER</p><h2>Business details</h2></div><span className="count-pill">Used on new invoices</span></div><form className="billing-profile-form" onSubmit={(event) => void saveProfile(event)}>
      <p className="field-hint invoice-wide">The practice name is filled in as the issuer by default. Edit it if your legal business name differs. Each invoice uses the selected branch address unless you choose one shared legal address below.</p>
      <label>Legal business name<input required minLength={2} maxLength={180} value={legalName} onChange={(event) => setLegalName(event.target.value)}/></label><label>GSTIN (if applicable)<input className={invalidField === 'gstin' ? 'field-invalid' : ''} value={gstin} onChange={(event) => setGstin(event.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15))} maxLength={15} pattern="[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]" title="Enter a valid 15-character GSTIN or leave blank"/>{invalidField === 'gstin' && <small className="inline-field-error">Save the issuer GSTIN before issuing a tax invoice.</small>}</label><label>Invoice prefix<input required pattern="[A-Z0-9-]{1,12}" value={prefix} onChange={(event) => setPrefix(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12))} maxLength={12}/></label>
      <label>Business email<input type="email" maxLength={320} value={issuerEmail} onChange={(event) => setIssuerEmail(event.target.value)}/></label><label>Business phone<PhoneField value={issuerPhone} onChange={setIssuerPhone}/></label>
      <label className="check-row invoice-wide"><input type="checkbox" checked={useSharedAddress} onChange={(event) => toggleSharedAddress(event.target.checked)}/> Use one shared legal billing address for every branch</label>
      {useSharedAddress ? <><label>Business address<input required minLength={3} maxLength={160} value={line1} onChange={(event) => setLine1(event.target.value)} placeholder="Address line"/></label><label>Address line 2<input maxLength={160} value={line2} onChange={(event) => setLine2(event.target.value)}/></label><label>City<input required minLength={1} maxLength={100} value={city} onChange={(event) => setCity(event.target.value)}/></label><label>State / region<input maxLength={100} value={state} onChange={(event) => setState(event.target.value)}/></label><label>Postal code<input pattern="[A-Za-z0-9][A-Za-z0-9 -]{0,19}" title="Use letters, numbers, spaces, or hyphens" value={postalCode} onChange={(event) => setPostalCode(event.target.value)}/></label><label>Country<SearchableSelect endpoint="/geography/countries" value={country} valueLabel={new Intl.DisplayNames(['en'], { type: 'region' }).of(country) ?? country} onChange={setCountry} searchPlaceholder="Search countries…"/></label></> : <p className="field-hint invoice-wide">Each invoice uses the address of its selected branch. Update addresses in Locations to change them.</p>}<button className="button button-secondary" disabled={busy}>Save business details</button>
    </form><p className="field-hint">Tax is not assumed automatically. Confirm your tax treatment, service classification and applicable statutory requirements with your accountant before issuing tax invoices.</p></section>}
    {permissions['billing.manage'] && <section id="new-invoice" className="section-card resource-card invoice-create"><div className="section-heading"><div><p className="eyebrow">NEW DOCUMENT</p><h2><Receipt size={18}/> Create an invoice or receipt</h2></div></div><form className="invoice-form" noValidate onInputCapture={(event) => { const field = event.target; if (field instanceof HTMLElement) { field.classList.remove('field-invalid'); field.removeAttribute('aria-invalid'); } setFormError(''); setInvalidField(''); }} onSubmit={(event) => void createInvoice(event)}>
      <label>Filter sessions by date <span className="optional">Optional</span><DatePicker value={appointmentDate} onChange={(value) => { setAppointmentDate(value); setAppointmentId(''); setLocationId(branchId); setDescription(''); setPrice(''); }} ariaLabel="Filter sessions by date" placeholder="Any session date"/></label>
      <label>Customer<Select value={clientId} invalid={invalidField === 'clientId'} disabled={Boolean(appointmentId)} ariaLabel="Invoice customer" options={[{ value: '', label: 'Select customer' }, ...clients.map((item) => ({ value: item.id, label: `${item.fullName}${item.email ? ` · ${item.email}` : ''}`, keywords: item.email ?? '' }))]} onChange={(value) => { setClientId(value); setAppointmentClientFilter(value); setAppointmentId(''); setLocationId(branchId); setDescription(''); setPrice(''); setInvalidField(''); }}/>{invalidField === 'clientId' && <small className="inline-field-error">Choose a customer or link an appointment.</small>}</label>
      <label className="invoice-wide">Appointment / session<Select value={appointmentId} invalid={invalidField === 'appointmentId'} ariaLabel="Appointment or session" searchPlaceholder="Search sessions by customer or service…" options={[{ value: '', label: appointmentOptionsLoading ? 'Loading sessions…' : 'No linked session — manual invoice' }, ...appointmentOptions.map((item) => ({ value: item.id, label: `${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: item.timezone }).format(new Date(item.startsAt))} · ${item.clientName} · ${item.serviceName} · ${item.locationName} · ${item.status.replaceAll('_', ' ')}`, keywords: `${item.clientName} ${item.serviceName} ${item.locationName} ${item.status}` }))]} onChange={(value) => { setInvalidField(''); selectAppointment(value); }}/><small className="field-hint">{appointmentOptionsLoading ? 'Loading available sessions…' : appointmentDate ? `Sessions on ${appointmentDate}` : `${appointmentOptions.length} uninvoiced sessions for the selected customer`} are shown in each session’s local time. Choosing one attaches its exact customer and branch.</small>{appointmentOptionsError && <small className="inline-field-error">Could not load sessions: {appointmentOptionsError}</small>}{!appointmentOptionsLoading && !appointmentOptionsError && appointmentOptions.length === 0 && <small className="field-hint">No uninvoiced sessions match. Clear the date filter or choose a different customer.</small>}{invalidField === 'appointmentId' && <small className="inline-field-error">This session could not be invoiced. Select another session.</small>}</label>
      {selectedAppointment && <div className="invoice-wide invoice-summary"><strong>Customer:</strong> {selectedAppointment.clientName}{selectedAppointment.clientEmail ? ` · ${selectedAppointment.clientEmail}` : ''}<br/><strong>Branch:</strong> {selectedAppointment.locationName} · <strong>Session:</strong> {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: selectedAppointment.timezone }).format(new Date(selectedAppointment.startsAt))}</div>}
      <label>Issued from branch<Select value={locationId} invalid={invalidField === 'locationId'} disabled={Boolean(selectedAppointment)} ariaLabel="Issued from branch" options={[{ value: '', label: 'Practice address' }, ...branches.map((item) => ({ value: item.id, label: item.name }))]} onChange={(value) => { setInvalidField(''); selectBranch(value); }}/><small className="field-hint">Issuer address: {useSharedAddress ? 'shared legal billing address' : 'selected branch address'}.</small>{invalidField === 'locationId' && <small className="inline-field-error">Add a complete address for this branch in Locations, or select another branch.</small>}</label>
      <label>Document type<Select value={kind} ariaLabel="Document type" options={[{ value: 'receipt', label: 'Invoice (standard)' }, { value: 'bill_of_supply', label: 'Bill of supply' }, { value: 'tax_invoice', label: 'Tax invoice' }]} onChange={(value) => { setKind(value); if (value !== 'tax_invoice') setTaxMode('none'); }}/></label><label>Due date (optional)<DatePicker value={dueDate} min={today} onChange={setDueDate} ariaLabel="Invoice due date" placeholder="Choose due date"/></label>
      <label className="invoice-wide">Item / service description<input name="description" className={invalidField === 'description' ? 'field-invalid' : ''} required value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the service or goods"/>{invalidField === 'description' && <small className="inline-field-error">Enter a description for this invoice line.</small>}</label><label>Amount ({currency})<input name="price" className={invalidField === 'price' ? 'field-invalid' : ''} type="number" min="0.01" step="0.01" required value={price} onChange={(event) => setPrice(event.target.value)}/>{invalidField === 'price' && <small className="inline-field-error">Enter an amount greater than zero.</small>}</label>
      <label>SAC / service code<input pattern="[0-9A-Z-]{4,12}" title="Use 4–12 letters, numbers, or hyphens" value={sacCode} onChange={(event) => setSacCode(event.target.value.toUpperCase().replace(/[^0-9A-Z-]/g, '').slice(0, 12))} maxLength={12} placeholder="Optional classification code"/></label><label>Customer GSTIN (if applicable)<input name="recipientGstin" className={invalidField === 'recipientGstin' ? 'field-invalid' : ''} value={recipientGstin} onChange={(event) => setRecipientGstin(event.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15))} maxLength={15} pattern="[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]" title="Enter a valid 15-character GSTIN or leave blank"/>{invalidField === 'recipientGstin' && <small className="inline-field-error">Enter a valid GSTIN or leave this blank.</small>}</label><label>Place of supply<input maxLength={120} value={placeOfSupply} onChange={(event) => setPlaceOfSupply(event.target.value)} placeholder="State or jurisdiction"/></label><label className="invoice-wide">Notes / payment terms<textarea rows={2} maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional note shown on the invoice"/></label>
      {kind === 'tax_invoice' && <><label>Tax treatment<Select value={taxMode} ariaLabel="Tax treatment" options={[{ value: 'none', label: 'No tax' }, { value: 'cgst_sgst', label: 'CGST + SGST' }, { value: 'igst', label: 'IGST' }]} onChange={setTaxMode}/></label>{taxMode !== 'none' && <label>Tax rate (%)<input name="taxPercent" className={invalidField === 'taxPercent' ? 'field-invalid' : ''} type="number" min="0.01" max="28" step="0.01" required value={taxPercent} onChange={(event) => setTaxPercent(event.target.value)}/>{invalidField === 'taxPercent' && <small className="inline-field-error">Enter a tax rate from 0.01% to 28%.</small>}</label>}</>}
      <div className="invoice-wide invoice-summary">Invoice date: {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(`${today}T12:00:00`))} · Number assigned automatically by financial year.</div>
      {formError && <p className="form-error invoice-wide" role="alert">{formError}</p>}{notice && <p className="save-success invoice-wide"><Check size={14}/>{notice}</p>}<button className="button button-primary" disabled={busy}><Receipt size={15}/>{busy ? 'Saving…' : 'Issue invoice'}</button>
    </form></section>}
    <section className="section-card resource-card invoice-list"><div className="section-heading"><div><p className="eyebrow">ACCOUNTS RECEIVABLE</p><h2>Issued invoices</h2></div><span className="count-pill">{invoices.length} documents</span></div>
      {loading ? <div className="loading-state">Loading invoices…</div> : error ? <ErrorState message={error}/> : invoices.length ? <div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Status</th><th>Total</th><th>Outstanding</th><th>Actions</th></tr></thead><tbody>{invoices.map((item) => <tr key={item.id}><td data-label="Invoice"><button className="table-detail-button" onClick={() => void openInvoice(item)}><strong>{item.invoiceNumber}</strong><small>{documentTitle(item)}</small></button></td><td data-label="Customer">{item.clientName}</td><td data-label="Date">{item.issueDate}</td><td data-label="Status"><StatusBadge status={item.status}/></td><td data-label="Total"><strong>{money(item.totalMinor, item.currency)}</strong></td><td data-label="Outstanding">{money(item.totalMinor - item.amountPaidMinor, item.currency)}</td><td data-label="Actions"><div className="inline-actions"><button className="button button-secondary compact-button" onClick={() => void openInvoice(item)}><FileText size={13}/> View</button>{permissions['billing.manage'] && item.status !== 'paid' && item.status !== 'void' && <button className="button button-secondary compact-button" onClick={() => pay(item)}><WalletCards size={13}/> Payment</button>}</div></td></tr>)}</tbody></table></div> : <EmptyState title="No invoices issued" description="Create an invoice for a customer. Each gets a unique, practice-specific financial-year number." icon={WalletCards}/>}</section>
    {paymentInvoice && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaymentInvoice(null); }}><section className="dialog-panel"><div className="dialog-heading"><div><p className="eyebrow">RECORD RECEIPT</p><h2>{paymentInvoice.invoiceNumber}</h2><p>Outstanding: {money(paymentInvoice.totalMinor - paymentInvoice.amountPaidMinor, paymentInvoice.currency)}</p></div><button className="icon-button" aria-label="Close" onClick={() => setPaymentInvoice(null)}>×</button></div><form className="dialog-form" onSubmit={(event) => void recordPayment(event)}><label>Amount received ({paymentInvoice.currency})<input type="number" min="0.01" step="0.01" max={(paymentInvoice.totalMinor - paymentInvoice.amountPaidMinor) / 100} required value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)}/></label><label>Payment method<Select value={paymentMethod} ariaLabel="Payment method" options={[{ value: 'cash', label: 'Cash' }, { value: 'card', label: 'Card' }, { value: 'bank_transfer', label: 'Bank transfer' }, { value: 'upi', label: 'UPI' }, { value: 'insurance', label: 'Insurance' }, { value: 'other', label: 'Other' }]} onChange={setPaymentMethod}/></label><label>Reference (optional)<input maxLength={120} value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Transaction or receipt reference"/></label>{formError && <p className="form-error">{formError}</p>}<div className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => setPaymentInvoice(null)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</button></div></form></section></div>}
    {selected && <div className="dialog-backdrop invoice-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setSelected(null); setDetails(null); } }}><article className="dialog-panel invoice-preview">
      <div className="invoice-toolbar"><div><p className="eyebrow">DOCUMENT PREVIEW</p><h2>{selected.invoiceNumber}</h2></div><div className="inline-actions"><button className="button button-secondary" disabled={!details} onClick={() => window.print()}><Printer size={14}/> Download PDF</button>{details?.clientEmail && <button className="button button-secondary" onClick={() => emailInvoice(details)}><FileText size={14}/> Email invoice</button>}{permissions['billing.manage'] && details?.status !== 'paid' && details?.status !== 'void' && <button className="button button-primary" onClick={() => pay(selected)}><WalletCards size={14}/> Record payment</button>}<button className="icon-button" aria-label="Close preview" onClick={() => { setSelected(null); setDetails(null); }}>×</button></div></div>
      {!details ? <div className="loading-state">Loading invoice details…</div> : <div className="invoice-paper">
        <header className="invoice-document-header"><div><p className="invoice-kicker">{documentTitle(details)}</p><h2>{details.supplierSnapshot.name || practice.name}</h2>{details.supplierSnapshot.location && <p>{details.supplierSnapshot.location}</p>}<p>{addressText(details.supplierSnapshot.address) || 'Business address'}</p><div className="invoice-contact">{details.supplierSnapshot.gstin && <span>GSTIN: {details.supplierSnapshot.gstin}</span>}{details.supplierSnapshot.email && <span>{details.supplierSnapshot.email}</span>}{details.supplierSnapshot.phone && <span>{details.supplierSnapshot.phone}</span>}</div></div><div className="invoice-document-meta"><span className={`invoice-payment-status status-${details.status}`}>{paymentStatus(details.status)}</span><strong>{details.invoiceNumber}</strong><span>Issue date · {details.issueDate}</span>{details.dueDate && <span>Due date · {details.dueDate}</span>}</div></header>
        <hr/><section className="invoice-bill-to"><strong>Bill to</strong><div><strong>{details.recipientSnapshot.name || selected.clientName}</strong><span>{addressText(details.recipientSnapshot.address)}</span>{(details.recipientSnapshot.email || details.clientEmail) && <span>{details.recipientSnapshot.email || details.clientEmail}</span>}{details.recipientSnapshot.phone && <span>{details.recipientSnapshot.phone}</span>}{details.recipientSnapshot.gstin && <span>GSTIN: {details.recipientSnapshot.gstin}</span>}</div></section>
        <div className="table-wrap"><table><thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Tax</th><th className="text-right">Amount</th></tr></thead><tbody>{details.lines.map((line) => <tr key={line.id}><td>{line.description}{line.sacCode && <small className="table-subtext">SAC: {line.sacCode}</small>}</td><td>{line.quantityMilli % 1000 === 0 ? String(line.quantityMilli / 1000) : String(line.quantityMilli / 1000).replace(/0+$/, '').replace(/\.$/, '')}</td><td>{money(line.unitPriceMinor, details.currency)}</td><td>{money(line.taxMinor, details.currency)}</td><td className="text-right">{money(line.lineTotalMinor + line.taxMinor, details.currency)}</td></tr>)}</tbody></table></div>
        <div className="invoice-total"><span>Subtotal</span><strong>{money(details.subtotalMinor, details.currency)}</strong>{details.discountMinor > 0 && <><span>Discount</span><strong>−{money(details.discountMinor, details.currency)}</strong></>}{details.taxMode === 'cgst_sgst' ? <><span>CGST</span><strong>{money(details.centralTaxMinor, details.currency)}</strong><span>SGST</span><strong>{money(details.stateTaxMinor, details.currency)}</strong></> : details.taxMode === 'igst' ? <><span>IGST</span><strong>{money(details.integratedTaxMinor, details.currency)}</strong></> : <><span>Tax</span><strong>{money(details.taxMinor, details.currency)}</strong></>}<span className="invoice-grand-total">Total</span><strong className="invoice-grand-total">{money(details.totalMinor, details.currency)}</strong><span>Amount paid</span><strong>{money(details.amountPaidMinor, details.currency)}</strong><span className="invoice-balance">Balance due</span><strong className="invoice-balance">{money(details.totalMinor - details.amountPaidMinor, details.currency)}</strong></div>
        {details.payments.length > 0 && <section className="invoice-payment-history"><h3>Payment history</h3><div className="table-wrap"><table><thead><tr><th>Date received</th><th>Method</th><th>Reference</th><th className="text-right">Amount</th></tr></thead><tbody>{details.payments.map((payment) => <tr key={payment.id}><td>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: practice.timezone }).format(new Date(payment.receivedAt))}</td><td>{payment.method.replaceAll('_', ' ')}</td><td>{payment.reference || '—'}</td><td className="text-right">{money(payment.amountMinor, details.currency)}</td></tr>)}</tbody></table></div></section>}
        {(details.placeOfSupply || details.notes) && <div className="invoice-notes">{details.placeOfSupply && <p><strong>Place of supply:</strong> {details.placeOfSupply}</p>}{details.notes && <p>{details.notes}</p>}</div>}<p className="invoice-legal-note">This document reflects the information entered by the issuer. Verify statutory requirements applicable to your business and transaction.</p>
      </div>}
    </article></div>}
  </>;
}
