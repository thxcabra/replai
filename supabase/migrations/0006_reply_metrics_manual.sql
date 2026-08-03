-- 0006_reply_metrics_manual.sql
-- V4.1.2: campos manuais de engagement por reply pra analista preencher
-- depois (sem precisar scraping). Junto com author_engaged_at_post (booleano
-- ja existente), formam o quadro completo de "essa reply funcionou?".
--
-- Nomenclatura: "actual_" pra distinguir das metricas do tweet original
-- (likeCount etc do RawTweet). Aqui sao metricas da REPLY POSTADA pelo analista.

alter table public.reply_logs
  add column if not exists actual_likes int
    check (actual_likes is null or actual_likes >= 0),
  add column if not exists actual_retweets int
    check (actual_retweets is null or actual_retweets >= 0),
  add column if not exists actual_replies int
    check (actual_replies is null or actual_replies >= 0),
  add column if not exists actual_quotes int
    check (actual_quotes is null or actual_quotes >= 0),
  -- diferente de author_engaged_at_post (sinal capturado no momento do post).
  -- op_replied_back = autor respondeu de volta especificamente (sinal mais forte).
  add column if not exists op_replied_back boolean,
  -- notas livres do analista sobre essa reply (ex: "OP me adicionou de friend",
  -- "virou DM", "ganhou follow do alvo", etc)
  add column if not exists analyst_notes text,
  -- quando o analista preencheu as metricas pela ultima vez (pra UI mostrar
  -- "atualizado ha 3 dias")
  add column if not exists metrics_updated_at timestamptz;

------------------------------------------------------------
-- RLS: precisa adicionar UPDATE policy pro analista poder editar suas
-- proprias linhas de reply_logs. A V4 original tinha so SELECT + INSERT
-- (append-only); agora abrimos UPDATE pras colunas de metricas.
------------------------------------------------------------

drop policy if exists "reply_logs update own metrics" on public.reply_logs;
create policy "reply_logs update own metrics" on public.reply_logs
  for update using (
    (select auth.uid()) is not null
    and user_id = (select auth.uid())
  )
  with check (
    (select auth.uid()) is not null
    and user_id = (select auth.uid())
  );

------------------------------------------------------------
-- Index pra MyRepliesView (lista pelo user logado, ordenada por logged_at desc)
------------------------------------------------------------

create index if not exists idx_reply_logs_user_logged_at
  on public.reply_logs(user_id, logged_at desc);
