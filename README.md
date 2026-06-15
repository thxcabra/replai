# Replai

Extensao Chrome (MV3) que faz **triagem semantica** de tweets de POIs (Persons of Interest) numa Lista do X e **gera replies via LLM** com voz custom por workspace. V4 e cloud-native (Supabase) com login Google + admin role + analytics.

> **Vai so usar (nao construir)?** Pula direto pro **[guia do analista](docs/guia.md)**.
>
> **Vai contribuir?** Comeca pelo **[SETUP dev](docs/SETUP.md)** → [ARCHITECTURE](docs/ARCHITECTURE.md) → [DEVELOPERS](docs/DEVELOPERS.md).

---

## Quick start

### Pra analistas do time @moicdigital
1. Recebe link do Chrome Web Store
2. Instala, abre side panel, login com Google
3. Cola chave Gemini ([free tier aqui](https://aistudio.google.com/apikey))
4. Cria workspace, define voz, **atualizar**, triage, responder

### Pra dev local
```bash
git clone <repo> replai
cd replai
npm install
cp env/.env.example env/.env   # preenche keys + Supabase URL/anon
npm run build                  # gera dist/
```
Depois `chrome://extensions` → Developer mode → Load unpacked → seleciona `dist/`.

Setup completo (Supabase + OAuth Google + bootstrap admin) em **[docs/SETUP.md](docs/SETUP.md)**.

---

## O que faz (V4)

1. **Login Google** restrito a `@moicdigital` (RLS + trigger Supabase). Profile + role criados automaticamente
2. **Workspaces** — config (Lista do X, modelo LLM, filtros, voz, @ X linkado) sincronizados cross-device via Supabase
3. **Voz por workspace** — texto livre OU upload `.md`/`.pdf`/`.txt`. Versionada em `voice_versions` pra A/B test
4. **Triage** apos "atualizar":
   - Fetch + prefilter (janela tempo, lang, retweet, grafo, etc) **sem chamar LLM**
   - Analista escolhe quais tweets quer responder (modo swipe ou lista)
   - **LLM gera replies SO pros selecionados** — economia de tokens
5. **Reply card** com 2-3 sugestoes por tweet, editaveis. Click "responder" abre intent do X
6. **Dialog de confirmacao** captura: voce postou? + URL da reply (opcional, vira "verificada")
7. **Painel Admin** (so visivel pra admin): visao geral do time, click-expand por analista, export CSV/JSON, toggle "so verificadas"
8. **Analytics ricos** — 50+ colunas por reply em `reply_logs`: tweet meta (autor/thread/content), voice snapshot, custo LLM, decision

---

## Stack

- **Cliente**: Preact + Tailwind v4 + Vite + CRX (Manifest V3, side panel)
- **Backend**: Supabase (Postgres + Auth + RLS + functions)
- **LLM**: Gemini 2.5 Flash (default, free tier) ou Anthropic Claude (opcional, pago)
- **TwitterAPI**: TwitterAPI.io (Lista do X)
- **Auth**: Google OAuth via chrome.identity (Internal mode pra Workspace)

Arquitetura em **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## Scripts npm

| Script | Pra que |
|---|---|
| `npm run dev` | Vite dev server (UI isolada com mocks, hot reload) |
| `npm run build` | Build production → `dist/` (pra load unpacked OU zip Web Store) |
| `npm run preview` | Serve `dist/` pra inspecao |
| `npm run preview:ui` | UI isolada sem CRX (mocks de chrome.*) |

---

## Estrutura

```
replai/
├── src/                  # codigo (sidepanel + background + lib + assets)
├── supabase/migrations/  # schema SQL (0001_init.sql)
├── docs/                 # documentacao (flat, archive/ pra V1/V2)
├── public/icons/         # 16/48/128 px
├── env/                  # .env, .env.example (gitignored o .env real)
├── releases/             # zips versionados pra Web Store
└── manifest.config.ts    # manifest MV3 (gerado por crxjs)
```

---

## Documentacao

| Arquivo | Pra que |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Setup dev do zero (Supabase + OAuth + build) |
| [docs/guia.md](docs/guia.md) | Guia do analista (final-user) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Diagrama do sistema + schema completo das 8 tabelas |
| [docs/ADMIN.md](docs/ADMIN.md) | Bootstrap admin + queries SQL pra analytics |
| [docs/DEVELOPERS.md](docs/DEVELOPERS.md) | LLM providers + como adicionar novo |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Erros comuns + fixes |
| [docs/web-store.md](docs/web-store.md) | Checklist Chrome Web Store submission |
| [docs/privacy-policy.md](docs/privacy-policy.md) | Politica de privacidade (legal) |
| [CHANGELOG.md](CHANGELOG.md) | Historico V1 → V4 |

---

## Privacy

Replai e ferramenta interna do time `@moicdigital`. Coleta dados de uso (tweets respondidos, replies geradas, decisao do analista, custo LLM) pra analytics admin. RLS isola dados entre analistas; admin ve agregados do time. Detalhes em [docs/privacy-policy.md](docs/privacy-policy.md).
