-- Per-field audit trail for the employee master roster. A trigger writes one row per changed
-- field on every INSERT/UPDATE of payroll_employees, capturing old/new value, who, and when.
-- This makes every roster edit auditable down to the individual field + timestamp.

create table if not exists public.payroll_employee_audit (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.payroll_employees(id) on delete cascade,
  field            text not null,
  old_value        text,
  new_value        text,
  operation        text not null,                 -- 'insert' | 'update'
  changed_by       uuid,                          -- auth.uid() of the editor
  changed_by_email text,                          -- resolved at write time for easy display
  changed_at       timestamptz not null default now()
);

create index if not exists idx_payroll_employee_audit_emp
  on public.payroll_employee_audit(employee_id, changed_at desc);
create index if not exists idx_payroll_employee_audit_field
  on public.payroll_employee_audit(employee_id, field, changed_at desc);

-- RLS: any authenticated user may READ history. There are NO insert/update/delete policies, so the
-- table is append-only from the app's side — only the SECURITY DEFINER trigger (and service_role) can
-- write it. That keeps the audit trail tamper-resistant.
alter table public.payroll_employee_audit enable row level security;

drop policy if exists "payroll_employee_audit_select" on public.payroll_employee_audit;
create policy "payroll_employee_audit_select" on public.payroll_employee_audit
  for select to authenticated using (auth.uid() is not null);

create or replace function public.payroll_employees_audit_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  k         text;
  oldj      jsonb;
  newj      jsonb := to_jsonb(NEW);
  uid       uuid := auth.uid();
  uemail    text;
  skip_cols text[] := array['id','created_at','updated_at','created_by'];
begin
  if uid is not null then
    select email into uemail from auth.users where id = uid;
  end if;

  if TG_OP = 'INSERT' then
    for k in select jsonb_object_keys(newj) loop
      if k = any(skip_cols) then continue; end if;
      if newj -> k is not null and newj ->> k <> '' then
        insert into public.payroll_employee_audit
          (employee_id, field, old_value, new_value, operation, changed_by, changed_by_email)
        values (NEW.id, k, null, newj ->> k, 'insert', uid, uemail);
      end if;
    end loop;
    return NEW;
  end if;

  oldj := to_jsonb(OLD);
  for k in select jsonb_object_keys(newj) loop
    if k = any(skip_cols) then continue; end if;
    if (oldj -> k) is distinct from (newj -> k) then
      insert into public.payroll_employee_audit
        (employee_id, field, old_value, new_value, operation, changed_by, changed_by_email)
      values (NEW.id, k, oldj ->> k, newj ->> k, 'update', uid, uemail);
    end if;
  end loop;
  return NEW;
end $$;

drop trigger if exists trg_payroll_employees_audit on public.payroll_employees;
create trigger trg_payroll_employees_audit
  after insert or update on public.payroll_employees
  for each row execute function public.payroll_employees_audit_fn();
