ELS45 update package

Changes added:
1. Events > Add Crew now supports assigning one crew member to multiple matching sub-calls/dates.
   - Matching means same area, same position/rate pattern, and same start/end time.
   - Defaults to current day only so crew is not accidentally assigned everywhere.
   - Use Select all to add the same person across the matching dates.

2. Events > Change view now includes Feedback forms.
   - Generates one Project Manager / Overall Event feedback form.
   - Generates one separate feedback form for each Booth / Area.
   - Forms include testimonial prompts, problem/follow-up prompts, and 1-5 rating lines for techs assigned to that form.
   - Forms can be copied or exported as TXT, DOCX, or PDF.

Supabase SQL:
No new SQL is required for this ELS45 update. It uses the existing shows, labor_days, sub_calls, assignments, crew, tech_ratings, business_clients, and client_contacts tables.

If the app reports old missing columns from prior updates, run the prior ELS44/ELS43 SQL first.
