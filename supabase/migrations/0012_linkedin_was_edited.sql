-- 0012_linkedin_was_edited.sql
-- Replai V5.1 — was_edited em linkedin_replies (paridade com reply_logs do X).
--
-- Contexto:
--   reply_logs (X) tem was_edited desde V4 pra rastrear se o analista
--   editou o texto do LLM antes de postar. Feedback loop pra evaluar
--   qualidade das replies geradas.
--   linkedin_replies (V5) nao tinha o campo — bug de simetria. V5.1 corrige.
--
-- Idempotente.

alter table public.linkedin_replies
  add column if not exists was_edited boolean not null default false;

comment on column public.linkedin_replies.was_edited is
  'V5.1: true se o texto foi editado pelo analista antes do envio. Comparacao entre reply_text_original (nova coluna) e reply_text final. Paridade com reply_logs.was_edited do X.';

alter table public.linkedin_replies
  add column if not exists reply_text_original text;

comment on column public.linkedin_replies.reply_text_original is
  'V5.1: texto original gerado pelo LLM antes de qualquer edicao do analista. reply_text pode divergir. Usado pra treino/analytics de "o que analista corrige".';
