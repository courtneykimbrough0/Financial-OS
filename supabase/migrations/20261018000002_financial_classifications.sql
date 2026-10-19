-- Financial OS: the six financial classifications (Development-State
-- Directive). "savings" becomes Strategic Reserves ("reserve"), and one-time
-- spending is Varied Spending ("varied"), so a one-time item is income, varied
-- spending or a reserve. Bills, subscriptions and liabilities are recurring by
-- definition. Every financial row is development or sample data; the updates
-- below only rename rows that may exist in a test project. The old
-- constraints are dropped first, since they don't allow the new values.

alter table public.sources drop constraint sources_kind_check;
alter table public.occurrence_records drop constraint occurrence_records_kind_check;
alter table public.occurrence_records drop constraint occurrence_records_one_time_kind;

update public.sources set kind = 'reserve' where kind = 'savings';
update public.occurrence_records set kind = 'reserve' where kind = 'savings';
update public.occurrence_records set kind = 'varied' where source_id is null and kind = 'bill';

alter table public.sources add constraint sources_kind_check
  check (kind in ('income', 'bill', 'subscription', 'liability', 'reserve'));
alter table public.occurrence_records add constraint occurrence_records_kind_check
  check (kind in ('income', 'bill', 'subscription', 'liability', 'reserve', 'varied'));
alter table public.occurrence_records add constraint occurrence_records_one_time_kind
  check (case when source_id is null then kind in ('income', 'varied', 'reserve') else kind <> 'varied' end);
