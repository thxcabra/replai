-- 0014_manual_lists_source.sql
-- Replai V5.2 — Distingue bundles Groundswell (com POIs + scoring) de listas
-- manuais (CSV com nome + linkedin_url). Ambos vivem em groundswell_bundles
-- pra reusar todo o wiring existente (dropdown Header, dedup por bundle_id,
-- linkedin_scraped_posts.bundle_id FK, etc). O diferenciador e a coluna
-- `source` — orchestrator olha nela pra pular POI candidates em listas
-- manuais e o reply-generator escolhe o prompt certo.
--
-- Idempotente. Retro-compat: bundles existentes ficam source='groundswell'
-- (default). Zero mudanca de dados.

alter table public.groundswell_bundles
  add column if not exists source text not null default 'groundswell'
  check (source in ('groundswell', 'manual'));

create index if not exists idx_gs_bundles_source
  on public.groundswell_bundles (workspace_id, channel, source)
  where is_active = true;

comment on column public.groundswell_bundles.source is
  'V5.2: origem do bundle. `groundswell` = pipeline completo com POIs + relacionamentos scored. `manual` = lista CSV leve, so nome + linkedin_url, sem POI-target (reply direto ao autor da bridge).';
