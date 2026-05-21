ELS49 - Booth / Area Unique Color Update

Use this package as the next version after ELS48.

What changed:
- Booth / area colors are now assigned from a larger, unique event-level palette instead of a small hash palette.
- Booth-separated crew-list exports should no longer reuse the same accent color for separate booths/areas when enough distinct colors are available.
- Event booth/area view now uses the same unique color assignment so the on-screen sections match the exported crew list better.
- Feedback survey documents also use the same booth/area color assignment.

No new Supabase SQL is required for this update.

Upload/deploy the ELS49 folder contents the same way you deployed ELS48.
