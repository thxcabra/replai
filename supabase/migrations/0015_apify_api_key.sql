-- V5.3 — APIFY api key opcional por profile.
--
-- Contexto: o APIFY_TOKEN ate agora vive so em Supabase secrets (edge function
-- apify-fetch le via Deno.env.get). Isso facilita governanca mas engessa —
-- pra trocar precisa redeploy/secret rotation.
--
-- Este migration adiciona `apify_api_key` no profile do usuario (same padrao
-- de gemini_api_key + notion_api_token). Client pode setar/trocar via
-- Settings > Chaves API. A edge function apify-fetch passa a aceitar
-- `apify_token` opcional no request body — se presente, usa ela; senao,
-- fallback pro secret server-side (retro-compat).
--
-- RLS: profiles ja tem "user pode ver/atualizar so o proprio profile" (0002),
-- e a coluna vira campo textual do mesmo record — herda a policy existente.

alter table public.profiles
  add column if not exists apify_api_key text;

comment on column public.profiles.apify_api_key is
  'APIFY token pessoal (opcional). Se preenchido, apify-fetch usa esta chave em vez do secret server-side. Editavel via Settings > Chaves API.';
