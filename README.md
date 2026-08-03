# Replai

Extensao Chrome (MV3) que faz **triagem semantica** de tweets de POIs (Persons of Interest) numa Lista do X e **gera replies via LLM** com voz custom por workspace. V4 e cloud-native (Supabase) com login Google + admin role + analytics.

**Versao atual:** 0.4.14 (V4.1.14) — ver [CHANGELOG.md](CHANGELOG.md).

> **Vai so usar (nao construir)?** Pula direto pro **[guia de uso](docs/guia-uso.md)** ou pegue o video tutorial pelo [roteiro](docs/roteiro-video.md).
>
> **Vai contribuir?** Comeca pelo **[SETUP dev](docs/SETUP.md)** → [ARCHITECTURE](docs/ARCHITECTURE.md) → [DEVELOPERS](docs/DEVELOPERS.md).
>
> **Versao da Web Store ainda nao aprovou?** Ver [docs/manual-install.md](docs/manual-install.md) pra sideload da versao mais recente.

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
2. **Workspaces** com multi-list por workspace — config (Listas do X, modelo LLM, filtros, voz, @ X linkado) sincronizados cross-device via Supabase
3. **Voz + Prompt base por workspace** — texto livre OU upload `.md`/`.pdf`/`.txt`. Voz precede skill base. Versionada em `voice_versions` pra A/B test
4. **Triage** apos "atualizar":
   - Fetch + prefilter (janela tempo, lang, retweet, grafo, etc) **sem chamar LLM**
   - **Selection scorer** (Gemini Flash) pontua dual: persona_relevance + engagement_potential
   - **Camada de inteligencia** cross-data: author profile (historico), batch relations (hot topics)
   - Analista escolhe quais tweets quer responder (modo swipe ou lista)
   - **LLM gera replies SO pros selecionados** — economia de tokens, prompt engagement-aware por tier de autor
5. **Reply card** com 2-3 sugestoes por tweet, editaveis. Click "responder" ou **QT** abre intent do X. **Regenerar individual** por reply
6. **Attachments** opcionais (URL de report/artigo) pra LLM usar como contexto extra
7. **Suporte multimodal** — Replai envia imagens do tweet pro Gemini/Anthropic (jpeg/png/webp/heic)
8. **Dialog de confirmacao** captura: voce postou? + URL da reply (opcional, vira "verificada")
9. **Aba Posts** — gera sugestoes de posts originais usando Watchtower (Notion) + viral posts da Lista + voz, com imagens geradas por Gemini Image
10. **Painel Admin** (so visivel pra admin): visao geral do time, click-expand por analista, export CSV/JSON, toggle "so verificadas"
11. **Analytics ricos** — 50+ colunas por reply em `reply_logs`: tweet meta (autor/thread/content), voice snapshot, custo LLM, decision, persona_relevance, engagement_potential

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
| `npm run build` | Build production → `dist/` (pra load unpacked OU sideload manual) |
| `npm run build:cws:win` | Build production STRIPPING `key` field (Windows). Use pra upload na Chrome Web Store |
| `npm run build:cws:unix` | Mesmo de `:win` mas pra macOS/Linux/WSL |
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
| [docs/guia-uso.md](docs/guia-uso.md) | **Guia curto pro time** (V4.1.14+) |
| [docs/roteiro-video.md](docs/roteiro-video.md) | Roteiro pra video tutorial de setup |
| [docs/manual-install.md](docs/manual-install.md) | Sideload da extensao enquanto a Web Store nao aprova |
| [docs/SETUP.md](docs/SETUP.md) | Setup dev do zero (Supabase + OAuth + build) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Diagrama do sistema + schema completo das tabelas |
| [docs/ADMIN.md](docs/ADMIN.md) | Bootstrap admin + queries SQL pra analytics |
| [docs/DEVELOPERS.md](docs/DEVELOPERS.md) | LLM providers + como adicionar novo |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Erros comuns + fixes |
| [docs/web-store.md](docs/web-store.md) | Checklist Chrome Web Store submission |
| [docs/privacy-policy.md](docs/privacy-policy.md) | Politica de privacidade (legal) |
| [CHANGELOG.md](CHANGELOG.md) | Historico V1 → V4 |

---

## Privacy

Replai e ferramenta interna do time `@moicdigital`. Coleta dados de uso (tweets respondidos, replies geradas, decisao do analista, custo LLM) pra analytics admin. RLS isola dados entre analistas; admin ve agregados do time. Detalhes em [docs/privacy-policy.md](docs/privacy-policy.md).
