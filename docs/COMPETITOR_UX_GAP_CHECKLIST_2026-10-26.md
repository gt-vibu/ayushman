# Practice workflow UX audit and gap checklist

**Reviewed:** 2026-10-26  
**Scope:** Workflow behavior and edge cases, not visual design. This is a static review of the `rebuild/` workspace, its API/database/edge-case docs, and targeted code paths. It is not a claim that every workflow has passed end-to-end testing. The root workspace is a separate legacy implementation; verify which deployment is active before treating this as a release sign-off.

**Workspace comparison:** The root workspace has substantially broader workflow modules than `rebuild/`. The root has code surfaces for waitlists, communication retries/templates, cancellations/reschedule requests, recurring bookings, client relationships, refunds/credits/packages, forms/consent, and recording/transcription. The rebuild docs say several of these are absent or incomplete. Do not read a rebuild gap as a gap in the root app, or assume a root feature exists in the deployed rebuild. The code surface indicates implementation exists; each still needs a live flow check against the selected deployment.

## How to read the checklist

- **Present**: there is a documented and code-backed capability in this workspace.
- **Partial**: the main path exists, but recovery, automation, or policy handling is incomplete.
- **Gap**: the capability is explicitly absent from the current API contract or edge-case matrix.
- **Verify**: code indicates a capability, but a complete scenario has not been demonstrated here.

Competitor documentation is evidence of useful product patterns, not proof of a universal standard. The right design is to keep the routine path short, make important state visible, and make risky changes explicit and recoverable.

## Product patterns worth combining

1. **Setup should end in a bookable state.** Guide an owner through practice details, branches, professions, team, service eligibility, schedules, and booking policy. Show a readiness checklist with a direct fix action for each blocker. Pabau uses a setup score/checklist and separately identifies services that are not enabled for online booking. Zoho explicitly diagnoses inactive services, staff, workspace, and missing staff assignment as causes of “no availability.”
2. **One appointment record is the operational source of truth.** Booking, calendar, client history, service snapshot, attendance, notes, invoice, and follow-up should link to the same appointment/client identifiers. Keep attendance progress and payment balance as separate states. Make the next action explicit in an appointment detail view; do not force staff to infer it from unrelated controls.
3. **Let staff act in context.** From a client record, allow “book next visit,” create a note/document, and create an invoice without searching for the client again. From the calendar, book an existing client or quick-add a client. Pabau documents both contextual quick-create and a post-client-creation next-step panel.
4. **Give clients self-service with guardrails.** Show upcoming/past/cancelled visits separately. Cancellation and rescheduling should explain the policy cutoff before the final action, require a clear confirmation, preserve the original booking if a replacement slot cannot be acquired, notify both sides, and offer a waitlist when no slot fits. Pabau documents explicit policy checks and race handling; Jane documents waitlist matching and explains when another client takes the slot; Zoho supports client portals and appointment status actions.
5. **Make availability explainable.** Calculate bookable slots from practice hours, professional hours, branch, service length and buffers, existing bookings, closures/time off, and booking policy. When there are no slots, identify which prerequisite is missing and link to its setup, instead of showing a generic empty state. Zoho documents these availability inputs and troubleshooting checks.
6. **Use roles as defaults, then narrow access.** Give owners/admins setup control, schedulers only the work they need, and practitioners their own visits/records. Combine role defaults with individual overrides and branch scope. Hide actions the person cannot use, but still enforce every check in the API. Make “my clients” versus “all clients” a deliberate scope. Zoho’s role model illustrates this separation; Ayushman already has practice and platform RBAC as separate systems.
7. **Treat communication as part of the transaction.** Booking should persist even if email/SMS fails. Keep delivery status, retries, templates, and recipient rules separate from the appointment transaction. Confirm booking/reschedule/cancellation to the client and notify the assigned provider. Zanda documents event-based notifications to clients, practitioners, and extra staff; Jane documents notification preferences and waitlist messages.
8. **Make clinical documentation and recording a distinct, consent-led flow.** Appointment state, note status, and recording consent are separate. Capture explicit participant consent, stop on withdrawal, keep audio private until practitioner review/share, restrict access to the client and assigned practitioner, and apply retention/deletion consistently. Jane’s documentation shows appointment/charting status as distinct; Ayushman’s recording implementation adds explicit consent and review/share states.
9. **Separate appointment state from money state.** Support unpaid/partial/paid and payment method/reference independently from confirmed/arrived/in-progress/completed/no-show/cancelled. Cancellation or rescheduling of a paid appointment must offer an explicit refund/credit/transfer outcome and record it. Zoho’s appointment summary presents both statuses; Pabau links cancellation/no-show protection to financials.
10. **Provide operational exception queues.** Staff need queues for today’s arrivals, unconfirmed bookings, cancellations needing rebooking, waitlist matches, missing notes, failed notifications, and incomplete payments. Every queue item should say why it is here and what action resolves it.

## Ayushman current-state checklist

| Area / scenario | Status | Evidence and remaining edge cases |
|---|---|---|
| Practice setup: profession-neutral terminology, branches, team, eligible services, schedules, booking policy | **Present / verify** | `docs/API.md` documents setup prerequisites. Confirm the actual production practice has an active branch, profession enabled at that branch, active professional profile, active service assignments, and availability. A saved service alone does not imply bookability. Add a guided readiness checklist and deep links for failed prerequisites. |
| Role-based access, role defaults, individual overrides, branch limits | **Present / verify** | `docs/DATABASE.md` documents owner/admin/professional/scheduler roles, deny-wins overrides, scoped branches, and API authorization. Verify a real test account for each role across pages, API calls, direct URLs, search, exports, and cross-branch identifiers. “Hidden in UI” must never be the only permission check. |
| Public discovery and booking; server recomputation and overlap prevention | **Present** | `docs/API.md` documents directory, public practice profile, availability, booking holds, idempotency, and DB overlap constraint. Confirm the UI handles expired holds, stale availability, retry after lost response, duplicate taps, and another customer winning the slot while retaining entered customer details. |
| Availability setup and time off | **Present / verify** | Rebuild includes recurring rules, exceptions, extra hours, and an affected-bookings move planner. Test timezone boundaries, DST for non-India practices, overnight shifts, breaks, buffers, overlapping rules, day-off vs extra-hours precedence, and existing appointments when staff/location becomes unavailable. |
| Staff walk-in and historical visit entry | **Present / verify** | `docs/edge-case-requirements.md` documents optional client contact, past visit entry, actual arrival/start/end, service/price snapshots, offline-client follow-up, and audited status correction. Verify caller permissions, price zero/unknown/discount, past date/no reminder, and retry safety. |
| Appointment lifecycle: confirmed → arrived → in progress → complete; no-show/cancel | **Present / verify** | API and DB docs describe allowed transitions, compare-and-set, trigger audit, and no automatic state changes. Verify all legal transitions and races, appointment correction authority/reason, interrupted visit handling, and that attending does not imply paid. |
| Follow-ups recognizable as follow-ups | **Present / verify** | Follow-up API/UI paths exist in current code/doc history, but the current edge-case matrix says follow-up scheduling for an offline client exists without explicitly proving visit-type lineage/filter behavior. Verify a rescheduled follow-up retains its classification, appears in customer/practitioner filters, and links to the originating visit without being mistaken for a new initial consultation. |
| Customer portal: history and self-service cancel/reschedule | **Partial in rebuild; present surface in root** | `rebuild/docs/API.md` says customer self-service cancellation is not implemented; the root has scheduling cancellation/reschedule and request-review controllers. Confirm which experience the selected deployment exposes and reconcile policy behavior across direct cancellation versus approval-required requests. |
| Waitlist when a service is full | **Gap in rebuild; present surface in root** | Root `apps/api/src/modules/scheduling/scheduling.controller.ts` exposes waitlist and offers, while rebuild routes/docs do not. Check preference matching, expiry/withdrawal, fair ordering, offer expiry, concurrent claim, and client/provider notification in the actual deployed flow. |
| Cancellation/reschedule notifications and retries | **Partial in rebuild; broader surface in root** | Rebuild documents no external delivery/outbox retry system. Root contains communications controllers for message retry, templates, preferences, reminders, and workflow retries. Verify durable job delivery, idempotency, retry limits, provider failures, bounce/suppression, and the link between notification outcomes and booking records. |
| Client data: offline client, shared contacts, dependent, existing account claim, duplicate merge | **Partial in rebuild; stronger model in root** | Rebuild matrix says offline records exist, but dependent/contact-person is missing, shared-contact handling is partial, and verified claim/reviewed merge are missing. Root has client contacts, relationships/guardians, and organization contacts, but duplicate resolution and multi-contact portal linking still need validation per the root PRD status report. |
| Client quick actions and history continuity | **Present / improve** | Client directory and follow-up/booking paths exist. Consolidate history, appointments, invoices, notes, files, and recordings into a timeline with a contextual next action. Ensure creating a client never implies the client is authenticated and never silently links a login based only on matching email/phone. |
| Service/staff/branch deactivation or edits with future bookings | **Partial** | Edge-case matrix says inactive entities stop new booking and historical foreign keys remain, but no resolution workflow covers future bookings. Before applying change, show affected visits and require explicit cancel/reassign/move decisions; preserve original service terms on existing visits and audit changes. |
| Service change at arrival | **Gap** | No controlled “actual service differs from booked service” operation is documented. Add original vs delivered service, duration/price delta, availability/conflict validation when duration changes, invoice update choice, and actor/reason audit. |
| Payments, partial balances, refunds/credits | **Partial in rebuild; present surface in root** | Rebuild supports invoices and manual receipts, while its edge-case matrix marks payer identity, ledger, refund/credit/transfer incomplete. Root billing exposes payments, refunds, client credits, packages, and webhooks. Verify idempotent provider callbacks, overpayment protection, payer identity, refund reconciliation, and explicit cancellation/reschedule outcomes in the active deployment. |
| Invoices | **Present / verify** | Rebuild billing supports issuer profile, invoice lines, GST-related fields, record receipt, and invoice detail. Verify tax rounding, duplicate invoice creation, numbering under concurrency, edit/void constraints after payment, partial payment, zero-price visit, payer different from client, and reliable PDF/share delivery. |
| Notes, files, consent, recordings | **Present / verify in both, with broader root workflow** | Rebuild recording has consent, chunk upload/retry, review/share states, access checks, and retention. Root has recording, transcript, AI draft, forms, and consent modules. Verify mobile permission denial, browser close/offline, duplicate/reordered chunks, upload timeout/retry, consent withdrawal during capture, practitioner replacement, deletion/retention, human review, and object-storage outage. |
| Booking-form validation and recovery | **Partial / verify** | Shared Zod validation is documented. Test normalized Indian phone numbers, international numbers, optional phone/email for offline visits, malformed/Unicode input, password boundaries, GSTIN/email, whitespace, max lengths, server-side validation, browser back, refresh, session expiry, and preservation of safe fields. |
| Calendar and appointment list | **Present / verify** | Calendar and appointment list routes exist. Add date/month selection, usable day/week/month scope, deterministic sorting and filters, follow-up separation, mobile compact filters, pagination limits, timezone display, empty/loading/error distinction, and keyboard/accessibility checks. |
| Reporting and exception management | **Partial** | API exposes reports/appointment and audit history only in a limited way. Add actionable reports for utilization, cancellations/no-shows, outstanding balances, unclosed visits, documentation completion, unnotified changes, and per-practitioner/branch workload. Scope reports by permissions and branch. |
| Accessibility, mobile/desktop workflow parity | **Partial / verify** | Responsive review exists, but its own follow-up validation lists 320–1024 px widths, multiple browsers, keyboard-only, 200% zoom, screen reader labels, long translations, and slow/offline behavior as unverified. Make these release checks for critical booking and appointment tasks. |
| Performance and perceived speed | **Verify** | Rebuild docs describe Redis caching for directory/availability and no cache for booking validation. Measure p50/p90/p95 for API routes and full tab transitions on cold/warm caches, production-like DB latency, slow network, and concurrent use. Preserve client-side navigation; tab changes should not remount/reload the whole app. Define budgets and alert on regressions. |

## Priority order

**First decision before prioritizing implementation:** select the source workspace and deployment that will be the product’s canonical version. The root has capabilities missing in the rebuild, but also has an older implementation history and its own unverified behavior. Copying the gap list straight into new feature work could duplicate existing features or cause deployment drift. First map each UI route and API endpoint from the live URL to the matching workspace/commit.

### P0 — prevent lost bookings, access leaks, and confusing failures

- [ ] Reconcile the customer cancel/reschedule feature status across code, UI, docs, and deployed backend.
- [ ] Run a permission matrix with real non-owner accounts: hidden controls, direct routes, API read/write, branch isolation, and record ownership.
- [ ] Add deterministic recovery for stale slot / expired hold / duplicate submit / lost response without losing form data.
- [ ] Show staff the exact service/practitioner/branch/availability prerequisite causing a service to be unavailable to customers.
- [ ] Add safe resolution when a practitioner, branch, or service is disabled while future bookings exist.
- [ ] Verify recording consent, storage failure, retries, access control, withdrawal, and retention end to end.

### P1 — complete the dependable practice day

- [ ] Add appointment-linked waitlist and race-safe slot offers.
- [ ] Add notification outbox, retry, delivery state, recipient preferences, and staff/customer templates.
- [ ] Finish payment ledger and explicit refund/credit/transfer handling for cancel/reschedule.
- [ ] Add verified client-record claim, dependent/contact-person model, and audited duplicate merge.
- [ ] Add visit outcome “interrupted” and service-changed-at-arrival with audit/financial impact.
- [ ] Add missing-note, failed-delivery, open-balance, and affected-booking queues.
- [ ] Make follow-up lineage persistent and filterable through reschedule and customer/practitioner views.

### P2 — reduce admin and support effort

- [ ] Add setup readiness checklist and service-bookability diagnostics.
- [ ] Add client-context “book next visit / invoice / document” actions and keep related history together.
- [ ] Add calendar month/day navigation and useful sort/filter controls with mobile filters collapsed by default.
- [ ] Add configurable policy presets per practice/service and preview policy impact before saving.
- [ ] Add operational reports and audit export by authorized scope.
- [ ] Complete responsive, keyboard, assistive technology, zoom, browser, slow/offline and load validation.

## Release acceptance scenarios

- [ ] New owner can register, finish setup, and publish one genuinely bookable service without knowing hidden prerequisites.
- [ ] Customer can discover, book, receive a stable confirmation, and recover from a lost network response without duplicate bookings.
- [ ] Two customers race for the last slot: one wins; the other sees a useful alternative and their entered details remain.
- [ ] Practitioner/admin can book a walk-in for a returning offline client; the visit saves correct date, price/payment, actual timestamps, and appears in the client history.
- [ ] Practitioner marks arrival, starts, completes (or records interrupted/no-show) with payment balance maintained separately.
- [ ] Follow-up is linked to prior visit, visibly labelled, rescheduled, filtered, and retained as follow-up.
- [ ] Practitioner leave/deactivation identifies impacted appointments before save; each affected booking has an explicit resolution.
- [ ] Customer cancellation/reschedule inside and outside policy windows has clear outcomes, confirmation, preserved old booking on failure, audit, and correct financial resolution.
- [ ] Every role can access only its permitted branches, clients, appointments, records, recordings, invoices, and actions—even via direct API calls.
- [ ] Recording starts only after valid consent, survives chunk retry without corruption, stops on withdrawal, stays private until shared, and expires per policy.
- [ ] Invoice creation/payment is duplicate-safe; partial payment and different payer work; void/refund/credit history is traceable.
- [ ] Slow network, API 5xx, DB conflict, expired session, refresh, back/forward, and double-click produce recovery guidance rather than data loss or duplicate records.

## Research sources (official documentation)

- Pabau setup score and booking setup: https://support.pabau.com/en/pabau2/pabau-setup-score
- Pabau online booking practices: https://support.pabau.com/en/pabau2/online-booking-best-practices
- Pabau booking availability and service eligibility: https://support.pabau.com/en/pabau2/en/pabau2/how-to-make-a-service-available-online
- Pabau client quick-create and next steps: https://support.pabau.com/en/pabau2/how-to-create-a-client and https://support.pabau.com/en/pabau2/how-to-use-the-next-steps-window-after-creating-a-client
- Pabau waitlist workflows: https://support.pabau.com/en/pabau2/waitlist-1 and https://support.pabau.com/en/pabau2/how-clients-can-join-the-waitlist-via-online-bookings
- Jane patient portal and cancellation policy: https://jane.app/guide/my-account-your-patient-client-portal and https://jane.app/guide/cancellation-policy
- Jane waitlist and slot-race behavior: https://jane.app/guide/using-the-wait-list and https://jane.app/guide/wait-list-notifications-client-experience
- Jane appointments and chart status: https://jane.app/guide/appointments-reports
- Zanda portal notifications: https://zandahealth.com/support/client-portal/setting-up-and-sending-client-portal-notifications/
- Zanda portal and reminders: https://zandahealth.com/blog/how-to-use-the-zanda-client-portal/
- Zoho roles, permission scope, and profile: https://help.zoho.com/portal/en/kb/bookings-2-0/admin-center/product-customizations/articles/roles-and-permissions-users
- Zoho availability factors: https://help.zoho.com/portal/en/kb/bookings/services/features/articles/service-availability
- Zoho troubleshooting missing availability: https://help.zoho.com/portal/en/kb/bookings/troubleshooting/articles/troubleshooting-booking-page-availability
- Zoho appointment summary/statuses: https://help.zoho.com/portal/en/kb/bookings/view-bookings/articles/bookings-list-view
- Practice Better unified client record: https://help.practicebetter.io/hc/en-us/articles/41912588997275-Working-with-Client-Records-in-Practice-Better
- SimplyBook.me booking management and rescheduling: https://help.simplybook.me/wiki/How_to_manage_bookings and https://help.simplybook.me/wiki/How_to_reschedule_booking

## Audit limitations

This is a code/documentation audit, not a full runtime or production audit. The rebuild docs themselves state that provider integrations (email/SMS and online payments) are not configured, and that some scenarios remain partial/missing. The root workspace is materially different and has a heavily modified working tree; do not infer that rebuilding this workspace fixes or describes the deployed production instance. Before release, identify the active deployment and run the release acceptance scenarios against that exact build and isolated test data.
