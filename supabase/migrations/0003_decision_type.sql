-- 0003_decision_type.sql
-- V4.1: discrimina reply vs quote_tweet em reply_logs.
-- Default 'reply' pra preservar registros historicos sem perda de info.

alter table public.reply_logs
  add column if not exists decision_type text default 'reply'
  check (decision_type in ('reply', 'quote_tweet'));

-- index pra filtros admin por tipo
create index if not exists idx_reply_logs_decision_type
  on public.reply_logs(decision_type);
