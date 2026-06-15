# Admin role + Analytics SQL — Replai

Guia pra gerenciar role admin (bootstrap, fix users, promover/revogar) + queries SQL pra explorar dados de uso, sessoes, voice versions, custo LLM, conversao por categoria/voz/tweet.

> Tudo aqui roda no **SQL Editor do Supabase Dashboard** (usa `service_role`, bypassa RLS — voce ve TUDO).

---

# Admin role

## Bootstrap primeiro admin

Apos o owner logar via Google na extension (cria profile + user_roles automaticamente com role `analyst`):

```sql
update public.user_roles
set role = 'admin', granted_at = now()
where user_id = (
  select id from auth.users where email = 'you@example.com'
);
```

Substitui o email pelo seu. Confere:

```sql
select u.email, ur.role, ur.granted_at
from auth.users u
join public.user_roles ur on ur.user_id = u.id
where ur.role = 'admin';
```

Apos isso, esse user ve a aba "admin" no Header (cache TTL 5min — pra forcar refresh: DevTools → Application → Local Storage → deleta `is_admin_cached`).

## Promover/revogar via UI

A partir do segundo admin, da pra fazer pela UI: Header → admin → analistas → click no card → "promover a admin"/"revogar admin".

## Backfill: users sem profile/role

Acontece quando trigger `handle_new_user` foi recriado depois do user ja existir em `auth.users`. Fix:

```sql
-- 1. Cria profile pra todos auth.users sem profile
insert into public.profiles (id, email, name)
select u.id, u.email, split_part(u.email, '@', 1)
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null and u.email is not null;

-- 2. Cria user_roles pra todos sem role
insert into public.user_roles (user_id, role)
select u.id, 'analyst'
from auth.users u
left join public.user_roles ur on ur.user_id = u.id
where ur.user_id is null;

-- 3. Confere
select u.email, p.name, ur.role, p.total_replies
from auth.users u
left join public.profiles p on p.id = u.id
left join public.user_roles ur on ur.user_id = u.id
order by u.created_at desc;
```

## Auditoria de promocoes

```sql
select target.email as promovido,
       granter.email as por,
       ur.granted_at,
       ur.role
from public.user_roles ur
join auth.users target on target.id = ur.user_id
left join auth.users granter on granter.id = ur.granted_by
order by ur.granted_at desc;
```

---

# Queries de analytics

## Atividade do time

### Replies por analista (30d)

```sql
select user_email,
       count(*) as replies_total,
       count(*) filter (where decision = 'posted') as posted,
       count(*) filter (where decision = 'skipped') as skipped,
       count(*) filter (where posted_reply_id is not null) as verified,
       max(logged_at) as ultima_atividade
from public.reply_logs
where logged_at > now() - interval '30 days'
group by user_email
order by replies_total desc;
```

### Replies por dia (todo o time, 14d)

```sql
select date(logged_at) as dia,
       count(*) as replies,
       sum(case when decision = 'posted' then 1 else 0 end) as posted
from public.reply_logs
where logged_at > now() - interval '14 days'
group by dia
order by dia desc;
```

### "Verificadas" (com URL) vs auto-reported

Replies com `posted_reply_id` populado = analista colou URL da reply postada (sinal mais forte que so dizer "sim postei"):

```sql
select user_email,
       count(*) filter (where decision = 'posted') as posted_total,
       count(*) filter (where posted_reply_id is not null) as verified,
       round(100.0 * count(*) filter (where posted_reply_id is not null) /
             nullif(count(*) filter (where decision = 'posted'), 0), 1) as verified_pct
from public.reply_logs
group by user_email
order by verified_pct desc nulls last;
```

## Categorias / patterns

### Top categorias por conversao

```sql
select reply_category,
       count(*) as total,
       sum(case when decision = 'posted' then 1 else 0 end) as posted,
       round(100.0 * sum(case when decision = 'posted' then 1 else 0 end) / count(*), 1) as conv_pct
from public.reply_logs
where reply_category is not null
group by reply_category
order by conv_pct desc;
```

### Pattern da skill mais usado

```sql
select reply_pattern, reply_pattern_label,
       count(*) as gerados,
       sum(case when decision = 'posted' then 1 else 0 end) as postados
from public.reply_logs
group by reply_pattern, reply_pattern_label
order by gerados desc;
```

## Tweet meta — o que converte

### Tweets com media

```sql
select tweet_has_media,
       count(*) as total,
       round(100.0 * sum(case when decision = 'posted' then 1 else 0 end) / count(*), 1) as conv_pct
from public.reply_logs
where tweet_has_media is not null
group by tweet_has_media;
```

### Fresh tweets convertem mais?

```sql
select case
         when tweet_age_minutes < 30 then 'super fresh (<30min)'
         when tweet_age_minutes < 120 then 'fresh (30-120min)'
         when tweet_age_minutes < 360 then 'normal (2-6h)'
         else 'old (>6h)'
       end as recency,
       count(*) as total,
       round(100.0 * sum(case when decision = 'posted' then 1 else 0 end) / count(*), 1) as conv_pct
from public.reply_logs
where tweet_age_minutes is not null
group by recency
order by recency;
```

### Autores com mais followers convertem mais?

```sql
select case
         when tweet_author_followers > 50000 then 'big (>50k)'
         when tweet_author_followers > 5000 then 'mid (5-50k)'
         else 'small (<5k)'
       end as tier,
       count(*) as total,
       round(100.0 * sum(case when decision = 'posted' then 1 else 0 end) / count(*), 1) as conv_pct
from public.reply_logs
where tweet_author_followers is not null
group by tier;
```

### Threads onde varios analistas responderam (cross-team learning)

```sql
select tweet_conversation_id,
       count(distinct user_email) as analysts,
       array_agg(distinct user_email) as quem
from public.reply_logs
where tweet_conversation_id is not null
group by tweet_conversation_id
having count(distinct user_email) > 1;
```

## Tempo + tomada de decisao

### Tempo medio de decisao por analista

```sql
select user_email,
       count(*) as decisions,
       round(avg(time_to_decide_ms) / 1000.0, 1) as avg_seconds
from public.reply_logs
where time_to_decide_ms is not null
group by user_email
order by avg_seconds;
```

### Tempo medio entre LLM gerar e analista decidir, por categoria

```sql
select reply_category,
       count(*) as n,
       round(avg(time_to_decide_ms) / 1000.0, 1) as avg_s
from public.reply_logs
where time_to_decide_ms is not null
group by reply_category
order by avg_s desc;
```

---

# Voice versions — A/B test

`voice_versions` guarda historico imutavel da voz por workspace (dedup por hash SHA-256). Cada save em Settings ou via upload `.md`/`.pdf`/`.txt` gera uma row se o conteudo for novo.

Cada `reply_logs.voice_version_id` aponta pro snapshot da voz que gerou aquele reply — permite A/B test cirurgico.

## Conversao por versao de voz

```sql
select w.name as workspace,
       v.version,
       substring(v.voice_text, 1, 80) as voice_preview,
       count(rl.*) as replies,
       sum(case when rl.decision = 'posted' then 1 else 0 end) as posted,
       round(100.0 * sum(case when rl.decision = 'posted' then 1 else 0 end) / nullif(count(rl.*), 0), 1) as conv_pct
from public.voice_versions v
join public.workspaces w on w.id = v.workspace_id
left join public.reply_logs rl on rl.voice_version_id = v.id
group by w.name, v.id, v.version, v.voice_text
order by w.name, v.version;
```

## Compara duas versoes especificas

```sql
with v1 as (
  select count(*) as total,
         count(*) filter (where decision = 'posted') as posted,
         count(*) filter (where decision = 'skipped') as skipped,
         avg(time_to_decide_ms) as avg_decide_ms
  from public.reply_logs
  where voice_version_id = '<uuid-v1>'
),
v2 as (
  select count(*) as total,
         count(*) filter (where decision = 'posted') as posted,
         count(*) filter (where decision = 'skipped') as skipped,
         avg(time_to_decide_ms) as avg_decide_ms
  from public.reply_logs
  where voice_version_id = '<uuid-v2>'
)
select 'v1' as version, * from v1
union all
select 'v2', * from v2;
```

## Historico de mudancas de voz por workspace

```sql
select v.version,
       v.voice_source,
       length(v.voice_text) as chars,
       v.created_at
from public.voice_versions v
join public.workspaces w on w.id = v.workspace_id
where w.name = 'NomeDoWorkspace'
order by v.version;
```

---

# Session logs — funil + erros + custo

`session_logs` tem 1 row por clique em "atualizar". Captura sessoes INTEIRAS, inclusive as que falharam ou foram ignoradas. Liga em `reply_logs.session_id`.

Writes via [`session-tracking.ts`](../src/lib/session-tracking.ts) em pontos especificos do orchestrator (`startSession`, `recordFetch`, `recordTriage`, `recordLLM`, `recordError`, `bumpClicked/Posted/Skipped`).

## Funil de drop-off

Onde os analistas param?

```sql
select
  count(*) as sessions,
  sum(case when fetch_count > 0 then 1 else 0 end) as fetched,
  sum(case when triage_passed > 0 then 1 else 0 end) as had_passed,
  sum(case when triage_selected > 0 then 1 else 0 end) as user_selected,
  sum(case when llm_called then 1 else 0 end) as llm_called,
  sum(case when replies_posted > 0 then 1 else 0 end) as posted_something
from public.session_logs
where started_at > now() - interval '7 days';
```

## Custo LLM por workspace (mes)

```sql
select workspace_name,
       sum(llm_input_tokens) as input,
       sum(llm_output_tokens) as output,
       round(sum(llm_cost_usd)::numeric, 4) as cost_usd
from public.session_logs
where started_at > date_trunc('month', now())
  and llm_called
group by workspace_name
order by cost_usd desc;
```

## Custo LLM por analista (mes)

```sql
select user_email,
       count(*) as sessoes,
       sum(llm_input_tokens) as input_tokens,
       sum(llm_output_tokens) as output_tokens,
       round(sum(llm_cost_usd)::numeric, 4) as cost_usd
from public.session_logs
where started_at > date_trunc('month', now())
group by user_email
order by cost_usd desc;
```

## Modo swipe vs lista — qual o time prefere?

```sql
select triage_mode, count(*) as sessions,
       round(avg(triage_selected::float / nullif(triage_passed, 0)) * 100, 1) as pct_selecionados
from public.session_logs
where triage_mode is not null
group by triage_mode;
```

## Sessoes que falharam

```sql
select user_email, workspace_name, error_type, error_message, started_at
from public.session_logs
where error_type is not null
order by started_at desc
limit 20;
```

## Erros mais comuns

```sql
select error_type, count(*), max(error_message) as exemplo
from public.session_logs
where error_type is not null
  and started_at > now() - interval '14 days'
group by error_type
order by count(*) desc;
```

## Sessoes sem LLM (dropout pre-LLM)

Voce fez fetch + triagem mas nao chamou LLM. Sinal de "analista nao gostou de nada" ou "fetch retornou pouco/nada":

```sql
select user_email, workspace_name, fetch_count, triage_passed, triage_selected, started_at
from public.session_logs
where llm_called = false
  and started_at > now() - interval '7 days'
order by started_at desc;
```

---

# Export rapido

UI cobre o caso comum (Admin panel → exportar → escolhe tabela + filtros → baixa CSV/JSON ate 50k linhas).

Pra volumes maiores ou queries customizadas, use o SQL Editor:
- Roda a query
- Botao "Download" no canto inferior direito da query → CSV
- Funciona ate ~100k linhas. Pra mais, use `COPY ... TO STDOUT` ou Edge Function.
