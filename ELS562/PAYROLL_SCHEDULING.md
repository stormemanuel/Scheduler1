# Payroll dates, terms, and owner draws

- The Payment terms column selects Net 15 or Net 30 for each person on each event. New rows default to Net 30. The automatic scheduled-by date is the latest labor date for that person plus the selected number of calendar days.
- Editing a person's date makes it a manual override. Changing terms preserves that override. Use the row's **Use Net 15/30 date** button to return to automatic calculation. Existing saved dates are treated as manual overrides for compatibility.
- The event date control is a controlled draft. **Apply to everyone** saves it for every technician and the assigned coordinator, preserving already-paid status. Choosing Scheduled for an individual also uses a newly entered event date. Bulk updates stop on a failed save.
- Date inputs save after editing finishes rather than during partial year entry. Server validation rejects incomplete years and impossible dates. Row payment edits are serialized so a later edit preserves the date/status returned by the preceding save.
- The chosen Payroll year is retained in the URL and browser preferences. Late results from a previous year cannot change the active selection.
- Storm Leigh is identified by exact normalized name and classified as an owner-draw payee. Owner draw allocations, paid amounts, and open amounts appear separately and can be exported. These amounts are excluded from contractor labor expenses and contractor/1099 reports, including coordinator payments to Storm. No bank payment is initiated by these accounting controls.
- **Owner tech work — full revenue passes through to Storm Leigh** allocates the event's full revenue to the unique Storm Leigh technician row. It uses the explicit event revenue override when present, otherwise calculated event revenue. Other crew payouts and expenses stay separate. Disable this option to restore Storm's ordinary payout calculation. Duplicate Storm contacts cannot receive duplicate allocations.
- Contractor Purchase Orders exclude owner draws. Newly prepared contractor POs and reminders use the saved Net 15/30 terms. Changing terms on a locked PO requires a new revision when it is prepared again.
- No new database columns or migration are required. Existing payroll notes persist the scheduling settings while the normal scheduled-for column continues to be written. Existing PO metadata and user notes are preserved. Paid-show snapshots upgrade to version 2 to retain the separate owner-draw totals.

Validation:

```sh
yarn test:payroll-scheduling
yarn test:purchase-order-review
yarn test:updated-schedules
yarn build
```

The current validation uses mocked database/email operations. Live database, browser, and deployment checks remain necessary where credentials are available.
