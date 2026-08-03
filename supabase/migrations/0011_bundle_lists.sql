-- 0011_bundle_lists.sql
-- Replai V5.1 — Multi-bundle ativo por (workspace, channel) + naming.
--
-- Contexto:
--   V5 forcava 1 bundle ativo por (workspace, channel) via trigger
--   enforce_single_active_bundle. User pediu "listas" LinkedIn — subgrupos
--   POI+Bridge alternaveis (analogo as Listas do X). O padrao mais simples:
--   1 bundle = 1 lista, N ativos por par (workspace, channel). Dropdown no
--   Header alterna qual esta em uso (persistido em Config.linkedin_bundle_id).
--
-- Retrocompat:
--   Bundles existentes continuam funcionando. Todos recebem name inicial =
--   workspace_slug (ou 'Lista principal' se ausente). Adapter LinkedIn ja
--   aceita config.bundle_id (index.ts:339) — wiring pronto.
--
-- Idempotente (drop if exists / add column if not exists).

-- =====================================================================
-- Bloco A — Coluna name (nome da lista, apresentado no dropdown)
-- =====================================================================

alter table public.groundswell_bundles
  add column if not exists name text;

-- Popula bundles existentes: usa workspace_slug se presente, fallback default.
update public.groundswell_bundles
set name = coalesce(nullif(trim(workspace_slug), ''), 'Lista principal')
where name is null;

-- A partir daqui, name eh obrigatorio pra novos bundles (default 'Lista principal').
alter table public.groundswell_bundles
  alter column name set default 'Lista principal';

-- =====================================================================
-- Bloco B — Drop trigger single-active. Multi-bundle passa a ser permitido.
-- =====================================================================
-- O trigger arquivava outros bundles do mesmo (workspace, channel) sempre
-- que um novo entrava com is_active=true. V5.1 quer N ativos simultaneos.
-- Bundles arquivados anteriormente permanecem com archived_at setado — nao
-- reativa retroativamente (bundle desativado por usuario continua desativado).

drop trigger if exists trg_single_active_bundle on public.groundswell_bundles;
drop function if exists public.enforce_single_active_bundle();

-- =====================================================================
-- Bloco C — Constraint de unicidade por nome dentro do par (workspace, channel)
-- =====================================================================
-- Dois bundles ativos no mesmo (workspace, channel) NAO podem ter mesmo name.
-- Bundles arquivados (is_active=false) nao contam pra unicidade.

create unique index if not exists idx_gs_bundles_unique_name_active
  on public.groundswell_bundles (workspace_id, channel, name)
  where is_active = true and workspace_id is not null;

-- =====================================================================
-- Bloco D — Reindex pro dropdown (listActiveBundles)
-- =====================================================================
-- Query padrao: bundles ativos por (workspace, channel), mais recente primeiro.
-- O index atual idx_groundswell_bundles_workspace ja cobre (workspace_id, channel)
-- where is_active=true — nao precisa criar novo.

comment on column public.groundswell_bundles.name is
  'V5.1: nome da lista (subgrupo POI+Bridge). Dropdown no Header alterna qual esta em uso. Default: Lista principal.';
