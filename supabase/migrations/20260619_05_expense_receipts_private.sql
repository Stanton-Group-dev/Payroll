-- Make the expense-receipts storage bucket private.
--
-- Apply ONLY after the sign-on-read code (api/expense-receipt route +
-- path-storing writes) is deployed, or live receipt display breaks.
--
-- Once this runs, new rows already store object paths (not public URLs), and
-- the /api/expense-receipt route issues short-lived signed URLs on read.
-- Legacy rows that stored full public URLs are handled by the legacy
-- passthrough in the same route (path.startsWith('http') → redirect directly).

update storage.buckets
set public = false
where id = 'expense-receipts';
