# Real-world client and appointment requirements

This matrix tracks the supplied 32 acceptance scenarios against the rebuild. “Implemented” means a supported flow is present in the current code and the required local schema is applied. “Partial” means some foundation exists but the complete scenario is not covered. No production database or deployment was changed.

## Client identity and booking entry points

| # | Required outcome | Status | Current path / remaining work |
|---|---|---|---|
| 1 | Record a walk-in for a new or existing client, including visit time and charge, without a client login. | Implemented | Practice appointments “Record a visit” flow and `/appointments/manual`; contact details are now optional. `0029` removes the database contact requirement. |
| 2 | Staff can book a future appointment for a client into the shared schedule. | Implemented | Same manual appointment route, with normal availability and database conflict validation. |
| 3 | Find returning offline clients and reuse their existing history. | Implemented | Client directory search and existing-client selection in the visit form. |
| 4 | Create a practice client without email, phone, smartphone, or account. | Implemented | API contract and client table now permit missing contact information; apply `0029` locally. |
| 5 | Separate service recipient from booking actor/contact person for a relative. | Implemented | A dependent is a separate client record with an audited responsible-client relationship. Their appointments, files, and billing remain attached to the recipient; the relationship does not grant portal access. |
| 6 | Keep family members distinct when they share contact details. | Implemented | The relationship links distinct client records; shared contact information does not merge identities or appointments. |
| 7 | Safely connect an offline client record to a later-created portal account. | Partial | Practice owner can link an existing customer account by exact email after confirming identity and consent; duplicate client links are rejected and every link is audited. Ayushman does not yet have customer self-claim or electronic email verification. |
| 8 | Update a client’s name/contact without changing appointment or invoice history. | Implemented | Client directory edit updates practice contact details in place and audits the actor; it explicitly does not change login ownership. |
| 9 | Authorized, reviewed duplicate merge preserving full history. | Implemented | Practice owner reviews target, enters a reason, and merges appointments, files, recordings, invoices, and an unambiguous portal link transactionally. Source history is soft-archived and the operation is audited; merges across two different accounts are rejected. Requires migration `0035`. |
| 10 | Enter a past visit with actual visit time and later entry time, without a future reminder. | Implemented | Explicit “This visit already happened” option saves a past walk-in as completed, preserves the entered visit time separately from `createdAt`, and does not schedule reminders. |

## Changes during the visit

| # | Required outcome | Status | Current path / remaining work |
|---|---|---|---|
| 11 | Permit walk-ins outside public booking rules while showing genuine conflicts. | Implemented | Walk-ins bypass public availability but still pass database overlap checks. A conflict returns a specific retry message, and the form keeps its entered details so staff can change the time or provider. |
| 12 | Keep scheduled time distinct from actual arrival, start, and end. | Implemented | Added nullable actual arrival/start/end fields; check-in, start, completion, and explicit historical walk-in entries persist actual times. Ordinary future walk-ins do not get fabricated actual times. Apply `0029` locally. |
| 13 | Change service at arrival with price/duration delta, conflict check, and audit trail. | Implemented | Appointment detail allows a same-profession service assigned to the same practitioner and branch while checked in or in progress. It preserves the before/after service snapshots and reason in the audit event, blocks schedule overlap, existing invoices, recordings, and price changes below the amount already received. Requires migration `0032`. |
| 14 | Record free, unknown, discounted, unpaid, or paid visit separately from catalogue price. | Partial | Manual visit stores price snapshot (including null/zero) and amount received; separate adjustments and payer identity are absent. |
| 15 | Record an interrupted/aborted visit without marking completed or no-show. | Implemented | A started visit can be marked interrupted with a reason; actual end time and actor are recorded, the customer sees it in past visits, and the owner can correct an accidental interruption with an audited reason. Requires migration `0032`. |
| 16 | Correct erroneous no-show/completed status with a controlled audit trail. | Implemented | The practice owner can restore a no-show or completed visit to an allowed earlier state with a required reason; a dedicated permission and DB transition guard preserve actor/reason audit history. |
| 17 | Keep past visits requiring staff decision; never auto-complete or auto-no-show. | Implemented | Status transitions are staff-driven; no time-based auto-transition was found. |
| 18 | Schedule follow-up for an offline client without a linked Ayushman account. | Implemented | Follow-up now uses the practice client record without requiring `clients.userId`; tell clients without contact details in person. |

## Practice, staff, and catalogue changes

| # | Required outcome | Status | Current path / remaining work |
|---|---|---|---|
| 19 | Identify appointments affected by practitioner sickness and explicitly cancel, move, or reassign. | Implemented | Date-specific availability closure lists impacted bookings and provides an atomic bulk planner. It can retain each practitioner or assign an eligible colleague, requires a reason, rechecks every destination, and preserves the originals if any move fails. |
| 20 | Prevent relevant cross-practice practitioner overlaps without leaking private client data. | Implemented | A database trigger serializes schedule writes by practitioner account and rejects overlaps across practices with a generic conflict response. It checks time buffers and active holds/bookings without returning the other practice or customer details; a partial index supports that conflict lookup. Requires migrations `0033`–`0034`. |
| 21 | On staff/branch/service deactivation, stop new bookings, retain history, and resolve future bookings. | Implemented | Existing appointments remain intact and an appointments-page review queue identifies future bookings whose service, branch, profession, or practitioner assignment changed. Staff can open the booking to reschedule or cancel; nothing is silently removed. |
| 22 | Preserve booked service terms when catalogue/hours change and flag affected future bookings. | Implemented | Appointment snapshots preserve booked terms; the same future-booking impact queue flags inactive or detached service, branch, and professional assignments for review. |
| 23 | Turn off public bookings without hiding existing customer appointments. | Implemented | `publicBookingEnabled` gates public listing/booking routes; customer appointment history is separate. |
| 24 | Allow a non-practitioner owner/admin to set up the practice and invite providers later. | Implemented | Setup now offers “I manage the practice; I’ll invite practitioners first” and routes to Team without assigning the owner as provider. |

## Saving, moving, and payment recovery

| # | Required outcome | Status | Current path / remaining work |
|---|---|---|---|
| 25 | Concurrent bookings accept one valid slot and preserve the other user’s data/alternatives. | Implemented | Database exclusion decides the winner; the losing public booking keeps customer details and returns to time selection with an availability conflict message. The candidate times are reloaded from the server. |
| 26 | Duplicate submit, refresh, or network loss recovers one actual booking result. | Implemented | Public booking, manual visit, and follow-up forms persist their request fingerprint and idempotency key with the draft; the API returns the original persisted response before rechecking a slot already consumed by the successful request. Verified follow-up replay returns the same appointment ID. |
| 27 | Failed reschedule leaves original appointment in place. | Implemented | Availability is rechecked and the replacement update is atomic; the original changes only after successful validation. |
| 28 | Cancellation and check-in races resolve consistently and retain the actor. | Implemented | Status updates use compare-and-set conditions in a transaction; lifecycle events store actor and transition. |
| 29 | Separate attendance from unpaid/partial/paid state and support a different payer. | Partial | Appointment status and amount received are separate; payer identity and payment ledger are absent. |
| 30 | Resolve existing payment explicitly on cancellation/move; never lose or recharge silently. | Missing | No refund/credit/transfer workflow; online payment provider is not configured. |
| 31 | Confirmation delivery failure does not undo booking and can be retried without duplicate booking. | Partial | In-app appointment state and notifications are stored independently of the booking response; no external delivery/outbox retry system exists. |
| 32 | Recover safe form data after session expiry, recheck access/availability, and avoid duplicates. | Implemented | Setup, public booking, manual visit, and follow-up drafts restore from scoped browser storage with a two-hour expiry. Availability and permission are rechecked on the server; unchanged retries reuse the same idempotency key. Walk-in draft restoration and follow-up replay were exercised in the local browser. |

## Verification notes

- Implemented in this pass: dependent/responsible-client relationships; private waitlist management links with offer acceptance, withdrawal, and expiry; staff-created waitlist offers validated against actual availability; and an upcoming-booking impact queue for catalogue, branch, profession, and practitioner assignment changes. This also includes the previously implemented merge/linking, sick-leave booking moves, walk-ins, follow-ups, corrections, and overlap safeguards.
- Migrations `0029`–`0035` cover offline clients, visit timestamps, historical walk-ins, audited corrections, interrupted outcomes, overlap safeguards, and merge provenance. Migrations `0042`–`0043` add dependent relationships and waitlist management/offer state. The new migrations still need to be applied locally before using these features; this pass does not change hosted databases.
- Production migrations remain a separate deployment action and were not run.
- Local verification includes the full monorepo production build, authenticated customer and practitioner browser flows, role-boundary requests, follow-up idempotency replay, manual-visit draft restoration after refresh, client-side tab navigation without document reload, and a generated-audio recording through consent, capture, upload, finalization, sharing, and customer range playback. These are targeted end-to-end checks, not exhaustive property testing or production-load testing.
- Explicitly out of scope per the current request: SMS and payment gateway integrations. They remain untouched.
- Waitlist offers are created by staff, not automatically matched to a newly freed slot. Customers can accept or withdraw from the private link shown when joining; expiry is enforced when the queue/link is read and at acceptance. Email/SMS alerts are not configured, so the customer must keep and revisit the private link or be contacted through the practice’s existing channel.
- Remaining product behavior: customer self-claim or electronic verification of offline records; durable external email delivery retries; and a payer/adjustment/refund ledger. SMS and payment gateways remain out of scope. Hosted database migration state is unchanged and must be handled separately before deployment.
