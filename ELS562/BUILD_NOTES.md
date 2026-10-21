# ELS563 availability rebuild

Production build and TypeScript checks pass. All 31 isolated availability regression checks pass. Production HTTP checks passed for login, Events, and the application manifest. Queueing correctly rejects requests when Supabase is unconfigured. These checks do not verify ASH live records or authenticated workflows.

## Changes

- Fixed public purchase-order day types and payroll draft pay-mode inference.
- Added shared strict interval validation, overnight overlap checks, and inactive-assignment filtering.
- Mark incomplete loaded schedules as unknown rather than available.
- Clear selected crew when requested call IDs change, and reject stale or incomplete crew selections before POST.
- Server uses sub-call IDs to retrieve authoritative requested times. It checks selected crew bookings across all shows, including shows not loaded in the browser. Queries paginate and batch IDs. Overlaps, missing related data, database errors and safety-limit exhaustion reject the whole request without queue writes. Client-supplied call times are ignored.
- Added `yarn test:availability` (19 client/interval and 12 mocked server regression cases) and a Yarn lockfile.

## Run or deploy

Use Node 24.x and Yarn 1.22.22. From this package directory:

```sh
yarn install --frozen-lockfile --non-interactive
yarn test:availability
yarn build
yarn start
```

Configure NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY securely before building and starting. Never expose the service-role key in client settings. Allow HTTPS access to your development project's Supabase hostname. Public NEXT_PUBLIC values are compiled into browser bundles: rebuild after changing them. Use an existing, correctly provisioned project; no schema migrations were supplied. Never run dev and build concurrently in the same directory because both write .next.

## Verification limits

No live database credentials were available; no messages were sent and no live records changed. Server regression tests use a simulated Supabase query interface and queue writer; database/schema compatibility still needs a development-project check. Verify authenticated access, ASH schedules, and queue results in a controlled development environment before production deployment. Queue conflict checks read current records before insertion; they do not reserve crew or lock schedules against concurrent edits, nor revalidate messages already queued when later bookings change. Schedules are compared as local wall-clock dates/times, matching the existing data model; cross-timezone scheduling needs a defined timezone model. An unrelated existing lint task still prompts for missing ESLint configuration. The rebuild preserves the existing ELS562 application directory so existing deployment root settings continue to work.

The ZIP contains source, tests and yarn.lock; node_modules, generated build output, credentials and local environment files are excluded. The production output tested on the current machine is retained separately in .next.
