# Arquitetura — Replai V4

Side panel (Preact + Tailwind v4) + service worker + Supabase (Postgres + Auth + RLS) + LLM providers (Gemini/Anthropic) + TwitterAPI.io. Login via Google OAuth restrito ao dominio `@moicdigital`.

## Diagrama

```
┌───────────────────────────────────────────────────────────────────────┐
│ Chrome Extension (MV3)                                                 │
│                                                                         │
│  ┌──────────────────────────────────┐    ┌──────────────────────────┐ │
│  │ Side Panel (Preact + Tailwind)   │    │ Service Worker (BG)      │ │
│  │ - SetupWizard / Header / Triage  │←──→│ - chrome.alarms 15min    │ │
│  │ - TweetCard / ReplyCard / Dialog │    │ - pullAll polling        │ │
│  │ - Settings / Dashboard / Admin   │    │ - onAuthChange handler   │ │
│  └──────────────────────────────────┘    └──────────────────────────┘ │
│         │                                                               │
│         └─→ chrome.storage.local (cache + Supabase session)            │
└───────────────────────────────────────────────────────────────────────┘
                                  │
                                  ↓ HTTPS
        ┌─────────────────────────┴──────────────────────────┐
        ↓                                                     ↓
┌──────────────────────────┐                ┌──────────────────────────┐
│ TwitterAPI.io            │                │ LLM Provider             │
│ - GET /list/tweets       │                │ - Gemini 2.5 Flash       │
│ - GET /tweets?ids=       │                │ - Anthropic Claude 4.x   │
└──────────────────────────┘                └──────────────────────────┘
                                                          ↑
                                  ┌───────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────┐
│ Supabase                                                              │
│   profiles · user_roles · workspaces · voice_versions ·               │
│   replied_tweets · session_logs · reply_logs · events                 │
│   + RLS (auth.uid = user_id OR is_admin()) + Google OAuth Internal    │
└──────────────────────────────────────────────────────────────────────┘
```

## Fluxo principal: "Atualizar" → Reply postado

1. **User clica "atualizar"** ([App.tsx](../src/sidepanel/App.tsx) `handleRefresh`)
2. **runTriage** ([orchestrator.ts](../src/lib/orchestrator.ts)):
   - cria row em `session_logs` (`startSession`)
   - fetch tweets da Lista do X (TwitterAPI.io)
   - enriquece replies com parent tweet
   - prefilter (janela tempo, lang, retweet, sem texto, automated, grafo)
   - devolve queue pra triagem
3. **TriageView** ([TriageView.tsx](../src/sidepanel/components/TriageView.tsx)) — modo swipe (default) ou lista; analista like/skip
4. **"gerar replies"** → **generateRepliesForSelected**:
   - chama LLM so com tweets selecionados
   - parseia output (categoria + 3 replies por tweet)
   - registra tokens + cost em `session_logs`
5. **User clica "responder"** numa ReplyCard → abre `intent/post` do X em nova aba
6. **PostConfirmDialog** ([PostConfirmDialog.tsx](../src/sidepanel/components/PostConfirmDialog.tsx)):
   - "sim postei" → user opcionalmente cola URL da reply (badge "verificada")
   - escreve `reply_logs` com 50+ colunas (tweet meta, voice snapshot, candidates, decision, custo, posted_reply_id)

## Sync entre devices

- **Cloud-first writes**: cada save → push Supabase + atualiza cache local
- **Cache-first reads**: UI le de `chrome.storage.local` (fast)
- **Background polling**: `chrome.alarms` 15min → `pullAll()`
- **Login**: `chrome.identity.launchWebAuthFlow` + Supabase OAuth code exchange. Session persiste via `chromeStorageAdapter`
- **Logout**: `clearSyncedState()` apaga local cache (profile, workspaces, active)

Chaves de API vivem so em `profiles.{twitterapi,gemini,anthropic}_api_key`. Workspaces (jsonb config) NUNCA tem chaves — protege contra leak via export.

## Critical files

| Concern | Path |
|---|---|
| Roteamento de views | [src/sidepanel/App.tsx](../src/sidepanel/App.tsx) |
| Storage local + sync cloud | [src/lib/storage.ts](../src/lib/storage.ts) |
| Pipeline fetch+LLM | [src/lib/orchestrator.ts](../src/lib/orchestrator.ts) |
| Supabase client | [src/lib/supabase.ts](../src/lib/supabase.ts) |
| Schema das tabelas | [supabase/migrations/0001_init.sql](../supabase/migrations/0001_init.sql) |
| Auth flow | [src/lib/auth.ts](../src/lib/auth.ts) |
| Admin API | [src/lib/admin.ts](../src/lib/admin.ts) |
| LLM providers | [src/lib/llm.ts](../src/lib/llm.ts), [anthropic.ts](../src/lib/anthropic.ts), [gemini.ts](../src/lib/gemini.ts) |
| Skill prompt + voz | [src/lib/skill-prompt.ts](../src/lib/skill-prompt.ts), [src/assets/SKILL.md](../src/assets/SKILL.md) |
| UI primitives | [src/sidepanel/ui/](../src/sidepanel/ui/) |
| Manifest config | [manifest.config.ts](../manifest.config.ts) |

---

# Schema das tabelas

Source of truth e [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql). Esta secao explica o **proposito** de cada coluna.

## Convencoes

- Toda tabela tem `user_id` → `auth.users(id) on delete cascade` (exceto `profiles` onde `id` ja e o `auth.users.id`)
- RLS ligada em tudo. Policy padrao: `(select auth.uid()) = user_id OR public.is_admin()`
- Helpers: `is_admin()` (SECURITY DEFINER), `touch_updated_at()` (trigger), `handle_new_user()` (em `auth.users`), `bump_profile_replies()` (em `reply_logs`)

## `profiles` — 1 row por user autenticado

Source of truth pra chaves API + estado UI cross-device.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | = `auth.users.id` |
| `email` | text NOT NULL | denormalizado de auth.users |
| `name` | text | de Google `full_name`, fallback pra prefix do email |
| `display_name` | text | override editavel pelo user |
| `twitterapi_key`, `gemini_api_key`, `anthropic_api_key` | text | encrypted at-rest (AES-256 EBS) |
| `active_workspace_id` | text | workspace ativo cross-device |
| `setup_complete` | bool | true apos passar SetupWizard |
| `first_seen_at`, `last_seen_at`, `total_replies` | analytics denormalizados | bump via trigger em insert em reply_logs |

## `user_roles` — admin vs analyst

Tabela dedicada (nao coluna em profiles) pra evitar recursao em policies RLS.

| Coluna | Tipo | Notas |
|---|---|---|
| `user_id` | uuid PK | ref auth.users |
| `role` | text | check IN ('admin','analyst'), default 'analyst' |
| `granted_by` | uuid | audit trail (quem promoveu) |
| `granted_at` | timestamptz | |

Bootstrap manual via SQL Editor — ver [ADMIN.md](./ADMIN.md).

## `workspaces` — config + voz

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | text PK | `ws_xxxxxx` (gerado no client) |
| `user_id` | uuid | dono |
| `name` | text | |
| `config` | jsonb | `{listId, llm_provider, timeWindowHours, includeUnmapped, model, langs, maxBatch, dryRun, voice, voice_source, twitter_handle}` |

Chaves API NUNCA aqui (so profile).

## `voice_versions` — historico imutavel de voz

Pra A/B test: "voz X→Y mudou conversao?". Dedup por hash SHA-256.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `workspace_id` | text | FK |
| `voice_text`, `voice_source`, `voice_hash` | text | unique (workspace_id, voice_hash) |
| `version` | int | sequencial por workspace |

Saves rolam em [`storage.ts saveWorkspace`](../src/lib/storage.ts) → `saveVoiceVersion` (idempotente). Reply logs apontam pra `voice_version_id` da voz vigente no momento.

## `replied_tweets` — marker "ja respondi?"

UI state simples (esmaece card + evita dupla resposta). Unique (workspace_id, tweet_id).

| Coluna | Tipo |
|---|---|
| `id`, `user_id`, `workspace_id`, `tweet_id` | identifiers |
| `tweet_author`, `tweet_text`, `reply_text`, `reply_category` | text |
| `reply_index` | int 0/1/2 |
| `was_edited`, `posted_confirmed` | bool |
| `replied_at` | timestamptz |

Pra analytics serio, use `reply_logs`.

## `session_logs` — 1 row por "atualizar"

Captura sessoes INTEIRAS, inclusive falhas. Pra debug + analytics de funil.

| Grupo | Colunas |
|---|---|
| Ownership | `user_id`, `user_email`, `workspace_id/name` |
| Timing | `started_at`, `ended_at` |
| Fetch (TwitterAPI) | `fetch_count`, `fetch_ms` |
| Triage | `triage_passed`, `triage_selected`, `triage_mode` (`list`/`swipe`) |
| LLM | `llm_called`, `llm_provider`, `llm_model`, `llm_ms`, `llm_input_tokens`, `llm_output_tokens`, `llm_cost_usd`, `replies_generated` |
| Counters | `replies_clicked`, `replies_posted`, `replies_skipped` (bump conforme analista age) |
| Erro | `error_type` (`twitterapi`/`llm`/`rls`/`unknown`), `error_message` |

Writes via [`session-tracking.ts`](../src/lib/session-tracking.ts): `startSession`, `recordFetch`, `recordTriage`, `recordLLM`, `recordError`, `bumpClicked/Posted/Skipped`.

## `reply_logs` — analytics rico (50+ colunas)

Append-only. **Tabela principal pra entender o que funciona.**

| Grupo | Colunas |
|---|---|
| Ownership | `user_id`, `user_email`, `workspace_id/name` |
| Liga | `session_id` (FK), `voice_version_id` (FK), `voice_snapshot` (inline backup) |
| Config snapshot | `config_snapshot` (jsonb com hyperparams no momento) |
| Tweet basico | `tweet_id/url/handle/text/lang/isv/is_poi/inferred_layer` |
| Tweet autor | `followers`, `is_automated`, `verified`, `display_name` |
| Tweet timing | `created_at`, `age_minutes` |
| Tweet thread | `is_reply`, `in_reply_to_username`, `conversation_id`, `is_quote`, `quoted_handle/text`, `is_limited_reply`, `thread_size` |
| Tweet content | `char_count`, `has_media`, `has_links`, `hashtags[]`, `mentions[]`, `emoji_count` |
| Reply | `reply_text` (final), `reply_text_original` (LLM raw), `category`, `pattern`, `index`, `all_candidates` (jsonb das 3) |
| Decision | `was_edited`, `posted_confirmed`, `posted_at`, `posted_reply_id`, `decision` (`posted`/`skipped`/`edited_only`/`ignored`), `time_to_decide_ms` |
| LLM meta | `provider`, `model`, `input_tokens`, `output_tokens`, `cost_usd` |

Writes em [`sync.ts pushReplyLog`](../src/lib/sync.ts) chamado de App.tsx (`handleConfirmPosted`, `handleSkipPost`). Helpers de extracao de tweet meta em [`tweet-meta.ts`](../src/lib/tweet-meta.ts).

Indexes: (user_id, workspace_id, logged_at), category+decision, pattern+decision, session_id, voice_version_id, tweet_conversation_id, posted_reply_id (partial).

## `events` — telemetria operacional

Generica, sanitized (sem chaves no payload).

| Coluna | Tipo |
|---|---|
| `id`, `user_id`, `workspace_id` (nullable), `ts` | |
| `type` | text — `session_started`, `tweets_fetched`, `llm_called`, `reply_clicked`, `reply_edited`, `post_confirmed`, `post_skipped`, `workspace_created`, etc |
| `payload` | jsonb — sanitized (strip keys/secrets/tokens) |

## View `admin_overview`

`security_invoker = true` — respeita RLS do caller. Admin ve todos, analyst ve so o proprio.

Colunas: `user_id`, `user_email`, `display_name`, `role`, `first_seen_at`, `last_seen_at`, `total_replies`, `replies_total`, `replies_posted`, `replies_skipped`, `replies_last_7d`, `workspaces_count`, `total_cost_usd`.

Usado pelo AdminPanel pra preencher aba "analistas".

## Triggers + funcoes

- **`handle_new_user()`** (em `auth.users` after insert): valida `@moicdigital`, cria profile + user_roles
- **`bump_profile_replies()`** (em `reply_logs` after insert): incrementa `profiles.total_replies` se `decision='posted'`, sempre atualiza `last_seen_at`
- **`touch_updated_at()`** (generico em profiles, workspaces): `updated_at = now()`
- **`is_admin()`** (SECURITY DEFINER): usado em RLS de todas as tabelas (`OR is_admin()`)

Pra queries de analytics + admin role management, ver [ADMIN.md](./ADMIN.md).
