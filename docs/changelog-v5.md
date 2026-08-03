# Replai — V4.1 → V5.1

Resumo do que mudou entre a versao anterior (V4.1, so X) e a atual (V5.1, X + LinkedIn). Foco no que o time comercial precisa saber pra usar.

---

## O maior salto: canal LinkedIn

V4.1 era **so X**. V5.1 traz o canal **LinkedIn** com a estrategia **Groundswell**: em vez de responder direto no post do POI (que raramente responderia), voce responde no post de uma **Bridge** — pessoa proxima do POI que ja engaja com ele. A reply aparece no feed/notificacoes do POI indiretamente.

Como usa:
- Sobe bundle Groundswell (`.zip`) — pacote com POIs + Bridges + relacionamentos
- Chip **LinkedIn** no Header, botao **atualizar** → Replai puxa posts das Bridges via APIFY
- Cada post vem com um **POI-target sugerido** — LLM gera reply pensada pra ser NOTADA por esse POI
- Reply copiada pro clipboard + post original aberto pra voce colar no comentario

---

## Simetria X ≡ LinkedIn

Os 2 canais tem a mesma estrutura de UI:
- **Chips X | LINKEDIN** no Header — troca contexto inteiro
- **Tabs**: `Historico`, `Posts` (X only), `Settings`, `Admin`
- **Settings** com 3 abas: `Geral`, `X`, `LinkedIn`
- Cada canal tem sua propria **voz**, **persona (publicos-alvo)**, **filtros**, **historico**

---

## Novidades no Settings

- **Reorganizado em 3 tabs** (`Geral | X | LinkedIn`) com cores padronizadas por tipo:
  - Voz (violet) / Persona (emerald) / Fontes (sky) / Filtros (indigo) / Compliance ou Grafo (amber) / Meta (zinc)
- **Voz e Persona por canal** — tom no LinkedIn nao serve pro X (e vice-versa). Cada um tem seu bloco.
- **Persona** = publicos-alvo declarados (ex: `VCs cripto SP`, `founders fintech seed`). O LLM ancora dado/perspectiva que essa audiencia valorizaria — sem menciona-los.
- **Listas Groundswell** — analogo as Listas do X. Sobe N bundles, alterna via dropdown no Header.
- **Filtros LinkedIn** — janela de tempo (default 1 semana), max posts por refresh
- **Compliance LinkedIn** — rate limits soft/hard pra evitar ban da conta
- **Glossario in-app** (botao `?` no Header) explica POI, Bridge, ISV, readiness_tier, etc

---

## LinkedIn — economia + performance

- **Store persistente dos posts** — post scraped fica salvo por conta. Trocar aba/canal e voltar nao gasta APIFY.
- **Delta scraping** — botao "atualizar" traz so posts novos, upsert por urn.
- **Batches de 3 com delay** — evita rate limit APIFY (429).
- **Cache 12h server-side** + botao **forcar refresh (custa +)** quando precisa dados frescos.
- **Chip de custo APIFY** sempre visivel: `hoje: $X · N runs / mes: $Y · N runs`. Amber ≥$50, red ≥$80.
- **Empty state diagnostico** — funnel completo (raw / fora da janela / reposts / respondidos / cache) pra saber por que nao veio post.
- **BridgesInspector** — botao "ver bridges do bundle" no empty state lista URLs LinkedIn pra checar manualmente.

---

## LinkedIn — reply flow

- **Drafts cache local** — regerar reply so quando pedido; voltar preserva o texto ja gerado
- **`was_edited` tracking** — sabe se voce editou o texto do LLM antes de postar (feedback loop)
- **Reply enviado fica visivel** no card com badge verde + texto (nao some da tela)
- **Respondidos vao pro fim** com opacity + cor cinza — nao poluem a triagem
- **Persona LinkedIn separada** do X — injetada no prompt Groundswell junto com bridge + POI context

---

## X — quality of life

- **Scroll top apos postar** — analista cai no proximo candidato, nao no fim da lista

---

## Novo modelo de dados (schema Supabase)

4 migrations novas: `0010`, `0011`, `0012`, `0013`. Precisam ser aplicadas antes da release.

| Migration | O que faz |
|---|---|
| **0010** cross-channel | `channel` column em reply_logs/session_logs/post_logs. View SQL unificada `impact_map_cross_channel`. |
| **0011** bundle lists | N bundles ativos por (workspace, canal). `name text` nos bundles. |
| **0012** was_edited | `was_edited` + `reply_text_original` em linkedin_replies. |
| **0013** scraped posts store | Nova tabela `linkedin_scraped_posts` pra cache persistente. RLS own+admin. |

---

## Novo modelo de deploy

V4.1 rodava com API keys embutidas no cliente (Notion). V5.1 fecha isso:

- **APIFY token** → Supabase secret + Edge Function proxy (`apify-fetch`)
- **Notion token** → mesma coisa (`notion-watchtower`)
- **Server-side quotas** — teto configuravel `APIFY_DAILY_LIMIT_HARD` (default 500) via env
- **Cache server-side** de scraping — dedup entre analistas do mesmo workspace

---

## O que **NAO** mudou vs V4.1

- Fluxo X: Listas → atualizar → triagem → gerar → postar → PostConfirmDialog (mesma UX)
- Voz do workspace X: mesmo campo, mesmo shape de prompt
- Aba Posts (Watchtower + virais) — so no canal X, mesma logica
- Aba Historico X (atividade + meus replies) — mesma estrutura, agora tambem tem versao LinkedIn
- Aba Admin — X analytics ganhou tab LinkedIn (cost APIFY + impact map)

Login, workspaces, chaves LLM persistem — nao ha data loss vindo do V4.1.

---

## Bundle size

V4.1: ~340kB. V5.1: **427kB** (+87kB pelas features LinkedIn/Groundswell + Settings redesign).

---

## Roadmap V5.2+

Fora do escopo desta release:
- Groundswell X bundle opcional (analogo ao LinkedIn — bundle POI+Bridge no X)
- Onboarding wizard 3-passos pra novo user
- Preview de custo LLM antes do click ("vai custar ~$0.02")
- Historico cross-canal unificado (view SQL ja existe)
- LinkedIn Posts (Watchtower LinkedIn — nao no roadmap curto)
- Publicacao na Chrome Web Store (hoje e sideload local)
