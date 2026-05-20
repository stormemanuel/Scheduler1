ELS44 Project Manager Favorite Update

Upload the ELS44 folder contents to your app repo. This package stays under 100 files.

What changed:
- Added a Requested Back / PM Favorite button under each worker Notes / Rating panel.
- Added the same PM Favorite button on the Tech Ratings view.
- Favorites are saved by selected Project Manager / Client Contact, not just by company.
- Favorites show in a Project Manager Favorites / Requested Back list.
- Ratings still build median Top Techs lists for the business client and project manager/contact.

Required after deploy:
1. Run ELS44/supabase/clients_tech_ratings_migration.sql in Supabase SQL Editor.
2. Make sure each event has a Business Client and Project Manager / Client Contact selected before using PM favorites.

Only client name/contact name are required; extra address, billing, AP, PO, website, and notes fields remain optional.
