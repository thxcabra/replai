-- 0007_post_logs.sql
-- V4.1.8: tracking analytics dos POSTS sugeridos (paralelo ao reply_logs).
-- Cada post sugerido pelo LLM que o analista postar (ou nao) vira uma row aqui.
--
-- Semantica:
--   - LLM gera N sugestoes via aba Posts → analista revisa
--   - Analista clica "postar este" → abre dialog PostConfirmDialog
--   - Dialog captura: URL postada no X (validacao), edicao do texto final, etc
--   - Row inserida em post_logs com snapshot completo do contexto
--   - Metricas reais (likes/RTs/etc) preenchidas depois pelo proprio analista
--     (sem scraping, padrao da V4.1.2 pra replies)

create table if not exists public.post_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  workspace_name text not null,
  session_id uuid references public.session_logs(id) on delete set null,

  -- snapshot da persona/voz no momento do post
  voice_snapshot text,
  voice_version_id uuid references public.voice_versions(id) on delete set null,
  config_snapshot jsonb,

  -- conteudo gerado pelo LLM
  angle text not null,
  hook text,
  body text not null,
  why text,
  category text,

  -- imagem gerada (Gemini) — guarda data URL e nome de modelo usado
  image_model text,
  image_mime_type text,
  image_data_url text,   -- nullable, pode pesar — opcional baixar antes de salvar

  -- inputs usados pra gerar (rastreabilidade)
  watchtower_title text,
  watchtower_matched_by text,     -- "date" | "fallback_most_recent"
  watchtower_date_requested text, -- YYYY-MM-DD se analista escolheu data especifica
  viral_posts_count int,
  recent_categories text[],

  -- LLM usado pra gerar a sugestao
  llm_provider text,
  llm_model text,
  llm_input_tokens int,
  llm_output_tokens int,
  llm_cost_usd numeric,

  -- decisao do analista
  was_edited boolean default false,
  posted_at timestamptz,
  posted_post_id text,            -- ID da tweet postada (analogo a posted_reply_id)
  decision text check (
    decision is null or decision in ('posted', 'skipped', 'edited_only', 'ignored')
  ),

  -- metricas manuais (preenchidas depois sem scraping)
  actual_likes int check (actual_likes is null or actual_likes >= 0),
  actual_retweets int check (actual_retweets is null or actual_retweets >= 0),
  actual_replies int check (actual_replies is null or actual_replies >= 0),
  actual_quotes int check (actual_quotes is null or actual_quotes >= 0),
  actual_bookmarks int check (actual_bookmarks is null or actual_bookmarks >= 0),
  actual_views int check (actual_views is null or actual_views >= 0),
  -- discoveries qualitativos pelo analista
  analyst_notes text,
  metrics_updated_at timestamptz,

  -- tempo gasto entre LLM gerar e analista decidir
  time_to_decide_ms int,

  logged_at timestamptz not null default now()
);

-- RLS: cada analista ve/edita os proprios. Admin pode SELECT tudo.
alter table public.post_logs enable row level security;

create policy "post_logs select own or admin" on public.post_logs
  for select using (
    (select auth.uid()) is not null
    and (user_id = (select auth.uid()) or public.is_admin())
  );

create policy "post_logs insert own" on public.post_logs
  for insert with check (
    (select auth.uid()) is not null
    and user_id = (select auth.uid())
  );

create policy "post_logs update own metrics" on public.post_logs
  for update using (
    (select auth.uid()) is not null
    and user_id = (select auth.uid())
  )
  with check (
    (select auth.uid()) is not null
    and user_id = (select auth.uid())
  );

-- Indexes pros filtros comuns
create index if not exists idx_post_logs_user_logged_at
  on public.post_logs(user_id, logged_at desc);
create index if not exists idx_post_logs_workspace
  on public.post_logs(workspace_id);
create index if not exists idx_post_logs_decision
  on public.post_logs(decision);

-- Trigger pra autoset metrics_updated_at quando metricas mudam (igual reply_logs)
create or replace function public.touch_post_metrics_updated_at()
returns trigger language plpgsql as $$
begin
  if (
    NEW.actual_likes is distinct from OLD.actual_likes or
    NEW.actual_retweets is distinct from OLD.actual_retweets or
    NEW.actual_replies is distinct from OLD.actual_replies or
    NEW.actual_quotes is distinct from OLD.actual_quotes or
    NEW.actual_bookmarks is distinct from OLD.actual_bookmarks or
    NEW.actual_views is distinct from OLD.actual_views or
    NEW.analyst_notes is distinct from OLD.analyst_notes
  ) then
    NEW.metrics_updated_at := now();
  end if;
  return NEW;
end;
$$;

drop trigger if exists post_logs_metrics_touch on public.post_logs;
create trigger post_logs_metrics_touch
  before update on public.post_logs
  for each row execute function public.touch_post_metrics_updated_at();
