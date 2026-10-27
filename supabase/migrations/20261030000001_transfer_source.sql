-- A transaction's category can now come from a transfer link (see the next
-- migration). Added on its own because a new enum value cannot be used in the
-- same transaction that creates it.
alter type public.category_source add value if not exists 'transfer';
