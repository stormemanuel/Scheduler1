# Combined coordinator Purchase Orders

## Enable once

Run the complete contents of `supabase/coordinator_purchase_orders.sql` in the existing project's Supabase SQL editor. It creates two new tables and an atomic creation function. It does not rewrite existing payroll records. The migration is repeatable, enables RLS, denies direct browser-role access and grants access to the service role. It also notifies PostgREST to reload its schema.

Deploy the current app after the migration. The feature reuses the existing Supabase service-role binding and Resend configuration. Approval reminders and automatic approvals use the existing `/api/text-automation/send-due` production cron. No additional scheduled job is needed. Missing coordinator tables do not stop the existing purchase-order/email cron.

## Use

1. In Payroll, choose the year and expand **Combined coordinator Purchase Orders**. Owners/admins with Payroll access can manage them.
2. Select a coordinator and up to 25 unpaid, non-waived shows from the loaded payroll details. Storm Leigh owner draws are excluded. An existing order's show claims cannot be selected again for that coordinator.
3. Choose Net 15 or Net 30, preview the per-show balances and total, then create the combined order. Only the selected shows are recalculated; this does not rebuild the full payroll year. Preview/create/send recalculate the current server-side payroll amounts; client-entered totals or recipients are not accepted.
4. A created order appears immediately and is highlighted under **Saved coordinator Purchase Orders**. Click **Send purchase order by email** on its card or the ready-to-send panel. Review the recipient shown before sending. You can also open **Review document** first. The coordinator receives one email listing all shows and amounts, a total and one private approval link. Admin previews do not start their review clock.
5. The coordinator can approve the whole order or submit a change request. The 48-hour review starts with confirmed delivery or the recipient opening their secure link. The background job handles delivery, a 24-hour reminder and automatic approval after the deadline; document reads also reconcile overdue status.
6. Use **Refresh amounts / revise** when a show amount changes or a correction is requested. A revision keeps the same review URL, and an old form cannot approve a newer revision. Approved orders are not revisable/resendable.
7. A never-sent draft can be discarded, releasing its selected shows. Sent orders retain their show claims to prevent duplicate invoices. The saved-order list shows the latest 200 orders for the selected year.

Approval records acknowledgement of the amount owed. It does **not** mark any show paid or transfer funds. Continue to record each show's payment with the existing coordinator payment controls. Each show balance can appear once per coordinator across combined orders; adding shows to an existing order is not supported, so use a new order for later shows.

## Validation

```sh
yarn test:coordinator-purchase-orders
yarn test:coordinator-order-preview
yarn test:purchase-order-review
yarn build
```

An optional integration suite runs the actual migration, transactions and permissions in embedded PostgreSQL. Keep its test dependency outside the app:

```sh
npm install --prefix /tmp/els-po-db-tests --no-audit --no-fund @electric-sql/pglite@0.3.14
PGLITE_MODULE=/tmp/els-po-db-tests/node_modules/@electric-sql/pglite yarn test:coordinator-purchase-orders-db
```

The onboarding machine has no live Supabase or Resend credentials. Local SQL and mocked lifecycle tests do not establish that the production migration was applied, that email was delivered, or that the live cron ran. Perform a controlled end-to-end check after enabling the feature.

Preview verification has a 30-second server deadline; browser reads and actions also time out with a useful error. A timed-out create/send may have completed, so refresh saved orders before retrying. Draft creation and send responses update the list immediately, and an older list response cannot hide a newly created order.
