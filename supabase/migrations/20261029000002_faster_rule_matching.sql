-- Faster rule matching.
--
-- private.rule_matches was evaluated once per (transaction, rule) pair and
-- could not be inlined by the planner (it had SET search_path and unpacked an
-- array), so a 1,600-row import spent ~4 s in function-call overhead.
-- These versions are single SQL expressions with no SET clause, which Postgres
-- inlines into the calling query. They reference only built-in functions and
-- operators, which always resolve from pg_catalog first, so leaving
-- search_path unset is safe here.

create or replace function private.text_matches(p_value text, p_match public.rule_match, p_pattern text)
returns boolean
language sql
immutable
parallel safe
as $$
  select case p_match
    when 'contains'    then strpos(upper(p_value), upper(btrim(p_pattern))) > 0
    when 'starts_with' then left(upper(btrim(p_value)), length(btrim(p_pattern))) = upper(btrim(p_pattern))
    when 'equals'      then upper(btrim(p_value)) = upper(btrim(p_pattern))
    when 'regex'       then p_value ~* p_pattern
  end
$$;

create or replace function private.rule_matches(
  p_raw text, p_display text, p_bank_category text, p_account_id uuid, p_amount_cents bigint,
  p_field public.rule_field, p_match public.rule_match, p_pattern text,
  p_rule_account uuid, p_min bigint, p_max bigint)
returns boolean
language sql
immutable
parallel safe
as $$
  select
    (p_rule_account is null or p_rule_account = p_account_id)
    and (p_min is null or abs(p_amount_cents) >= p_min)
    and (p_max is null or abs(p_amount_cents) <= p_max)
    and case p_field
          when 'description' then
            coalesce(private.text_matches(p_raw, p_match, p_pattern), false)
            or coalesce(private.text_matches(p_display, p_match, p_pattern), false)
          else coalesce(private.text_matches(coalesce(p_bank_category, ''), p_match, p_pattern), false)
        end
$$;

-- CREATE OR REPLACE keeps existing grants; text_matches is new.
revoke all on function private.text_matches(text, public.rule_match, text) from public;
grant execute on function private.text_matches(text, public.rule_match, text) to authenticated;
