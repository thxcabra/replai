-- 0005_notion_integration.sql
-- V4.1.1: integration com Notion API pra pull do Watchtower Daily Digest.
-- Token vive em profiles (per-user), encriptado at-rest pelo Supabase EBS
-- como as outras chaves de API. RLS protege (so o proprio user le).

alter table public.profiles
  add column if not exists notion_api_token text;

-- Watchtower page ID por workspace (cada workspace pode apontar pra um
-- page diferente — Marketing usa um, RH outro, etc). Vai no workspaces.config
-- jsonb, nao precisa de coluna nova aqui.
--
-- mas adicionamos um helper view pra observar adocao da feature
create or replace view public.notion_adoption with (security_invoker = true) as
select
  count(*) filter (where notion_api_token is not null) as users_with_token,
  count(*) as total_users
from public.profiles;
