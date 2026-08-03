-- 0008_workspace_id_cleanup.sql
-- Fix V4.1.15: o cliente pre-V4.1.15 usava o literal "ws_default" como
-- fallback PK em 3 lugares (migration V2, getActiveWorkspace, deleteWorkspace).
-- Resultado: dois analistas que criavam o primeiro workspace acabavam com
-- o mesmo PK "ws_default" — o segundo push batia em RLS USING expression
-- (UPDATE proibido porque user_id divergia).
--
-- O fix no cliente: cada user gera seu proprio newWorkspaceId() unico.
-- Este SQL: (1) adiciona ON UPDATE CASCADE em todos os FK que referenciam
-- workspaces.id (faltava no 0001 + 0007 originais), (2) renomeia ws_default
-- existentes — agora o UPDATE cascateia pras tabelas filhas, (3) atualiza
-- profile.active_workspace_id.
--
-- Pos-aplicacao, o cliente V4.1.15 (apos pullAll) ve o novo id e atualiza
-- chrome.storage local automaticamente.

-- 1. Recria FKs com ON UPDATE CASCADE (default era NO ACTION = bloqueia UPDATE)
alter table public.voice_versions
  drop constraint if exists voice_versions_workspace_id_fkey,
  add constraint voice_versions_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id)
    on update cascade on delete cascade;

alter table public.replied_tweets
  drop constraint if exists replied_tweets_workspace_id_fkey,
  add constraint replied_tweets_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id)
    on update cascade on delete cascade;

alter table public.events
  drop constraint if exists events_workspace_id_fkey,
  add constraint events_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id)
    on update cascade on delete cascade;

alter table public.post_logs
  drop constraint if exists post_logs_workspace_id_fkey,
  add constraint post_logs_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id)
    on update cascade on delete cascade;

-- session_logs e reply_logs nao tem FK direta pro workspaces.id (so user_id),
-- mas se ja tiver coluna workspace_id como FK, padroniza tambem
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'session_logs_workspace_id_fkey'
      and table_schema = 'public'
  ) then
    execute 'alter table public.session_logs
      drop constraint session_logs_workspace_id_fkey,
      add constraint session_logs_workspace_id_fkey
        foreign key (workspace_id) references public.workspaces(id)
        on update cascade on delete cascade';
  end if;
  if exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'reply_logs_workspace_id_fkey'
      and table_schema = 'public'
  ) then
    execute 'alter table public.reply_logs
      drop constraint reply_logs_workspace_id_fkey,
      add constraint reply_logs_workspace_id_fkey
        foreign key (workspace_id) references public.workspaces(id)
        on update cascade on delete cascade';
  end if;
end $$;

-- 2. Renomeia cada ws_default existente — agora cascateia
update public.workspaces
set id = 'ws_' || substr(md5(random()::text || user_id::text), 1, 6)
where id = 'ws_default';

-- 3. Atualiza profile.active_workspace_id se apontava pro ws_default
-- (escolhe o workspace mais antigo do user como novo ativo)
update public.profiles
set active_workspace_id = (
  select w.id from public.workspaces w
  where w.user_id = profiles.id
  order by w.created_at asc
  limit 1
)
where active_workspace_id = 'ws_default';

-- 4. Sanity check — nao deve restar nenhum ws_default
do $$
declare
  remaining int;
begin
  select count(*) into remaining from public.workspaces where id = 'ws_default';
  if remaining > 0 then
    raise exception 'Cleanup falhou: ainda existem % rows com id=ws_default', remaining;
  end if;
end $$;
