-- 0010_v6_cross_channel_persona.sql
-- Replai V6 — Cross-channel schema + Persona no workspace.
--
-- Sem breaking changes. Apenas colunas novas com defaults + view SQL nova
-- pra Impact Map cross-canal (X + LinkedIn).
--
-- Blocos:
--   A. reply_logs / session_logs / post_logs ganham `channel` (default 'twitter')
--   B. reply_logs / session_logs ganham `bundle_id` opcional (Groundswell X)
--   C. View impact_map_cross_channel unifica reply_logs + linkedin_replies
--
-- Migration eh idempotente (add column if not exists / create or replace view).
-- Persona (persona_public_target) NAO precisa migration — vive em workspaces.config
-- JSONB e ja pode ser gravada pelo cliente sem alter table.

-- =====================================================================
-- Bloco A — Channel discriminator em tabelas append-only X
-- =====================================================================

alter table public.reply_logs
  add column if not exists channel text not null default 'twitter'
  check (channel in ('twitter','linkedin'));

alter table public.session_logs
  add column if not exists channel text not null default 'twitter'
  check (channel in ('twitter','linkedin'));

alter table public.post_logs
  add column if not exists channel text not null default 'twitter'
  check (channel in ('twitter','linkedin'));

create index if not exists idx_reply_logs_workspace_channel
  on public.reply_logs (workspace_id, channel, logged_at desc);
create index if not exists idx_session_logs_workspace_channel
  on public.session_logs (workspace_id, channel, started_at desc);

-- =====================================================================
-- Bloco B — Groundswell bundle opcional em reply/session logs X
-- =====================================================================

alter table public.reply_logs
  add column if not exists bundle_id uuid
  references public.groundswell_bundles(id) on delete set null;

alter table public.session_logs
  add column if not exists bundle_id uuid
  references public.groundswell_bundles(id) on delete set null;

create index if not exists idx_reply_logs_bundle
  on public.reply_logs (bundle_id, logged_at desc)
  where bundle_id is not null;
create index if not exists idx_session_logs_bundle
  on public.session_logs (bundle_id, started_at desc)
  where bundle_id is not null;

-- =====================================================================
-- Bloco C — View unificada cross-canal
-- =====================================================================
-- Uniformiza reply_logs (X) + linkedin_replies (LinkedIn) numa view unica pro
-- Dashboard/AdminPanel/MyReplies filtrar por canal + workspace + periodo.
--
-- security_invoker=on: a view respeita as policies RLS das tabelas base
-- (analista ve so os proprios rows; admin ve tudo via is_admin()).

create or replace view public.impact_map_cross_channel
with (security_invoker = on) as
  select
    'twitter'::text as channel,
    r.user_id,
    r.user_email,
    r.workspace_id,
    r.workspace_name,
    r.logged_at as decided_at,
    r.posted_at,
    null::text as bridge_id,
    null::text as poi_target_id,
    r.tweet_handle as counterparty_handle,
    r.reply_text,
    r.reply_category,
    coalesce(
      r.decision,
      case when r.posted_confirmed is true then 'posted'
           when r.posted_confirmed is false then 'skipped'
           else 'ignored' end
    ) as decision,
    r.tweet_url as post_url,
    r.llm_cost_usd,
    r.bundle_id
  from public.reply_logs r
  union all
  select
    'linkedin'::text as channel,
    ln.user_id,
    null::text as user_email,
    ln.workspace_id,
    null::text as workspace_name,
    ln.logged_at as decided_at,
    ln.posted_at,
    ln.bridge_id,
    ln.poi_target_id,
    ln.post_author_name as counterparty_handle,
    ln.reply_text,
    ln.reply_category,
    coalesce(ln.decision, 'ignored') as decision,
    ln.post_url,
    ln.llm_cost_usd,
    ln.bundle_id
  from public.linkedin_replies ln;

grant select on public.impact_map_cross_channel to authenticated;

comment on view public.impact_map_cross_channel is
  'V6 (0010): Impact Map cross-canal. Uniformiza reply_logs (X) + linkedin_replies (LinkedIn) pra visualizacoes multi-canal. RLS herdada das tabelas base via security_invoker.';
