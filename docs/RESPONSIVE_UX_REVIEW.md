# Responsive UX review

Date: 2026-10-18

## Product patterns reviewed

- Zoho Bookings keeps the mobile appointment view centered on a selected day and opens a focused appointment summary. Its quick-add flow asks for workspace, service, staff, time, and customer in sequence. Mobile access follows role permissions.
- Calendly’s mobile app emphasizes a small set of daily actions: schedule, availability, share a booking link, and view upcoming meetings. More complex team administration stays on desktop where appropriate.
- Square’s booking flow keeps location, service, and staff selection connected, and previews the mobile booking experience before publishing.

Sources: [Zoho mobile appointment view](https://help.zoho.com/portal/en/kb/bookings-2-0/mobile-app/articles/view-appointments-in-mobile), [Zoho quick-add appointment](https://help.zoho.com/portal/en/kb/bookings-2-0/mobile-app/articles/add-appointment-in-mobile), [Calendly mobile app capabilities](https://calendly.com/help/mobile-app-faq), [Square online booking setup](https://squareup.com/help/us/en/article/5355-set-up-online-booking-with-square-appointments).

## Changes in this pass

- Collapse practitioner navigation into a drawer on tablet and mobile; close it on route selection or Escape and prevent background scrolling while it is open.
- Reflow practitioner tables into labeled, touch-friendly cards on narrower screens, including appointments, clients, staff, records, and invoices.
- Constrain shared shell, search, branch selector, forms, dialogs, selects, calendars, pagination, and booking flow content to the viewport.
- Use larger mobile form and action targets, account for safe-area insets, and honor reduced-motion preferences.
- Keep the desktop table layout and booking flow on wider viewports.

## Edge cases considered

- Narrow 320 px devices and the 375 px iPhone SE viewport.
- Tablet widths where a fixed sidebar would leave too little room for tables.
- Very long practice, branch, customer, service, email, and file names.
- Empty, loading, and error table states; variable action counts from RBAC.
- Dialogs in portrait, landscape, and short-height viewports; keyboard Escape dismissal.
- Select/calendar popovers near viewport edges and safe-area padding on notched devices.
- Profession-specific terminology and user-provided notes wrapping without widening the page.
- Reduced-motion preference and touch operation without hover-only actions.

## Follow-up validation still needed

- Manually review 320, 375, 390, 640, 768, 900, 1024, and desktop widths on Chromium, Firefox, and Safari/WebKit. Confirm no document-level horizontal overflow and that every action remains reachable.
- Check 200% zoom, keyboard-only navigation, screen-reader table/card labels, visible focus, and text enlargement.
- Verify browser back/forward navigation and open dialogs after viewport rotation.
- Test long translated strings and right-to-left locales if those locales become supported.
- Test slow/offline network behavior for booking submission, uploads, payment recording, duplicate retries, and stale availability. Those workflow guarantees are backend/product behavior and are not solved by CSS reflow.
- Confirm whether the product needs an installable PWA or native mobile client. Responsive web layouts alone do not provide offline storage or native push behavior.
