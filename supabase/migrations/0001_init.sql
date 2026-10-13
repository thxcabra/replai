-- Replai V5: schema completo
-- Roda no SQL Editor do Supabase Dashboard (drop + recreate).
--
-- IMPORTANTE: este arquivo assume que vc DROPOU tudo antes de rodar (snippet
-- de drop comentado no final do arquivo). Sem `if not exists` propositalmente
-- pra falhar cedo se houver state stale.
--
-- Convencao:
--   - Toda tabela de dados tem `user_id` referenciando auth.users(id)
--     (exceto profiles, onde id e o proprio auth.users.id).
--   - RLS ligada em tudo, policy padrao `(select auth.uid()) = user_id OR is_admin()`.
--   - Admin pattern: tabela user_roles separada + funcao is_admin() SECURITY
--     DEFINER. Bootstrap manual (insert no SQL editor apos primeiro login).

------------------------------------------------------------
-- 0. helpers genericos
------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

------------------------------------------------------------
-- 1. profiles: 1 linha por usuario autenticado
------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,                        -- vem do Google OAuth (raw_user_meta_data)
  display_name text,                -- override opcional editavel pelo user
  -- chaves de API (RLS + AES-256 at-rest)
  twitterapi_key text,
  gemini_api_key text,
  anthropic_api_key text,
  -- estado da UI cross-device
  active_workspace_id text,
  setup_complete boolean not null default false,
  -- analytics denormalizados (atualizados via trigger)
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  total_replies int not null default 0,
  -- timestamps padrao
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

------------------------------------------------------------
-- 2. user_roles: tabela dedicada de roles (NAO em profiles)
-- Bootstrap manual. RLS abaixo permite admin promover outros.
------------------------------------------------------------
create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'analyst')) default 'analyst',
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now()
);
create index user_roles_role_idx on public.user_roles(role);

------------------------------------------------------------
-- 3. is_admin(): helper SECURITY DEFINER pra RLS
-- Retorna true se o auth.uid() atual e admin. SECURITY DEFINER evita recursao
-- (a funcao roda como o owner e bypassa RLS de user_roles).
------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role = 'admin'
  );
$$;
grant execute on function public.is_admin() to authenticated, anon;

------------------------------------------------------------
-- 4. workspaces: config (sem chaves) + voz por workspace
-- Voz vive em config.voice (jsonb). Versionada via voice_versions abaixo.
------------------------------------------------------------
create table public.workspaces (
  id text primary key,              -- mantem ws_xxxxxx do client
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  -- jsonb com {listId, llm_provider, timeWindowHours, includeUnmapped, model,
  -- langs, maxBatch, dryRun, voice, voice_source}
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workspaces_user_id_idx on public.workspaces(user_id);

------------------------------------------------------------
-- 5. voice_versions: snapshot historico da voz por workspace
-- Pra A/B test: "quando mudei voz X→Y, conv subiu Z%". Dedup por md5.
------------------------------------------------------------
create table public.voice_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  voice_text text not null,
  voice_source text,                -- 'paste' | 'upload: <filename>' | 'upload: <filename> (editado)'
  voice_hash text not null,         -- md5 do voice_text
  version int not null,             -- sequencial por workspace (1, 2, 3...)
  created_at timestamptz not null default now(),
  unique (workspace_id, voice_hash)
);
create index voice_versions_workspace_idx on public.voice_versions(workspace_id, version desc);

------------------------------------------------------------
-- 6. replied_tweets: marker de "ja respondi este tweet"
-- Pra UI esmaecer cards + evitar dupla resposta. Unique por (ws, tweet).
------------------------------------------------------------
create table public.replied_tweets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  tweet_id text not null,
  tweet_author text,
  tweet_text text,
  reply_text text,                  -- texto final (pos-edicao se foi editado)
  reply_category text,
  reply_index integer,              -- 0/1/2 = qual das sugestoes foi usada
  was_edited boolean not null default false,
  posted_confirmed boolean not null default false,  -- "sim" no PostConfirmDialog
  replied_at timestamptz not null default now()
);
create unique index replied_tweets_ws_tweet_idx on public.replied_tweets(workspace_id, tweet_id);
create index replied_tweets_user_replied_at_idx on public.replied_tweets(user_id, replied_at desc);

------------------------------------------------------------
-- 7. session_logs: 1 row por clique em "atualizar"
-- Captura sessoes inteiras (mesmo as que falharam ou foram ignoradas).
-- Pra entender "quantas sessoes tem dropoff" e "qual foi o erro".
------------------------------------------------------------
create table public.session_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null,         -- denormalizado pra queries cross-user
  workspace_id text not null,
  workspace_name text not null,
  -- timing
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  -- fetch phase (TwitterAPI)
  fetch_count int,
  fetch_ms int,
  -- triage phase
  triage_passed int,                -- passaram prefilter
  triage_selected int,              -- liked na triagem
  triage_mode text,                 -- 'list' | 'swipe' | null se nao chegou na triagem
  -- llm phase
  llm_called boolean not null default false,
  llm_provider text,
  llm_model text,
  llm_ms int,
  llm_input_tokens int,
  llm_output_tokens int,
  llm_cost_usd numeric(10,6),
  replies_generated int,
  -- decisao do analista (atualizado conforme ele age)
  replies_clicked int not null default 0,
  replies_posted int not null default 0,
  replies_skipped int not null default 0,
  -- erro (se houver)
  error_type text,                  -- 'twitterapi' | 'llm' | 'rls' | 'unknown'
  error_message text
);
create index session_logs_user_started_idx on public.session_logs(user_id, started_at desc);
create index session_logs_workspace_idx on public.session_logs(workspace_id, started_at desc);
create index session_logs_email_idx on public.session_logs(user_email, started_at desc);

------------------------------------------------------------
-- 8. reply_logs: append-only, contexto rico de CADA reply disparado
-- E a tabela principal pra analytics. 50+ colunas pra cobrir todo angulo.
------------------------------------------------------------
create table public.reply_logs (
  id uuid primary key default gen_random_uuid(),
  -- ownership
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null,
  workspace_id text not null,
  workspace_name text not null,
  session_id uuid references public.session_logs(id) on delete set null,
  -- voice
  voice_version_id uuid references public.voice_versions(id) on delete set null,
  voice_snapshot text,              -- copia inline da voz (defesa: se voice_version sumir)
  -- config snapshot no momento (pra A/B de hyperparams)
  config_snapshot jsonb,            -- {timeWindowHours, maxBatch, includeUnmapped, model, langs}
  -- ---- TWEET ORIGINAL (extensivo) ----
  tweet_id text not null,
  tweet_url text,
  tweet_handle text,
  tweet_text text,
  tweet_lang text,                  -- 'en' | 'pt' | ''
  tweet_isv real,                   -- influence score do grafo (0-100)
  tweet_is_poi smallint,            -- 0/1
  tweet_inferred_layer smallint,    -- 1-5
  -- autor (4)
  tweet_author_followers int,
  tweet_author_is_automated boolean,
  tweet_author_verified boolean,
  tweet_author_display_name text,
  -- timing (2)
  tweet_created_at timestamptz,
  tweet_age_minutes int,            -- minutos entre tweet criado e reply gerada
  -- thread/conversation (7)
  tweet_is_reply boolean,
  tweet_in_reply_to_username text,
  tweet_conversation_id text,
  tweet_is_quote boolean,
  tweet_quoted_handle text,
  tweet_quoted_text text,
  tweet_is_limited_reply boolean,
  tweet_thread_size smallint,       -- quantos tweets na conversation
  -- content meta (6)
  tweet_char_count smallint,
  tweet_has_media boolean,
  tweet_has_links boolean,
  tweet_hashtags text[],
  tweet_mentions text[],
  tweet_emoji_count smallint,
  -- ---- REPLY GERADA + ESCOLHIDA ----
  reply_text text not null,         -- texto final (com edits do analista)
  reply_text_original text,         -- o que o LLM gerou (sem edits)
  reply_category text,              -- dado_concreto, experiencia_builder, etc
  reply_pattern smallint,           -- ID do padrao da skill
  reply_pattern_label text,
  reply_index integer,              -- 0/1/2 = qual das 3 sugestoes foi clicada
  all_candidates jsonb,             -- todas as 3 [{text, category}]
  -- ---- DECISAO + ANALYTICS ----
  was_edited boolean not null default false,
  posted_confirmed boolean,         -- null=sem-decisao | true=postou | false=descartou
  posted_at timestamptz,            -- quando posted_confirmed=true foi clicado
  posted_reply_id text,             -- ID do tweet da reply postada no X (opcional, capturado no dialog)
  decision text check (decision in ('posted','skipped','edited_only','ignored')),
  time_to_decide_ms integer,
  -- llm meta (4)
  llm_provider text,
  llm_model text,
  llm_input_tokens int,
  llm_output_tokens int,
  llm_cost_usd numeric(10,6),
  -- timestamps
  logged_at timestamptz not null default now()
);
create index reply_logs_user_workspace_idx on public.reply_logs(user_id, workspace_id, logged_at desc);
create index reply_logs_workspace_idx on public.reply_logs(workspace_id, logged_at desc);
create index reply_logs_email_idx on public.reply_logs(user_email, logged_at desc);
create index reply_logs_category_decision_idx on public.reply_logs(reply_category, decision);
create index reply_logs_pattern_decision_idx on public.reply_logs(reply_pattern, decision);
create index reply_logs_session_idx on public.reply_logs(session_id);
create index reply_logs_voice_version_idx on public.reply_logs(voice_version_id);
create index reply_logs_tweet_conv_idx on public.reply_logs(tweet_conversation_id);
create index reply_logs_posted_reply_id_idx on public.reply_logs(posted_reply_id)
  where posted_reply_id is not null;

------------------------------------------------------------
-- 9. events: telemetria generica (operational, nao analytics-first)
-- Mantido pra back-compat + dashboard de uso (session_started, llm_called, etc).
------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id text references public.workspaces(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  ts timestamptz not null default now()
);
create index events_user_ts_idx on public.events(user_id, ts desc);
create index events_user_type_ts_idx on public.events(user_id, type, ts desc);

------------------------------------------------------------
-- 10. triggers
------------------------------------------------------------
create trigger profiles_touch_updated_at before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger workspaces_touch_updated_at before update on public.workspaces
  for each row execute function public.touch_updated_at();

-- Trigger: ao inserir reply_log com decision='posted', atualiza profile totals
create or replace function public.bump_profile_replies()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if NEW.decision = 'posted' then
    update public.profiles
    set total_replies = total_replies + 1,
        last_seen_at = now()
    where id = NEW.user_id;
  else
    -- mesmo se nao postou, marca atividade
    update public.profiles
    set last_seen_at = now()
    where id = NEW.user_id;
  end if;
  return NEW;
end;
$$;
create trigger reply_logs_bump_profile after insert on public.reply_logs
  for each row execute function public.bump_profile_replies();

------------------------------------------------------------
-- 11. RLS: liga em tudo
------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.workspaces enable row level security;
alter table public.voice_versions enable row level security;
alter table public.replied_tweets enable row level security;
alter table public.session_logs enable row level security;
alter table public.reply_logs enable row level security;
alter table public.events enable row level security;

------------------------------------------------------------
-- 12. RLS policies: user normal ve so o proprio, admin ve tudo
------------------------------------------------------------

-- profiles
create policy "profiles select own or admin" on public.profiles
  for select using ((select auth.uid()) = id or public.is_admin());
create policy "profiles insert own" on public.profiles
  for insert with check ((select auth.uid()) = id);
create policy "profiles update own or admin" on public.profiles
  for update using ((select auth.uid()) = id or public.is_admin())
  with check ((select auth.uid()) = id or public.is_admin());
create policy "profiles delete own" on public.profiles
  for delete using ((select auth.uid()) = id);

-- user_roles: todos veem o proprio + admin ve tudo; SO admin escreve
create policy "user_roles select own or admin" on public.user_roles
  for select using ((select auth.uid()) = user_id or public.is_admin());
create policy "user_roles admin write" on public.user_roles
  for all using (public.is_admin())
  with check (public.is_admin());

-- workspaces
create policy "workspaces select own or admin" on public.workspaces
  for select using ((select auth.uid()) = user_id or public.is_admin());
create policy "workspaces insert own" on public.workspaces
  for insert with check ((select auth.uid()) = user_id);
create policy "workspaces update own or admin" on public.workspaces
  for update using ((select auth.uid()) = user_id or public.is_admin())
  with check ((select auth.uid()) = user_id or public.is_admin());
create policy "workspaces delete own or admin" on public.workspaces
  for delete using ((select auth.uid()) = user_id or public.is_admin());

-- voice_versions
create policy "voice_versions select own or admin" on public.voice_versions
  for select using ((select auth.uid()) = user_id or public.is_admin());
create policy "voice_versions insert own" on public.voice_versions
  for insert with check ((select auth.uid()) = user_id);
-- update/delete: append-only por design, ninguem mexe

-- replied_tweets
create policy "replied select own or admin" on public.replied_tweets
  for select using ((select auth.uid()) = user_id or public.is_admin());
create policy "replied insert own" on public.replied_tweets
  for insert with check ((select auth.uid()) = user_id);
create policy "replied update own" on public.replied_tweets
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "replied delete own" on public.replied_tweets
  for delete using ((select auth.uid()) = user_id);

-- session_logs (append + update do proprio user)
create policy "session_logs select own or admin" on public.session_logs
  for select using ((select auth.uid()) = user_id or public.is_admin());
create policy "session_logs insert own" on public.session_logs
  for insert with check ((select auth.uid()) = user_id);
create policy "session_logs update own" on public.session_logs
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- reply_logs (append-only)
create policy "reply_logs select own or admin" on public.reply_logs
  for select using ((select auth.uid()) = user_id or public.is_admin());
create policy "reply_logs insert own" on public.reply_logs
  for insert with check ((select auth.uid()) = user_id);

-- events (append-only)
create policy "events select own or admin" on public.events
  for select using ((select auth.uid()) = user_id or public.is_admin());
create policy "events insert own" on public.events
  for insert with check ((select auth.uid()) = user_id);

------------------------------------------------------------
-- 13. handle_new_user: cria profile + analyst role + valida dominio
------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  user_email text;
begin
  user_email := coalesce(NEW.email, '');

  -- whitelist de dominio @moicdigital.* (case-insensitive).
  if user_email !~* '@moicdigital\.' then
    raise exception 'Acesso restrito ao dominio @moicdigital. Email: %', user_email
      using errcode = 'P0001';
  end if;

  -- cria profile. Name fallback: Google name -> email prefix (parte antes do @).
  -- "you@example.com" vira "you" se Google nao retornar name.
  insert into public.profiles (id, email, name)
  values (
    NEW.id,
    user_email,
    coalesce(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(user_email, '@', 1)
    )
  )
  on conflict (id) do nothing;

  -- cria role default 'analyst'
  insert into public.user_roles (user_id, role)
  values (NEW.id, 'analyst')
  on conflict (user_id) do nothing;

  return NEW;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

------------------------------------------------------------
-- 14. admin_overview view: agregado por user pra Dashboard admin
-- Admin pode select * from admin_overview; RLS aplica (so admin ve todos).
------------------------------------------------------------
create or replace view public.admin_overview
with (security_invoker = true)  -- respeita RLS do caller
as
select
  p.id as user_id,
  p.email as user_email,
  coalesce(p.display_name, p.name) as display_name,
  coalesce(ur.role, 'analyst') as role,
  p.first_seen_at,
  p.last_seen_at,
  p.total_replies,
  -- agg de reply_logs
  (select count(*) from public.reply_logs rl where rl.user_id = p.id) as replies_total,
  (select count(*) from public.reply_logs rl where rl.user_id = p.id and rl.decision = 'posted') as replies_posted,
  (select count(*) from public.reply_logs rl where rl.user_id = p.id and rl.decision = 'skipped') as replies_skipped,
  (select count(*) from public.reply_logs rl where rl.user_id = p.id and rl.logged_at > now() - interval '7 days') as replies_last_7d,
  -- workspaces count
  (select count(*) from public.workspaces w where w.user_id = p.id) as workspaces_count,
  -- custo total LLM
  (select coalesce(sum(llm_cost_usd), 0) from public.session_logs sl where sl.user_id = p.id) as total_cost_usd
from public.profiles p
left join public.user_roles ur on ur.user_id = p.id;
grant select on public.admin_overview to authenticated;

------------------------------------------------------------
-- 15. BOOTSTRAP do primeiro admin (rode manualmente APOS primeiro login)
------------------------------------------------------------
-- Apos o owner logar com Google pela primeira vez via extension,
-- rode esta query (descomente):
--
-- insert into public.user_roles (user_id, role)
-- select id, 'admin' from auth.users where email = 'you@example.com'
-- on conflict (user_id) do update set role = 'admin', granted_at = now();

------------------------------------------------------------
-- DROP SNIPPET (rode antes deste arquivo, pra resetar):
-- ORDEM IMPORTANTE: tabelas primeiro (cascade derruba triggers/policies),
-- depois view, depois trigger em auth.users, e por ultimo functions.
-- Functions tem triggers dependentes em outras tabelas - dropa por ultimo.
------------------------------------------------------------
-- drop table if exists public.reply_logs cascade;
-- drop table if exists public.session_logs cascade;
-- drop table if exists public.events cascade;
-- drop table if exists public.replied_tweets cascade;
-- drop table if exists public.voice_versions cascade;
-- drop table if exists public.workspaces cascade;
-- drop table if exists public.user_roles cascade;
-- drop table if exists public.profiles cascade;
-- drop view if exists public.admin_overview;
-- drop trigger if exists on_auth_user_created on auth.users;
-- drop function if exists public.handle_new_user();
-- drop function if exists public.bump_profile_replies();
-- drop function if exists public.is_admin();
-- drop function if exists public.touch_updated_at();
