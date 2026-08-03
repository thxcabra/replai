-- 0004_intelligence_and_scores.sql
-- V4.1: suporta camada de inteligencia (2.11) + selection scorer (2.9) +
-- reply engagement-aware (2.10).

------------------------------------------------------------
-- reply_logs: novas colunas
------------------------------------------------------------

-- Scores do selection-scorer (2.9): persona_relevance + engagement_potential
-- + combined. Nullable porque scorer pode estar desabilitado / sem chave Gemini.
alter table public.reply_logs
  add column if not exists persona_relevance int
    check (persona_relevance is null or (persona_relevance between 0 and 100)),
  add column if not exists engagement_potential int
    check (engagement_potential is null or (engagement_potential between 0 and 100)),
  add column if not exists selection_combined int
    check (selection_combined is null or (selection_combined between 0 and 100));

-- Engajamento percebido pelo analista no momento da postagem (2.10).
-- Marca opcional no PostConfirmDialog: "autor curtiu/respondeu agora?"
-- Sinal de treino pra futuro fine-tune do engagement_potential do scorer.
alter table public.reply_logs
  add column if not exists author_engaged_at_post boolean;

-- Tier derivado do scorer (2.10): mega/large/mid/small. Texto pra agrupar
-- agregados sem precisar recalcular do isv/followers.
alter table public.reply_logs
  add column if not exists author_tier text
    check (author_tier is null or author_tier in ('mega', 'large', 'mid', 'small'));

------------------------------------------------------------
-- session_logs: novas colunas
------------------------------------------------------------

-- Metrica do selection-scorer: quantos tweets foram ocultos pelo filtro
-- (passaram no prefilter mecanico mas foram filtrados pelo scorer semantico).
alter table public.session_logs
  add column if not exists selection_filter_hidden_count int,
  add column if not exists selection_filter_avg_engagement int,
  add column if not exists selection_filter_avg_relevance int;

------------------------------------------------------------
-- Indexes
------------------------------------------------------------

-- pra getAuthorProfile (2.11 sub-camada B): aggregations per author_handle
create index if not exists idx_reply_logs_author_handle
  on public.reply_logs(tweet_handle, user_id);

-- pra analytics admin filtrar por tier
create index if not exists idx_reply_logs_author_tier
  on public.reply_logs(author_tier);

------------------------------------------------------------
-- get_author_profiles: funcao SQL pra batched lookup do historico.
-- Usada por intelligence.getAuthorProfile no client. Roda como SECURITY
-- INVOKER (respeita RLS — cada analista so ve seu proprio historico).
------------------------------------------------------------
create or replace function public.get_author_profiles(handles text[])
returns table (
  author_handle text,
  interaction_count bigint,
  we_posted_count bigint,
  we_verified_count bigint,
  author_engaged_count bigint,
  last_interaction_at timestamptz,
  successful_categories text[],
  avg_relevance numeric,
  avg_engagement numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    tweet_handle as author_handle,
    count(*) as interaction_count,
    count(*) filter (where decision = 'posted') as we_posted_count,
    count(*) filter (where posted_reply_id is not null) as we_verified_count,
    count(*) filter (where author_engaged_at_post is true) as author_engaged_count,
    max(coalesce(posted_at, logged_at)) as last_interaction_at,
    -- categorias que conseguiram engajamento (posted + autor reagiu)
    array_agg(distinct reply_category)
      filter (where author_engaged_at_post is true and reply_category is not null)
      as successful_categories,
    avg(persona_relevance) as avg_relevance,
    avg(engagement_potential) as avg_engagement
  from public.reply_logs
  where tweet_handle = any(handles)
    and tweet_handle is not null
    and user_id = (select auth.uid())
  group by tweet_handle;
$$;

grant execute on function public.get_author_profiles(text[]) to authenticated;
