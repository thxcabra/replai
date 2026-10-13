# Setup — Replai

Setup completo do zero pra dev local. Cobre dependencias, Supabase, OAuth Google, build e bootstrap admin.

> Pra usar a extensao (apos instalada via Web Store ou unpacked), va direto pra [guia-uso.md](./guia-uso.md).

## Pre-requisitos

- Node.js 22.6+ ([nodejs.org](https://nodejs.org)); os checks de `npm test` usam `--experimental-strip-types`
- npm 10+
- Chrome 114+ (`sidePanel` API)
- Conta Google do dominio permitido (`VITE_ALLOWED_EMAIL_DOMAIN`, default `moicdigital`)
- Acesso ao projeto Supabase do time (ou cria um novo)

## 1. Clone + install

```bash
git clone <repo-url> replai
cd replai
npm install
```

## 2. Criar projeto Supabase

> Pula esse passo se ja existe um projeto Supabase compartilhado. Pega URL + anon key do admin.

1. https://supabase.com/dashboard → **New project**
2. Nome: `replai-v4` (ou o que preferir)
3. Senha do DB: gera + guarda no 1Password
4. Region: `sa-east-1` (Sao Paulo) ou `us-east-1`
5. Plano: **Free** (cobre 500MB DB + 50k MAU — suficiente pra ~10 analistas)
6. Aguarda ~2min subir
7. Em **Project Settings → API**, anota:
   - `Project URL` → `VITE_SUPABASE_URL`
   - `anon public` key (JWT) → `VITE_SUPABASE_ANON_KEY`

> A anon key e publica por design (vai pro bundle). RLS protege os dados, nao o segredo. Nunca use `service_role` no client.

## 3. Rodar a migration

1. No painel Supabase: **SQL Editor → New query**
2. Cola o conteudo INTEIRO de cada arquivo em [`supabase/migrations/`](../supabase/migrations/), em ordem (`0001_init.sql` → `0015_apify_api_key.sql`), um por vez
3. Clica **Run** em cada um. Deve completar sem erro
4. Depois do `0001_init.sql`, em **Table Editor**, confere que apareceram **8 tabelas** com cadeado (RLS ligada): `profiles`, `user_roles`, `workspaces`, `voice_versions`, `replied_tweets`, `session_logs`, `reply_logs`, `events`
5. Em **Database → Functions**, confere: `is_admin`, `handle_new_user`, `touch_updated_at`, `bump_profile_replies`
6. Em **Database → Views**, confere `admin_overview`

> Se ja tem schema antigo, drop primeiro. Snippet de drop no final do `0001_init.sql`.

## 4. Configurar Google OAuth

### No Google Cloud Console (https://console.cloud.google.com/)

1. Cria projeto OU reusa o do Google Workspace (Internal mode exige um Workspace)
2. **APIs & Services → OAuth consent screen**:
   - User Type: **Internal** (sem verification, sem 100-user cap — so funciona se GCP project pertence a Workspace)
   - App name: `Replai`
   - Authorized domain: o dominio da sua empresa (ex: `example.com`)
   - Scopes: default (`openid`, `email`, `profile`)
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Name: `Replai Web Client`
   - Authorized redirect URIs: callback do Supabase (formato `https://<projeto>.supabase.co/auth/v1/callback`, pega na proxima etapa)
   - Save. **Anota** `Client ID` (tipo `123-abc.apps.googleusercontent.com`) e `Client Secret`

### No Supabase (Authentication → Providers → Google)

1. Toggle **Google** ON
2. Cola `Client ID` + `Client Secret`
3. **Save**. Confere que "Callback URL (for OAuth)" e o mesmo que voce colocou no GCP

## 5. .env

```bash
cp env/.env.example env/.env
```

Preenche `env/.env`:

```bash
VITE_TWITTERAPI_KEY=new1_...           # twitterapi.io
VITE_GEMINI_API_KEY=AIza...            # opcional (analista cola na UI tambem)
VITE_ANTHROPIC_API_KEY=                # opcional
VITE_SUPABASE_URL=https://<projeto>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_ALLOWED_EMAIL_DOMAIN=moicdigital  # dominio aceito no login
```

> Se trocar o dominio, use o mesmo valor no secret `ALLOWED_EMAIL_DOMAIN` das Edge Functions e no trigger `handle_new_user` (`0001_init.sql`).

> `env/.env` esta gitignored. Nunca commita.

## 6. Build + load unpacked

```bash
npm run build
```

1. `chrome://extensions` → liga "Developer mode"
2. **Load unpacked** → seleciona `dist/`
3. Card "Replai" aparece. **Copia o Extension ID** (32 chars)

## 7. Redirect URI da extensao no Supabase

A extensao usa `chrome.identity.launchWebAuthFlow` que redireciona pra `https://<extension-id>.chromiumapp.org/`. Precisa estar no whitelist:

1. Supabase: **Authentication → URL Configuration**
2. **Site URL**: `https://<extension-id>.chromiumapp.org`
3. **Redirect URLs**: adiciona `https://<extension-id>.chromiumapp.org/` (com barra no fim)
4. Save

> Extension ID **muda** quando voce remove + load unpacked, ou quando publica na Web Store (ID definitivo). Re-aplica este passo quando trocar. Pra dev, da **Reload** no card (nao Remove) pra manter o ID.

## 8. Bootstrap primeiro admin

Apos logar via Google pela primeira vez na extension (profile + user_roles criados automaticamente com role `analyst`):

```sql
update public.user_roles
set role = 'admin', granted_at = now()
where user_id = (
  select id from auth.users where email = 'you@example.com'
);
```

(Substitui o email pelo seu.) Detalhes + queries de analytics em [ADMIN.md](./ADMIN.md).

A partir do primeiro admin, da pra promover outros via UI (Header → admin → analistas → click → promover).

## 9. Validar

Na extension:
- Login Google → SetupWizard pede chave Gemini → cola → continuar
- Cria primeiro workspace, voz, salva
- Header → admin → 3 abas devem aparecer (visao geral, analistas, exportar)

No Supabase SQL Editor:
```sql
select email, name, total_replies, setup_complete from public.profiles;
select user_id, role from public.user_roles;
select id, name from public.workspaces;
```

## Loop de dev

| Comando | Pra que |
|---|---|
| `npm run dev` | Dev server do CRXJS com hot reload (gera `dist/` pra carregar como unpacked) |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Serve `dist/` |
| `npm run preview:ui` | UI isolada com mocks de chrome.* |

Apos `npm run build`, recarrega o card em `chrome://extensions` (icone de reload, NAO Remove).

## Troubleshooting setup

- **"login cancelado"**: redirect URI no Supabase != extension ID atual. Re-aplica passo 7
- **"Acesso restrito ao dominio @..."**: email fora do `VITE_ALLOWED_EMAIL_DOMAIN`, OU OAuth Internal nao esta setado
- **"Cannot coerce result to single JSON"**: profile do user nao existe. Backfill em [ADMIN.md](./ADMIN.md#backfill)
- Mais: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

## Estrutura do projeto

```
replai/
├── src/
│   ├── sidepanel/          # UI Preact (App.tsx + components + ui primitives)
│   ├── background/         # Service worker (chrome.alarms polling)
│   ├── lib/                # Storage, sync, auth, orchestrator, LLM, etc
│   ├── assets/SKILL.md     # System prompt base (anti-tropes)
│   └── preview/            # Dev preview com mocks de chrome.*
├── supabase/migrations/    # SQL schema (0001 → 0015)
├── supabase/functions/     # Edge Functions (apify-fetch, notion-watchtower)
├── docs/                   # Documentacao (esta pasta)
├── public/icons/           # Icones 16/48/128
├── env/                    # .env, .env.example
└── manifest.config.ts      # Manifest MV3 (gerado por crxjs)
```
