-- 0009_groundswell_v5.sql
-- Replai V5 — Groundswell (X + LinkedIn com APIFY)
--
-- Nao altera schema X existente (workspaces, reply_logs, session_logs, etc).
-- Todas as tabelas novas sao aditivas com RLS espelhando padrao das existentes:
-- select = own or admin, insert/update/delete = own.
--
-- 3 blocos:
--   A. Groundswell bundle storage (7 tabelas)
--   B. LinkedIn reply flow (3 tabelas)
--   C. APIFY cost tracking + cache (2 tabelas)

-- =====================================================================
-- Bloco A — Groundswell bundle storage
-- =====================================================================

create table if not exists public.groundswell_bundles (
  id uuid primary key default gen_random_uuid(),
  workspace_id text references public.workspaces(id) on update cascade on delete cascade,
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  channel text not null default 'linkedin' check (channel in ('twitter','linkedin')),
  workspace_slug text,                       -- "moic-icp" do manifest
  delivery_date date,
  latest_engagement_date date,
  manifest jsonb,
  cohort_summary text,
  brand_radar jsonb,
  is_default boolean default false,          -- V5.0: bundle default do time (moic)
  is_active boolean default true,            -- so 1 ativo por workspace+channel
  uploaded_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists idx_groundswell_bundles_workspace on public.groundswell_bundles(workspace_id, channel) where is_active = true;
create index if not exists idx_groundswell_bundles_default on public.groundswell_bundles(is_default, channel) where is_default = true;

create table if not exists public.groundswell_profiles (
  bundle_id uuid not null references public.groundswell_bundles(id) on delete cascade,
  profile_id text not null,                  -- ACoAAA... LinkedIn URN (ou X handle)
  name text,
  node_type text,                            -- profile / company
  public_identifier text,                    -- daniel-finlay-33318a10
  linkedin_url text,
  headline text,
  current_company text,
  current_position text,
  followers int,
  is_poi boolean default false,
  tracked_layer int,
  inferred_layer int,
  pagerank numeric,
  distinct_source_count int,
  pagerank_adjusted numeric,
  hits_authority numeric,
  influence_surplus numeric,
  followers_percentile numeric,
  pagerank_adjusted_percentile numeric,
  hits_authority_percentile numeric,
  authority_consensus_percentile numeric,
  influence_surplus_percentile numeric,
  isv numeric,                               -- Influence Surplus Value
  computed_at timestamptz,
  primary key (bundle_id, profile_id)
);
create index if not exists idx_gs_profiles_poi on public.groundswell_profiles(bundle_id, is_poi) where is_poi = true;
create index if not exists idx_gs_profiles_isv on public.groundswell_profiles(bundle_id, isv desc);

create table if not exists public.groundswell_bridges (
  bundle_id uuid not null references public.groundswell_bundles(id) on delete cascade,
  bridge_id text not null,
  name text,
  headline text,
  current_company text,
  context_fit text,                          -- in_context / out_of_context
  readiness_score numeric,
  readiness_tier text,                       -- ready / emerging / needs_work
  profile_fit_score numeric,
  voice_quality_score numeric,
  proximity_score numeric,
  audience_score numeric,
  rationale text,
  n_interactions int,
  n_comments int,
  analyzed_at timestamptz,
  model text,
  primary key (bundle_id, bridge_id)
);
create index if not exists idx_gs_bridges_ready on public.groundswell_bridges(bundle_id, readiness_tier, context_fit)
  where readiness_tier = 'ready' and context_fit = 'in_context';

create table if not exists public.groundswell_relationships (
  bundle_id uuid not null references public.groundswell_bundles(id) on delete cascade,
  source_id text not null,
  source_name text,
  source_is_poi boolean,
  target_id text not null,
  target_name text,
  target_is_poi boolean,
  relation_type text,                        -- inner_circle / sporadic_contact / etc
  relation_rationale text,
  n_interactions int,
  follower_asymmetry numeric,
  reciprocity boolean,
  dominant_intention text,
  top_topics text,
  analyzed_at timestamptz,
  model text,
  primary key (bundle_id, source_id, target_id)
);
create index if not exists idx_gs_rel_target on public.groundswell_relationships(bundle_id, target_id);
create index if not exists idx_gs_rel_bridge_poi on public.groundswell_relationships(bundle_id, source_id, target_is_poi)
  where target_is_poi = true;

create table if not exists public.groundswell_interactions (
  bundle_id uuid not null references public.groundswell_bundles(id) on delete cascade,
  source_id text not null,
  source_name text,
  target_id text,
  target_name text,
  ref_type text,                             -- reaction / comment
  post_id text,
  post_url text,
  post_content text,
  commentary text,
  topics text,
  intention text,
  language text,
  date_utc timestamptz,
  analyzed_at timestamptz,
  model text
);
create index if not exists idx_gs_interactions_bundle on public.groundswell_interactions(bundle_id, source_id);
create index if not exists idx_gs_interactions_topics on public.groundswell_interactions(bundle_id, intention);

create table if not exists public.groundswell_source_profiles (
  bundle_id uuid not null references public.groundswell_bundles(id) on delete cascade,
  source_id text not null,
  source_name text,
  source_is_poi boolean,
  n_interactions int,
  n_authors int,
  n_authored_posts int,
  pct_endorsement numeric,
  pct_technical numeric,
  engaged_topic_distribution jsonb,
  authored_topic_distribution jsonb,
  intention_distribution jsonb,
  relation_type_distribution jsonb,
  languages text,
  computed_at timestamptz,
  primary key (bundle_id, source_id)
);

create table if not exists public.groundswell_pair_overlap (
  bundle_id uuid not null references public.groundswell_bundles(id) on delete cascade,
  source_id text not null,
  target_id text not null,
  shared_companies jsonb,
  shared_education jsonb,
  same_city boolean,
  same_state boolean,
  same_country boolean,
  computed_at timestamptz,
  primary key (bundle_id, source_id, target_id)
);

-- =====================================================================
-- Bloco B — LinkedIn reply flow
-- =====================================================================

create table if not exists public.linkedin_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id text references public.workspaces(id) on update cascade on delete cascade,
  bundle_id uuid references public.groundswell_bundles(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  fetch_ms int,
  triage_passed int,
  triage_selected int,
  llm_called boolean default false,
  llm_provider text,
  llm_model text,
  llm_ms int,
  llm_input_tokens int,
  llm_output_tokens int,
  llm_cost_usd numeric(10,6),
  apify_runs int default 0,
  apify_cost_usd numeric(10,6) default 0
);
create index if not exists idx_ln_sessions_user on public.linkedin_sessions(user_id, started_at desc);

create table if not exists public.linkedin_engaged_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id text references public.workspaces(id) on update cascade on delete cascade,
  post_urn text not null,
  decided_at timestamptz not null default now(),
  unique (user_id, workspace_id, post_urn)
);

create table if not exists public.linkedin_replies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id text references public.workspaces(id) on update cascade on delete cascade,
  bundle_id uuid references public.groundswell_bundles(id) on delete set null,
  session_id uuid references public.linkedin_sessions(id) on delete set null,

  -- Post que estamos respondendo
  post_urn text not null,
  post_url text,
  post_author_id text,
  post_author_name text,
  post_author_headline text,
  post_content text,
  post_published_at timestamptz,
  post_language text,

  -- Estrategia Groundswell
  bridge_id text,                            -- profile_id da Bridge (autor do post)
  bridge_readiness_tier text,
  poi_target_id text,                        -- profile_id do POI-alvo indireto
  poi_target_name text,
  relation_type_bridge_to_poi text,          -- inner_circle / sporadic_contact / etc
  poi_selection_score numeric,               -- heuristica readiness × profile_fit × context_fit
  strategy_note text,                        -- rationale gerada pelo LLM ou heuristica

  -- Reply gerada
  reply_text text not null,
  reply_category text,
  voice_snapshot text,
  llm_provider text,
  llm_model text,
  llm_input_tokens int,
  llm_output_tokens int,
  llm_cost_usd numeric(10,6),

  -- Decision + tracking
  decision text check (decision in ('posted','skipped','edited_only','ignored')),
  posted_comment_urn text,                   -- URN do comentario posted
  posted_at timestamptz,
  analyst_notes text,

  -- Metrics manuais (LinkedIn API nao expoe sem OAuth partnership)
  reactions_total int,
  reactions_breakdown jsonb,
  comments_count int,
  reshares_count int,
  impressions_count int,
  metrics_updated_at timestamptz,

  logged_at timestamptz not null default now()
);
create index if not exists idx_ln_replies_user on public.linkedin_replies(user_id, logged_at desc);
create index if not exists idx_ln_replies_bridge on public.linkedin_replies(workspace_id, bridge_id, logged_at desc);
create index if not exists idx_ln_replies_poi on public.linkedin_replies(workspace_id, poi_target_id, posted_at desc)
  where decision = 'posted';

-- =====================================================================
-- Bloco C — APIFY tracking + cache
-- =====================================================================

create table if not exists public.apify_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text references public.workspaces(id) on update cascade on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  channel text not null default 'linkedin',
  actor_id text not null,
  input_hash text not null,                  -- sha256 do input pra dedup
  cu_used numeric(10,4),
  cost_usd numeric(10,6),
  cached boolean default false,
  items_returned int,
  ran_at timestamptz default now(),
  error text
);
create index if not exists idx_apify_runs_workspace_month on public.apify_runs(workspace_id, ran_at desc);
create index if not exists idx_apify_runs_user_day on public.apify_runs(user_id, ran_at desc);

create table if not exists public.apify_cache (
  cache_key text primary key,                -- sha256(actor_id + input_hash + bundle_id)
  workspace_id text references public.workspaces(id) on update cascade on delete cascade,
  channel text not null default 'linkedin',
  actor_id text not null,
  items jsonb not null,
  cu_used numeric(10,4),
  cost_usd numeric(10,6),
  items_count int,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists idx_apify_cache_workspace on public.apify_cache(workspace_id, expires_at);
create index if not exists idx_apify_cache_expires on public.apify_cache(expires_at);

-- =====================================================================
-- RLS: espelha padrao (select own+admin, insert own, update own)
-- =====================================================================

do $$
declare
  t text;
  tables text[] := array[
    'groundswell_bundles',
    'groundswell_profiles',
    'groundswell_bridges',
    'groundswell_relationships',
    'groundswell_interactions',
    'groundswell_source_profiles',
    'groundswell_pair_overlap',
    'linkedin_sessions',
    'linkedin_engaged_posts',
    'linkedin_replies',
    'apify_runs',
    'apify_cache'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Bundles: uploaded_by e user_id ancora; bundle default (is_default=true) legivel por todos os autenticados
create policy "gs_bundles select own or default or admin" on public.groundswell_bundles
  for select using (
    (select auth.uid()) = uploaded_by
    or is_default = true
    or public.is_admin()
  );
create policy "gs_bundles insert own" on public.groundswell_bundles
  for insert with check ((select auth.uid()) = uploaded_by);
create policy "gs_bundles update own or admin" on public.groundswell_bundles
  for update using ((select auth.uid()) = uploaded_by or public.is_admin())
  with check ((select auth.uid()) = uploaded_by or public.is_admin());
create policy "gs_bundles delete own or admin" on public.groundswell_bundles
  for delete using ((select auth.uid()) = uploaded_by or public.is_admin());

-- Tabelas filhas: acesso via bundle_id — se o user pode ver o bundle, pode ver tudo dentro
-- Regra: usa EXISTS check contra groundswell_bundles
do $$
declare
  t text;
  child_tables text[] := array[
    'groundswell_profiles',
    'groundswell_bridges',
    'groundswell_relationships',
    'groundswell_interactions',
    'groundswell_source_profiles',
    'groundswell_pair_overlap'
  ];
begin
  foreach t in array child_tables loop
    execute format($f$
      create policy "%s_select via bundle" on public.%I
        for select using (
          exists (
            select 1 from public.groundswell_bundles b
            where b.id = %I.bundle_id
              and ((select auth.uid()) = b.uploaded_by or b.is_default = true or public.is_admin())
          )
        );
      create policy "%s_insert via bundle" on public.%I
        for insert with check (
          exists (
            select 1 from public.groundswell_bundles b
            where b.id = %I.bundle_id
              and (select auth.uid()) = b.uploaded_by
          )
        );
      create policy "%s_delete via bundle" on public.%I
        for delete using (
          exists (
            select 1 from public.groundswell_bundles b
            where b.id = %I.bundle_id
              and ((select auth.uid()) = b.uploaded_by or public.is_admin())
          )
        );
    $f$, t, t, t, t, t, t, t, t, t);
  end loop;
end $$;

-- LinkedIn sessions/engaged_posts/replies: padrao own+admin
create policy "ln_sessions select own or admin" on public.linkedin_sessions
  for select using ((select auth.uid()) = user_id or public.is_admin());
create policy "ln_sessions insert own" on public.linkedin_sessions
  for insert with check ((select auth.uid()) = user_id);
create policy "ln_sessions update own" on public.linkedin_sessions
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "ln_engaged select own or admin" on public.linkedin_engaged_posts
  for select using ((select auth.uid()) = user_id or public.is_admin());
create policy "ln_engaged insert own" on public.linkedin_engaged_posts
  for insert with check ((select auth.uid()) = user_id);
create policy "ln_engaged delete own" on public.linkedin_engaged_posts
  for delete using ((select auth.uid()) = user_id);

create policy "ln_replies select own or admin" on public.linkedin_replies
  for select using ((select auth.uid()) = user_id or public.is_admin());
create policy "ln_replies insert own" on public.linkedin_replies
  for insert with check ((select auth.uid()) = user_id);
create policy "ln_replies update own or admin" on public.linkedin_replies
  for update using ((select auth.uid()) = user_id or public.is_admin())
  with check ((select auth.uid()) = user_id or public.is_admin());

-- APIFY tracking: user_id ancora
create policy "apify_runs select own or admin" on public.apify_runs
  for select using ((select auth.uid()) = user_id or public.is_admin());
create policy "apify_runs insert own" on public.apify_runs
  for insert with check ((select auth.uid()) = user_id);

-- APIFY cache: acesso por workspace — todos os users do workspace se beneficiam do cache (dedup)
create policy "apify_cache select via workspace" on public.apify_cache
  for select using (
    exists (
      select 1 from public.workspaces w
      where w.id = apify_cache.workspace_id
        and ((select auth.uid()) = w.user_id or public.is_admin())
    )
  );
create policy "apify_cache insert via workspace" on public.apify_cache
  for insert with check (
    exists (
      select 1 from public.workspaces w
      where w.id = apify_cache.workspace_id
        and (select auth.uid()) = w.user_id
    )
  );
create policy "apify_cache delete via workspace" on public.apify_cache
  for delete using (
    exists (
      select 1 from public.workspaces w
      where w.id = apify_cache.workspace_id
        and ((select auth.uid()) = w.user_id or public.is_admin())
    )
  );

-- =====================================================================
-- Helpers: unique constraints derivados (so 1 ativo por workspace+channel)
-- =====================================================================

-- Garante que so ha 1 bundle ativo por workspace+channel (aplicado via trigger
-- pra evitar problema de partial unique index com update)
create or replace function public.enforce_single_active_bundle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_active = true and new.workspace_id is not null then
    update public.groundswell_bundles
    set is_active = false, archived_at = now()
    where workspace_id = new.workspace_id
      and channel = new.channel
      and id != new.id
      and is_active = true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_single_active_bundle on public.groundswell_bundles;
create trigger trg_single_active_bundle
  before insert or update of is_active on public.groundswell_bundles
  for each row
  when (new.is_active = true)
  execute function public.enforce_single_active_bundle();

-- =====================================================================
-- Helper query pra POI selection heuristica (usada pelo client)
-- Retorna top-N POIs candidatos pra uma bridge dada, ordenados por score composto
-- =====================================================================

create or replace function public.get_poi_candidates_for_bridge(
  p_bundle_id uuid,
  p_bridge_id text,
  p_limit int default 5
)
returns table (
  poi_id text,
  poi_name text,
  relation_type text,
  n_interactions int,
  reciprocity boolean,
  isv numeric,
  followers int,
  composite_score numeric
)
language sql
stable
security invoker
as $$
  with bridge_meta as (
    select readiness_score, profile_fit_score, context_fit
    from public.groundswell_bridges
    where bundle_id = p_bundle_id and bridge_id = p_bridge_id
  ),
  rels as (
    select r.target_id as poi_id,
      r.target_name as poi_name,
      r.relation_type,
      r.n_interactions,
      r.reciprocity,
      p.isv,
      p.followers,
      -- Peso do relation_type (inner_circle > frequent > sporadic > episodic)
      case r.relation_type
        when 'inner_circle' then 1.6
        when 'frequent_contact' then 1.3
        when 'peer' then 1.1
        when 'reciprocal_pair' then 1.15
        when 'occasional_contact' then 0.8
        when 'sporadic_contact' then 0.5
        else 1.0
      end as rel_multiplier
    from public.groundswell_relationships r
    join public.groundswell_profiles p on p.bundle_id = r.bundle_id and p.profile_id = r.target_id
    where r.bundle_id = p_bundle_id
      and r.source_id = p_bridge_id
      and p.is_poi = true
  )
  select
    rels.poi_id,
    rels.poi_name,
    rels.relation_type,
    rels.n_interactions,
    rels.reciprocity,
    rels.isv,
    rels.followers,
    -- Score composto: relacao × interacoes × influencia POI
    round(
      (rels.rel_multiplier
       * (1 + ln(1 + coalesce(rels.n_interactions, 0)))
       * (1 + coalesce(rels.isv, 0) / 100.0)
       * case when rels.reciprocity then 1.2 else 1.0 end
      )::numeric, 4
    ) as composite_score
  from rels
  order by composite_score desc
  limit p_limit;
$$;

grant execute on function public.get_poi_candidates_for_bridge(uuid, text, int) to authenticated;

-- =====================================================================
-- Comment: migration nao seeda o bundle moic padrao aqui.
-- Isso vai ser feito pelo cliente na 1a vez que o user autenticar em V5:
-- ver src/lib/groundswell/seed-default.ts
-- =====================================================================
