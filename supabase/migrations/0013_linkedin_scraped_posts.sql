-- 0013_linkedin_scraped_posts.sql
-- Replai V5.1 — Cache persistente dos posts LinkedIn scraped.
--
-- Contexto:
--   apify_cache (V5) tem TTL 12h e cache-key por (actor, input) — expira e some.
--   User pediu que posts scraped fiquem armazenados permanentemente pra:
--     1. Evitar re-scrape do mesmo post (economia APIFY)
--     2. Poder revisitar posts antigos mesmo apos cache expirar
--     3. Base pra analytics (quantos posts unicos ja processamos, etc)
--
-- Diferenca vs linkedin_engaged_posts:
--   linkedin_engaged_posts: so a chave (post_urn) do que ja engajamos — usado
--     pra dedup ("nao mostra na triage 2 vezes")
--   linkedin_scraped_posts: o CONTEUDO do post + metadata — usado pra triagem
--     sem re-scrape
--
-- RLS: espelha padrao dos outros linkedin_* (own or admin).

create table if not exists public.linkedin_scraped_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on update cascade on delete cascade,
  bundle_id uuid references public.groundswell_bundles(id) on delete set null,

  -- Post metadata (denormalizado pra query rapida sem parse do jsonb)
  post_urn text not null,
  post_url text,
  bridge_id text,                    -- profile_id da Bridge (autor)
  author_handle text,
  author_display_name text,
  author_headline text,
  post_text text,
  post_lang text,
  post_type text,                    -- regular / repost / quote / article / job
  post_created_at timestamptz,       -- quando o post foi publicado no LinkedIn

  -- Engagement snapshot no momento do scrape
  reactions_count int,
  comments_count int,
  reshares_count int,

  -- Raw completo pra evitar re-scrape se schema mudar
  raw_data jsonb,

  -- Tracking
  scraped_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),   -- atualiza a cada scrape novo

  -- Unicidade: 1 row por post por workspace (permite mesmo post em 2 workspaces distintos)
  unique (workspace_id, post_urn)
);

create index if not exists idx_ln_scraped_ws_created
  on public.linkedin_scraped_posts (workspace_id, post_created_at desc);
create index if not exists idx_ln_scraped_bridge
  on public.linkedin_scraped_posts (workspace_id, bridge_id, post_created_at desc);
create index if not exists idx_ln_scraped_bundle
  on public.linkedin_scraped_posts (bundle_id, post_created_at desc)
  where bundle_id is not null;

alter table public.linkedin_scraped_posts enable row level security;

create policy "ln_scraped_posts select own or admin"
  on public.linkedin_scraped_posts for select
  using (
    workspace_id in (
      select id from public.workspaces where user_id = auth.uid()
    )
    or public.is_admin()
  );

create policy "ln_scraped_posts insert own"
  on public.linkedin_scraped_posts for insert
  with check (
    workspace_id in (
      select id from public.workspaces where user_id = auth.uid()
    )
  );

create policy "ln_scraped_posts update own"
  on public.linkedin_scraped_posts for update
  using (
    workspace_id in (
      select id from public.workspaces where user_id = auth.uid()
    )
  );

comment on table public.linkedin_scraped_posts is
  'V5.1: cache persistente dos posts LinkedIn scraped. Upsert por (workspace, post_urn). Usado pra triage sem re-fetch APIFY.';
