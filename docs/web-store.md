# Chrome Web Store — Checklist de submission (Unlisted)

Tudo necessario pra subir o Replai no Web Store como **Unlisted** (so quem tem o link instala, nao aparece em search).

## Pre-flight checklist

- [ ] **Conta Developer Chrome Web Store** ($5 one-time): https://chrome.google.com/webstore/devconsole/
- [ ] **Privacy Policy hospedada publicamente** (URL vai pro form CWS). Sugestao: cola [privacy-policy.md](./privacy-policy.md) num Notion publico (Share → Publish to web) ou GitHub Pages
- [ ] **OAuth Consent Screen "Internal"** no GCP (https://console.cloud.google.com/apis/credentials/consent): User Type = Internal. So funciona se o GCP project pertence a Workspace `@moicdigital`. Internal libera de verification + 100-user cap
- [ ] **Bootstrap admin no Supabase** apos primeiro login (SQL Editor):
  ```sql
  update public.user_roles
  set role = 'admin', granted_at = now()
  where user_id = (
    select id from auth.users where email = 'you@example.com'
  );
  ```
  Detalhes em [ADMIN.md](./ADMIN.md)
- [ ] **package.json version** alinhada (ex: `0.4.0` antes de subir)
- [ ] **Build production**: `npm run build` (sem erros)
- [ ] **Zip de `dist/`**: comprime so o conteudo da pasta `dist/` (NAO `node_modules`, NAO `src/`). Salva como `releases/replai-vX.Y.Z.zip`

## Assets necessarios pelo CWS

### Icones
Ja existem em `public/icons/` (16, 48, 128 px). Incluidos automaticamente no manifest e no zip.

### Screenshots (1280x800 px PNG, ate 5)
Sugestao de capturas:
1. **Login screen** — SetupWizard com botao "login com Google"
2. **Triagem swipe** — card com tweet + LIKE/SKIP overlays parciais
3. **Triagem lista** — varios cards com checkboxes selecionados
4. **Replies geradas** — TweetCard + 3 ReplyCards com texto editavel + botao "responder"
5. **Admin panel overview** — totais + top 5 analistas + toggle "verificadas"

Como capturar (Windows): redimensiona Chrome pra ~1280px de largura, abre side panel (~376px), usa Snipping Tool (Win+Shift+S) ou Chrome DevTools → `⋮` → "Capture screenshot".

### Promo tile (opcional, 440x280 PNG)
Logo do Replai + nome em fundo escuro com gradiente sky→violet. Faz no Canva (template "Chrome Web Store small promo tile"). Nao e obrigatorio mas ajuda na hora do user decidir instalar.

### Texto pra colar no form CWS

**Descricao curta** (132 chars max):
> Triagem semantica de tweets de Listas do X com replies via LLM, voz por workspace e analytics. Equipe @moicdigital.

**Descricao longa**: cola conteudo do [README.md](../README.md) (introducao + features). Min 25 chars, max 16k.

**Single purpose statement** (campo "Single Purpose Description" no form):
> Triagem semantica de tweets de Listas publicas do X e geracao de sugestoes de reply via LLM, com analytics de uso pra equipes.

**Categoria**: `Productivity`

**Language**: `Portuguese (Brazil)`

### Justificativas de permissions

| Permission | Justificativa pro form |
|---|---|
| `storage` | Cache local de workspaces, sessao OAuth Supabase, preferencia UI (modo swipe vs lista, flag de setup completo) |
| `sidePanel` | UI principal da extensao roda no Chrome side panel |
| `tabs` | Abrir intent URL do X em nova aba quando usuario clica "responder" |
| `clipboardWrite` | (Legado — pode remover se nao usado) |
| `identity` | OAuth Google via chrome.identity.launchWebAuthFlow |
| `alarms` | Polling 15min em background pra sincronizar workspaces e profile do Supabase |
| `host_permissions: api.twitterapi.io/*` | Fetch tweets de Listas publicas do X via TwitterAPI.io |
| `host_permissions: api.anthropic.com/*` | Chamadas LLM Claude pra gerar replies (opcional, user escolhe provider) |
| `host_permissions: generativelanguage.googleapis.com/*` | Chamadas LLM Gemini pra gerar replies (default) |
| `host_permissions: lkkwtqekusqsbksncbdg.supabase.co/*` | Auth + queries do Supabase do projeto Replai. Subdomain especifico (nao wildcard) |
| `host_permissions: accounts.google.com/*` | Token exchange durante OAuth flow gerenciado pelo Supabase |

## Submeter

1. Login no Developer Dashboard com a conta Google que pagou os $5
2. **Add new item** → upload do zip
3. Preenche todos os campos do form (acima)
4. **Visibility**: Unlisted
5. **Regions**: All regions (dominio `@moicdigital` filtra quem pode logar de qualquer forma)
6. **Submit for Review**
7. Aguarda email "Item published" (1-24h tipico pra Unlisted simples, ate dias se Google flagear)

## Apos aprovacao — pegar Extension ID novo

Quando aprovado, o Extension ID **muda** vs o ID do load unpacked local. Pra OAuth funcionar:

1. Pega o ID novo: URL da extension no Web Store e `chrome.google.com/webstore/detail/<NOVO_ID>`
2. Supabase Dashboard → **Authentication → URL Configuration**:
   - **Site URL**: `https://<NOVO_ID>.chromiumapp.org`
   - **Redirect URLs**: adiciona `https://<NOVO_ID>.chromiumapp.org/`
   - Pode manter o ID do load unpacked tambem (pra continuar dev local)
3. Manda o link da Web Store pro time pelo Slack: `https://chrome.google.com/webstore/detail/<NOVO_ID>`

## Updates futuros — auto-distribution

Apos primeira aprovacao, atualizar e:

1. Edita codigo
2. Bump `package.json` version (semver: 0.4.0 → 0.4.1)
3. `npm run build`
4. Zipa `dist/` → `releases/replai-vX.Y.Z.zip`
5. Developer Dashboard → Replai → **Upload new package** → seleciona zip
6. Submit
7. Apos approval (geralmente algumas horas pra Unlisted), Chrome auto-atualiza o time em ate ~5h (pode forcar via `chrome://extensions` → "Atualizar")

**Cuidado**: mudanca em permissions dispara prompt no Chrome do user pra "aceitar". Mantem permissions estaveis se possivel. Mudancas em codigo/UI/CSS nao afetam.

## Rollback

Se subir bug:
- Opcao A: publica nova versao com fix imediato (mais rapido)
- Opcao B: no dashboard, "rollback" pra versao anterior aprovada
