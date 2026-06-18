-- Invoicing inclusion flags.
--
-- Lets admins control which portfolios and properties are billed, without
-- deactivating them (deactivation hides a property everywhere; this only takes it
-- out of invoice generation). A property is invoiced only when BOTH its own flag
-- and its portfolio's flag (if it has a portfolio) are true.
--
-- Columns are additive and default true, so existing behavior is preserved — with
-- one intentional exception: properties carrying 0 or 1 units are seeded excluded.
-- These are AppFolio import artifacts / placeholders (parks, single-unit stubs),
-- not real billable buildings, and were polluting the invoice review. They can be
-- switched back on individually from the Invoicing settings page.

alter table public.properties
  add column if not exists include_in_invoicing boolean not null default true;

alter table public.portfolios
  add column if not exists include_in_invoicing boolean not null default true;

comment on column public.properties.include_in_invoicing is
  'When false, this property is skipped during invoice generation. A property is billed only when this AND its portfolio''s flag are true.';
comment on column public.portfolios.include_in_invoicing is
  'When false, every property in this portfolio is skipped during invoice generation.';

-- Seed: exclude 0/1-unit properties (import artifacts / non-billable stubs).
update public.properties
  set include_in_invoicing = false
  where coalesce(total_units, 0) <= 1;
