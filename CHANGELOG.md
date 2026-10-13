# Changelog

Notas das mudanças por sessão de trabalho. Versão mais recente primeiro.

---

## V5.2 — 2026-07-27, Listas manuais + Voice Creator + Simples/Avancado + Posts LinkedIn + jargao PT-BR

Release consolidada. 11 topicos entregues + 8 UX fixes pos-teste. Foco em reducao de friccao pro time comercial (listas CSV, Voice Creator, jargao PT-BR) + posts LinkedIn como modulo proprio.

**Requer migration 0014 aplicada no Supabase.**

### Listas manuais LinkedIn (CSV nome + linkedin_url)

Alternativa leve ao bundle Groundswell completo. Pra projetos pontuais sem rodar o pipeline offline.

- **Migration 0014** adiciona `source text NOT NULL DEFAULT 'groundswell' CHECK IN ('groundswell', 'manual')` em `groundswell_bundles`.
- **`uploadManualList`** ([storage.ts](src/lib/groundswell/storage.ts)) insere bundle com `source='manual'`; perfis + bridges com scores null e tier `ready`/context `in_context` pra passar filtro do `getActiveBridges` sem escrever caminho alternativo.
- **`ManualListUpload`** ([ManualListUpload.tsx](src/sidepanel/components/linkedin/ManualListUpload.tsx)) — UI de upload CSV, sibling de `BundleUpload`. Headers tolerantes (nome/name, linkedin_url/url/linkedin/link).
- **Orchestrator detecta `source='manual'`** ([orchestrator.ts](src/lib/channels/linkedin/orchestrator.ts)) → pula pre-filter POI + `getPoiCandidatesForBridge` → items sem `poiCandidates`.
- **Reply POI-less** ([reply-generator.ts](src/lib/channels/linkedin/reply-generator.ts)) — nova `buildLinkedInDirectSystemPrompt(voice, bridge, sourceProfile, persona)` sem POI-target indireto. Strategy note: "Reply direto na conexao X — lista manual (sem pessoa-alvo)".
- **LinkedInReplyCard** — `PoiTargetSelector` so renderiza se `poiCandidates.length > 0`. Botao Copy&Open nao exige `selectedPoiId` quando lista e manual.
- **Sub-tabs no bloco Listas** — `Bundle Groundswell (upload zip)` | `Lista manual (CSV)`.
- **Badge de origem** — cada bundle na lista mostra `[groundswell]` (indigo) ou `[manual]` (cinza).

### Voice Creator (Gemini Flash 2.5)

Substitui a friccao de escrever voz do zero. 5 perguntas → LLM gera 2 versoes (voz X + voz LinkedIn).

- **`generateVoices`** ([voice-generator.ts](src/lib/voice-generator.ts)) — Gemini Flash 2.5 com JSON schema. Custo ~$0.001 por geracao.
- **`VoiceCreator`** ([VoiceCreator.tsx](src/sidepanel/components/VoiceCreator.tsx)) — modal stepper: (1) trabalho, (2) temas recorrentes, (3) referencias, (4) anti-padroes, (5) tom (4 sliders 1-5), (6) preview + editar.
- **Botao "criar voz automatica"** nos blocos Voz X + Voz LinkedIn (Settings).
- **Preview com 3 acoes**: `so X` / `so LinkedIn` / `aplicar ambas`.
- **Hint no SetupWizard** — apos salvar chaves, banner violeta com CTA pro Voice Creator.

### Modo Simples/Avancado

Toggle top-level no header do Settings. Persistido em `chrome.storage.local`.

- **`SettingsModeContext`** ([SettingSection.tsx](src/sidepanel/components/settings/SettingSection.tsx)) — Preact context expondo o mode ativo. SettingSection ganha prop `advanced?: boolean` — quando `mode === 'simple'` e `advanced=true`, o bloco fica `hidden`.
- **Simples (default):** Voz X, Persona X, Fontes X, Voz LinkedIn, Listas Groundswell, Filtros LinkedIn, Chaves API + Filtros de coleta.
- **Avancado adiciona:** Prompt base, Workspace admin, Social graph, Pre-filtro selecao, Limites de seguranca LinkedIn.

### Aba Posts multi-canal + mode selector

Posts LinkedIn vira modulo proprio. Aba Posts do X ganha 3 modos.

- **`suggestPosts` mode** ([posts-suggestion.ts](src/lib/posts-suggestion.ts)) — `'watchtower' | 'replies_synthesis' | 'hybrid'` (default `hybrid`). Adiciona `recent_replies_with_context` no payload (ultimas 12 replies postadas com texto completo + categoria).
- **PostsView selector** — 3 chips `[Watchtower | Replies | Hibrido]` no topo. LLM prompt adapta descrevendo o modo ativo.
- **`suggestLinkedInPosts`** ([channels/linkedin/posts-suggestion.ts](src/lib/channels/linkedin/posts-suggestion.ts)) — pipeline especifico LinkedIn: ultimas 12 replies LinkedIn postadas + amostra top-20 pessoas-alvo do bundle → Gemini Flash com prompt longform (3-5 linhas, sem hashtag/emoji ostensivo, ancorado nas teses recorrentes). Sem imagem gerada.
- **`LinkedInPostsView`** ([LinkedInPostsView.tsx](src/sidepanel/components/linkedin/LinkedInPostsView.tsx)) — UI nova, wire no App via `channel === 'linkedin'` na aba Posts.

### Diferenciacao visual X vs LinkedIn

Elimina "sensacao de travado" ao trocar canal.

- **LinkedInView nao remonta** — passou de `{channel === 'linkedin' && <LinkedInView />}` pra `<div class={channel !== 'linkedin' ? 'hidden' : ''}>` + sempre montado. Preserva drafts, sent, lastOutcome entre trocas.
- **Colorstrip 4px** no topo do sidepanel — sky no X, `#0a66c2` no LinkedIn.
- **`ChannelIcon`** ([ChannelIcon.tsx](src/sidepanel/ui/ChannelIcon.tsx)) — SVG X + `in` reusaveis. Renderizados ao lado do workspace select no Header + dentro dos chips do ChannelSwitcher.
- **Fade 150ms** ao trocar canal — `channelSwitching` state + `transition-opacity duration-150`.
- **LinkedInPostCard hierarchy avatar+name-first** — avatar circle 40px, nome grande, headline menor. `readiness_tier` chip moveu pro footer.
- **RELATION_TIER 8→4 buckets** — `reciproco / frequente / ocasional / raro`.
- **PoiTargetSelector colapsavel** — mostra so top-1 por default; botao "ver N alternativo(s)" expande.

### Pack completo de renames PT-BR (jargao-free)

Todo termo tecnico visivel pro time comercial traduzido. Groundswell + Watchtower mantidos (nomes ancorados na estrategia + glossario).

- `POI-target` → `pessoa-alvo` (cards, reply flow, admin panel, upload)
- `Bridge` → `conexao` (context header, reply flow, strategy note, admin panel)
- `bundle` → `lista` (contextos user-facing)
- `readiness_tier: ready/emerging/needs_work` → `pronto/emergindo/em construcao`
- `posts pra triagem` → `posts pra revisar`
- `cache hit · $0.00` / `run APIFY · $X` → `reaproveitado · $0.00` / `coleta nova · $X`
- `Filtros + batch (janela, idiomas, paginas)` → `Filtros de coleta`
- `Tweets por batch LLM` → `Tweets analisados por vez`
- `opcoes avancadas de fetch` → `opcoes avancadas de coleta`
- `Compliance LinkedIn (evita ban)` → `Limites de seguranca LinkedIn (evita ban)`
- `Fontes de conteudo (Listas + handle)` → `Listas do X e seu @`
- `impact map` / `cost APIFY` → `mapa de impacto` / `custo de coleta`

### UX polish pos-teste (feedback do time comercial)

- **Personas removidas do UI** (X e LinkedIn) — feedback: overload informacional. Campos ficam no schema; reply-generator + posts-suggestion caem em fallback (`persona_public_target` X quando `linkedin_persona_public_target` vazio).
- **Infra label removida** — "Groundswell + APIFY" / "Listas + TwitterAPI" ao lado do ChannelSwitcher — nao agrega.
- **Legenda de sessao** — "sessao: N post(s) (janela Xh) de M coletados" agora so aparece no canal X (era X-specific mas vazava no LinkedIn).
- **"posts pra revisar" colapsavel** — virou `<details>` com summary compacto; breakdown de custos (hoje/mes/runs cached) expande sob demanda.
- **Botao Config abre tab do canal ativo** — `initialTab` prop no Settings; X → tab X, LinkedIn → tab LinkedIn.
- **Titulo do bloco Listas simplificado** — "Listas Groundswell (bundles POI + Bridge)" → "Listas de perfis LinkedIn". Help agora explicita as 2 opcoes (bundle Groundswell ou CSV manual).
- **Filtros de coleta reordenados** — Janela + Batch + Idiomas ficam visiveis; Paginas TwitterAPI, Fetch todas listas, Incluir handles fora, Dry-run em `<details>` interno "opcoes avancadas de coleta".

### Pra subir

1. Aplicar `supabase/migrations/0014_manual_lists_source.sql` no projeto Supabase.
2. `npm install && npm run build` — output em `dist/`.
3. Carregar `dist/` sem compactar em `chrome://extensions` (modo desenvolvedor) ou distribuir `replai-v0.5.2-sideload.zip` gerado.
4. Reload dos analistas do time — nenhuma acao manual necessaria (bundles + replies existentes seguem funcionando; personas somem do UI mas persistem no schema).

### Metricas

- Build: 463.44kB (vs 426.67kB V5.1) — +36kB gzipped 136kB. Overhead do VoiceCreator + LinkedInPostsView + ChannelIcon + posts-suggestion LinkedIn + tabs internas.
- Type-check: verde. Zero warnings.
- Modules: 149 (vs 144 V5.1) — 5 novos (voice-generator, VoiceCreator, LinkedInPostsView, ChannelIcon, channels/linkedin/posts-suggestion).

---

## V5.1 — 2026-07-14, LinkedIn store persistente + UX polish + Settings redesign

Release consolidada. Do canal LinkedIn ficar funcional pra time comercial: store persistente dos posts (nao re-scrape), Settings reorganizado por tabs com cores padronizadas, quality-of-life fixes em X + LinkedIn.

**Requer migrations 0010 → 0013 aplicadas no Supabase** (ver "Pra subir" abaixo).

### Resumo V4.1 → V5.1

Visao geral do que mudou entre a V4.1 (so X) e a V5.1 (X + LinkedIn). O detalhe por area vem nas secoes seguintes.

#### O maior salto: canal LinkedIn

V4.1 era **so X**. V5.1 traz o canal **LinkedIn** com a estrategia **Groundswell**: em vez de responder direto no post do POI (que raramente responderia), voce responde no post de uma **Bridge** — pessoa proxima do POI que ja engaja com ele. A reply aparece no feed/notificacoes do POI indiretamente.

Como usa:
- Sobe bundle Groundswell (`.zip`) — pacote com POIs + Bridges + relacionamentos
- Chip **LinkedIn** no Header, botao **atualizar** → Replai puxa posts das Bridges via APIFY
- Cada post vem com um **POI-target sugerido** — LLM gera reply pensada pra ser NOTADA por esse POI
- Reply copiada pro clipboard + post original aberto pra voce colar no comentario

#### Simetria X ≡ LinkedIn

Os 2 canais tem a mesma estrutura de UI:
- **Chips X | LINKEDIN** no Header — troca contexto inteiro
- **Tabs**: `Historico`, `Posts` (X only), `Settings`, `Admin`
- **Settings** com 3 abas: `Geral`, `X`, `LinkedIn`
- Cada canal tem sua propria **voz**, **persona (publicos-alvo)**, **filtros**, **historico**

#### Novidades no Settings

- **Reorganizado em 3 tabs** (`Geral | X | LinkedIn`) com cores padronizadas por tipo:
  - Voz (violet) / Persona (emerald) / Fontes (sky) / Filtros (indigo) / Compliance ou Grafo (amber) / Meta (zinc)
- **Voz e Persona por canal** — tom no LinkedIn nao serve pro X (e vice-versa). Cada um tem seu bloco.
- **Persona** = publicos-alvo declarados (ex: `VCs cripto SP`, `founders fintech seed`). O LLM ancora dado/perspectiva que essa audiencia valorizaria — sem menciona-los.
- **Listas Groundswell** — analogo as Listas do X. Sobe N bundles, alterna via dropdown no Header.
- **Filtros LinkedIn** — janela de tempo (default 1 semana), max posts por refresh
- **Compliance LinkedIn** — rate limits soft/hard pra evitar ban da conta
- **Glossario in-app** (botao `?` no Header) explica POI, Bridge, ISV, readiness_tier, etc

#### LinkedIn — economia + performance

- **Store persistente dos posts** — post scraped fica salvo por conta. Trocar aba/canal e voltar nao gasta APIFY.
- **Delta scraping** — botao "atualizar" traz so posts novos, upsert por urn.
- **Batches de 3 com delay** — evita rate limit APIFY (429).
- **Cache 12h server-side** + botao **forcar refresh (custa +)** quando precisa dados frescos.
- **Chip de custo APIFY** sempre visivel: `hoje: $X · N runs / mes: $Y · N runs`. Amber ≥$50, red ≥$80.
- **Empty state diagnostico** — funnel completo (raw / fora da janela / reposts / respondidos / cache) pra saber por que nao veio post.
- **BridgesInspector** — botao "ver bridges do bundle" no empty state lista URLs LinkedIn pra checar manualmente.

#### LinkedIn — reply flow

- **Drafts cache local** — regerar reply so quando pedido; voltar preserva o texto ja gerado
- **`was_edited` tracking** — sabe se voce editou o texto do LLM antes de postar (feedback loop)
- **Reply enviado fica visivel** no card com badge verde + texto (nao some da tela)
- **Respondidos vao pro fim** com opacity + cor cinza — nao poluem a triagem
- **Persona LinkedIn separada** do X — injetada no prompt Groundswell junto com bridge + POI context

#### X — quality of life

- **Scroll top apos postar** — analista cai no proximo candidato, nao no fim da lista

#### Novo modelo de dados (schema Supabase)

4 migrations novas: `0010`, `0011`, `0012`, `0013`. Precisam ser aplicadas antes da release.

| Migration | O que faz |
|---|---|
| **0010** cross-channel | `channel` column em reply_logs/session_logs/post_logs. View SQL unificada `impact_map_cross_channel`. |
| **0011** bundle lists | N bundles ativos por (workspace, canal). `name text` nos bundles. |
| **0012** was_edited | `was_edited` + `reply_text_original` em linkedin_replies. |
| **0013** scraped posts store | Nova tabela `linkedin_scraped_posts` pra cache persistente. RLS own+admin. |

#### Novo modelo de deploy

V4.1 rodava com API keys embutidas no cliente (Notion). V5.1 fecha isso:

- **APIFY token** → Supabase secret + Edge Function proxy (`apify-fetch`)
- **Notion token** → mesma coisa (`notion-watchtower`)
- **Server-side quotas** — teto configuravel `APIFY_DAILY_LIMIT_HARD` (default 500) via env
- **Cache server-side** de scraping — dedup entre analistas do mesmo workspace

#### O que **NAO** mudou vs V4.1

- Fluxo X: Listas → atualizar → triagem → gerar → postar → PostConfirmDialog (mesma UX)
- Voz do workspace X: mesmo campo, mesmo shape de prompt
- Aba Posts (Watchtower + virais) — so no canal X, mesma logica
- Aba Historico X (atividade + meus replies) — mesma estrutura, agora tambem tem versao LinkedIn
- Aba Admin — X analytics ganhou tab LinkedIn (cost APIFY + impact map)

Login, workspaces, chaves LLM persistem — nao ha data loss vindo do V4.1.

#### Bundle size

V4.1: ~340kB. V5.1: **427kB** (+87kB pelas features LinkedIn/Groundswell + Settings redesign).

#### Roadmap V5.2+

Fora do escopo desta release:
- Groundswell X bundle opcional (analogo ao LinkedIn — bundle POI+Bridge no X)
- Onboarding wizard 3-passos pra novo user
- Preview de custo LLM antes do click ("vai custar ~$0.02")
- Historico cross-canal unificado (view SQL ja existe)
- LinkedIn Posts (Watchtower LinkedIn — nao no roadmap curto)
- Publicacao na Chrome Web Store (hoje e sideload local)

### LinkedIn — store persistente + delta scraping

Modelo de dados nova: `linkedin_scraped_posts` (migration 0013) — posts scraped ficam armazenados por (workspace, post_urn). Nao ha re-scrape do mesmo post.

- **Boot em modo cache** — ao entrar no chip LinkedIn, query direto do store (`$0` APIFY). Se store tem posts na janela, aparecem instant.
- **Atualizar em modo refresh** — botao "atualizar" chama APIFY → upsert delta (so posts novos) → re-query store → refresh UI.
- **Trocar aba (LinkedIn → historico → LinkedIn)** — nao dispara APIFY. `useRef` ancora o `refreshTrigger` no mount pra distinguir "primeiro render" de "trigger real".
- **Sort/UI**: respondidos vao pro fim da lista com `opacity-50 grayscale` + badge `✓ ja respondido`. Dentro do grupo, ordena por `post_created_at desc`.
- **Ciclo**: post fora da janela (>1 semana default) some da triagem mas fica no DB. Aparece em Historico via `linkedin_replies`.

Arquivos: [scraped-posts.ts](src/lib/channels/linkedin/scraped-posts.ts) (novo), [orchestrator.ts](src/lib/channels/linkedin/orchestrator.ts) (`mode: "cache" | "refresh"`), [LinkedInView.tsx](src/sidepanel/components/linkedin/LinkedInView.tsx) (useRef guard).

### LinkedIn — batch config + rate limit resiliente

- **Batches de 3 com 1s delay** entre eles no adapter — evita 429 do APIFY que aparecia com 6+ chamadas paralelas.
- **`DAILY_RUN_LIMIT_HARD` configuravel** via env `APIFY_DAILY_LIMIT_HARD` (default 500, era 150 hard-coded). User ajusta sem redeploy.
- **`?timeout` removido da URL APIFY** — testes mostraram que cortava respostas legitimas antes do actor terminar.
- **`getActiveBridges` relaxado** — aceita `readiness_tier IN (ready, emerging)` (era so ready). `MAX_PROFILES_PER_RUN: 30 → 50`. Default `sinceMs`: 48h → **168h (1 semana)**.
- **Custo APIFY visivel** — chip no `TriageSummary` mostra `hoje: $X · N runs / mes: $Y · N runs (N cache)`. Alerta amber ≥$50, red ≥$80.
- **Empty state diagnostic** — mostra funnel completo (raw / old / reposts / no_text / engaged / cache) + botao "forcar refresh (custa +)" que bypassa cache Supabase de 12h.
- **BridgesInspector** — link "▸ ver bridges do bundle" no empty state expande lista de bridges com URL LinkedIn clicavel pra checar manualmente.

Arquivos: [channels/linkedin/index.ts](src/lib/channels/linkedin/index.ts), [cost.ts](src/lib/channels/linkedin/cost.ts) (novo), [supabase/functions/apify-fetch/index.ts](supabase/functions/apify-fetch/index.ts).

### LinkedIn — reply flow polido

- **Drafts cache local** — cada `post_ref` guarda `{replyText, replyTextOriginal, selectedPoiId, strategyNote}`. Reabrir mesmo post NAO chama LLM novamente.
- **Botao voltar preserva** — `handleSkip` volta pra triage sem apagar draft. User pode continuar de onde parou.
- **Reply enviado fica visivel** — apos post, card fica na triage com caixa verde: `enviado (editado) para {POI}` + texto.
- **`was_edited` tracking** — schema `linkedin_replies` ganha `was_edited boolean` + `reply_text_original text` (migration 0012). Handler compara `replyText` vs original gerado pelo LLM.
- **Novos filtros no Settings LinkedIn** — bloco "Filtros + batch" com `janela de tempo` + `max posts por atualizar`.

Arquivos: [LinkedInView.tsx](src/sidepanel/components/linkedin/LinkedInView.tsx), [LinkedInSettings.tsx](src/sidepanel/components/linkedin/LinkedInSettings.tsx).

### Listas Groundswell LinkedIn (multi-bundle)

Migration 0011 permite N bundles ativos por (workspace, channel). Cada bundle e uma "lista" alternavel no dropdown do Header.

- `groundswell_bundles.name` — nome amigavel (default `workspace_slug`)
- Dropdown dual no Header: canal X → Listas X, canal LinkedIn → Bundles Groundswell
- `LinkedInSettings > Listas Groundswell` — mostra N cards + botao "adicionar nova lista"
- `BundleUpload` aceita nome customizado no parsed state

### Settings redesign

- **Tabs internas**: `Geral | X | LinkedIn` (todas sempre visiveis)
- **14 blocos migrados** pra `SettingSection` primitive (era 1/14 = 7% adocao)
- **Cores padronizadas** — mesma ordem/cor em ambos os canais:
  1. **violet** = Voz
  2. **emerald** = Persona
  3. **sky** = Fontes (Listas X / Listas Groundswell LinkedIn)
  4. **indigo** = Filtros + batch
  5. **indigo/amber** = Selecao X / Compliance LinkedIn
  6. **amber** = Social graph X
- **Voz e Persona separadas por canal** — `voice` (X) / `linkedin_voice` + novo `linkedin_persona_public_target` (LinkedIn). Cada canal tem seu tom + publico-alvo.
- **Removidos** — SetupChecklist decorativo, bloco "Canais ativos" (loop circular), toggle `canal on/off` do LinkedIn (implicito via voice+bundle).
- **Ordem X e LinkedIn identica** por tone — mais facil localizar.

### X — quality of life

- **Scroll top apos post** — apos `handleConfirmPosted`, `window.scrollTo({top:0})`. Analista cai no proximo candidato em vez do fim da lista.

### Glossary — back volta pra origem

Novo state `viewBeforeGlossary` — back button restaura view de onde veio (Settings/main/etc) em vez de hardcoded `settings`.

### Novidades no schema (migrations 0010 → 0013)

| Migration | Objetivo |
|---|---|
| **0010** `v6_cross_channel_persona` | `channel` + `bundle_id` em reply_logs/session_logs/post_logs. View `impact_map_cross_channel`. |
| **0011** `bundle_lists` | Multi-bundle ativo por (workspace, channel). `name` em groundswell_bundles. |
| **0012** `linkedin_was_edited` | `was_edited boolean` + `reply_text_original text` em `linkedin_replies`. |
| **0013** `linkedin_scraped_posts` | Store persistente dos posts scraped. Indexes por workspace + created_at + bridge. RLS own or admin. |

### Bundle sizes

V5 base: ~415kB → **V5.1 final: 426.67kB** (+11kB pelas features novas: store persistente, cost chip, bridges inspector, Settings tabs, listas groundswell).

### Pra subir

1. **Aplicar migrations** no Supabase (dashboard SQL Editor ou `supabase db push`):
   - 0010, 0011, 0012, 0013 (na ordem — 0013 depende de 0011)
2. **Redeploy da Edge Function `apify-fetch`** (mudancas de logs verbosos + limite configuravel):
   ```bash
   supabase functions deploy apify-fetch --project-ref lkkwtqekusqsbksncbdg
   ```
3. **Opcional — ajustar teto APIFY**: Dashboard → Secrets → `APIFY_DAILY_LIMIT_HARD=1000` (default 500).
4. **Build extension**:
   - Sideload local: `npm run build`
   - CWS (sem key): `npm run build:cws:unix` ou `build:cws:win`
5. **Distribuir** — zip do `dist/` pro time. Instalar unpacked em `chrome://extensions`.

### Smoke test recomendado

1. Login `@moicdigital`. Cria workspace. Preenche voz X.
2. Aba **Settings > LinkedIn** — sobe bundle Groundswell + preenche voz LinkedIn.
3. Chip LinkedIn no Header — deve carregar do store (rapido).
4. Botao **atualizar** — dispara APIFY. Ve chip de custo.
5. Clica num post — gera reply. Volta (sem descartar). Clica de novo — nao regera.
6. Posta reply — card fica verde na triage.
7. **LinkedIn → historico → LinkedIn** — nao gasta APIFY (mode cache).
8. Reload extension. Chip LinkedIn — posts persistentes aparecem (do store).
9. Bump version confirmado no Header.

---


## V4.1.16 — 2026-06-29, hotfix multi-list detection ("nada salva")

Sintoma reportado por user: "salvo, mas quando clico atualizar volta pra config". Reproduzia em Comet/Edge/qualquer browser — nada de Edge-specifico.

### Causa raiz

Em V4.1 introduzimos multi-list (`config.lists[]` + `config.activeListId`), mas:
1. [`isConfigComplete`](src/lib/storage.ts#L680) so checava o campo LEGADO `config.listId` top-level. Workspaces criados pos-V4.1 que usavam o bloco multi-list sem marcar a lista como ativa caiam em "config incompleta" mesmo com a lista preenchida.
2. O botao "+ adicionar lista" em [Settings.tsx:663](src/sidepanel/components/Settings.tsx#L663) nao setava `activeListId` mesmo quando era a primeira lista. User precisava lembrar de clicar no radio button — varios esqueciam.
3. O onInput do campo de listId so sincronizava `listId` top-level quando a lista era a ativa. Se nao havia ativa definida, nao sincronizava.

Resultado pratico: user criava workspace novo → adicionava lista → preenchia ID → salvava (save funcionava, push pro Supabase OK) → clicava atualizar → app jogava de volta pra Settings → user achava que "nada salvou".

Cabral nao reproduzia porque seu workspace ja tinha `config.listId` top-level desde V4.0 (legacy).

### Fix

- `isConfigComplete` agora aceita top-level `listId` (legacy) OU qualquer `lists[i].listId` preenchido
- Botao "+ adicionar lista" marca a primeira como ativa automaticamente
- onInput de listId sincroniza top-level se a lista e a ativa OU se nao ha ativa definida (e nesse caso, vira a ativa)

### Bump version

`0.4.15` → `0.4.16`. Re-release `replai-v4.0.16.zip` (sideload) + `replai-v4.0.16-cws.zip`.

### Pra subir

So redistribuir a extensao (sideload pro time + upload no CWS). Sem mudanca de DB.

---

## V4.1.15 — 2026-06-29, hotfix RLS collision + workspace name revert

### Bug 1: Nome do workspace revertia apos salvar

Causa raiz: corrida de closure em React. Settings.handleSave chamava em sequencia:
1. `onRenameWorkspace("nome novo")` → `setWorkspace({...workspace, name: "nome novo"})`
2. `onSaveConfig(cfg)` → `{...workspace, config: cfg}` em [App.tsx:281](src/sidepanel/App.tsx#L281)

O `workspace` no closure de `handleSaveConfig` ainda apontava pro objeto velho (com nome antigo) porque `setWorkspace` da etapa 1 nao atualiza o closure sincronicamente. Resultado: `{...workspace_velho, config}` reusava o nome antigo → push pro cloud com nome velho → na proxima leitura, o nome novo ja era passado.

**Fix:** [`handleSaveConfig`](src/sidepanel/App.tsx#L278) agora le do storage (`getWorkspace`) antes do spread, pegando o nome ja atualizado pelo handler anterior.

### Bug 2: RLS workspace collision (ws_default)

Bug critico que vinha desde V4.0: dois ou mais analistas batiam em **"new row violates row-level security policy (USING expression) for table 'workspaces'"** ao tentar criar/salvar o primeiro workspace pos-login. Causa nada a ver com migration 0002 — era colisao de PK.

#### Causa raiz

`src/lib/storage.ts:49` definia `DEFAULT_WS_ID = "ws_default"` e usava esse literal em 3 fallbacks (migration V2, `getActiveWorkspace`, `deleteWorkspace`). O primeiro analista pushava `ws_default` com seu user_id. O segundo analista, ao tentar push de SEU `ws_default` local, batia num UPSERT que virava UPDATE — e a USING expression da policy `workspaces update own or admin` rejeitava porque `auth.uid() != user_id_existente`.

#### Fix

- **Cliente**: cada fallback agora chama `newWorkspaceId()` (gera ID base36 unico). Sem mais PK compartilhado entre analistas.
- **Migration local**: usuarios pre-V4.1.15 com `ws_default` no chrome.storage tem o workspace renomeado pra um ID novo no proximo boot. Caches/graph/replied tambem migram pelo novo prefix.
- **Migration SQL** ([supabase/migrations/0008_workspace_id_cleanup.sql](supabase/migrations/0008_workspace_id_cleanup.sql)): renomeia cada `ws_default` existente no Supabase pra ID unico baseado em `md5(random() || user_id)`. Atualiza `profiles.active_workspace_id` pra apontar pro workspace mais antigo do user.

### Bump version

`0.4.14` → `0.4.15`. Re-release `replai-v4.0.15.zip` (sideload) + `replai-v4.0.15-cws.zip` (Web Store).

### Pra subir

1. **Rodar SQL 0008** no dashboard do Supabase ANTES de distribuir a nova versao do cliente
2. Upload do `releases/replai-v4.0.15-cws.zip` no CWS dev console
3. Pro time enquanto CWS nao aprova: distribuir `replai-v4.0.15.zip` + reload manual

### Por que o bug ficou invisivel ate V4.0 em producao

Cabral era o unico user ate entao. Quando time real comecou a logar em paralelo, dois analistas criaram `ws_default` no mesmo dia. O primeiro ganhou a row, o segundo passou a falhar silenciosamente no push (erro vinha so como banner vermelho transitorio).

---

## V4.1.14 — 2026-06-29, hardening (code review batch)

Aplicacao em massa das 31 findings do code review (revisao de codigo de 2026-06-29). Sem features novas — so seguranca, performance e robustez. Build verde, type-check verde, sem mudanca de comportamento visivel ao analista.

### Critical (6/6 aplicados)

- **CR-01**: CORS da Edge Function `notion-watchtower` agora pinned em `chrome-extension://lhoachajfmnfabhcmjkibijjcdbmgjll`. Sem origem wildcard.
- **CR-02**: `pageId` removido do payload do client. Edge Function so aceita `date`. `WATCHTOWER_PAGE_ID` vive so em Supabase secret. Antes era confused-deputy: qualquer @moicdigital podia enumerar paginas do workspace Notion.
- **CR-03**: `gemini-image.ts` cache virou LRU com TTL (cap 20 entries, 24h positivo / 5min negativo). Antes crescia sem bound no service worker.
- **CR-04**: `post_logs.image_data_url` nunca mais grava base64 no Postgres. Imagem vive so no client. Bug bloat de DB e quota Supabase.
- **CR-05**: `safeOpenUrl()` em `src/lib/safe-url.ts` — valida scheme (https/http) + host (x.com / twitter.com) antes de `chrome.tabs.create`. Aplicado em TweetCard, ReplyCard, PostsView.
- **CR-06**: `intelligence-cache.ts` reescrito pra storage per-key no chrome.storage.local (sem mais read-modify-write do blob inteiro). Elimina race em escritas concorrentes via Promise.all.

### Warning (16/16 aplicados)

- **WR-01**: `metrics.sanitize` blacklist agora e regex word-boundary, nao substring includes.
- **WR-02**: `inFlightPushes.add` antes do write local em `saveWorkspace`. Fecha janela onde `pullAll` podia ver local sem saber do push em andamento.
- **WR-03**: timeout 8s em `gemini.fetchImageAsInlineData`. Antes uma URL travada podia bloquear o batch inteiro por 60-120s.
- **WR-04**: chunked btoa substituido por `FileReader.readAsDataURL`. Sem risco de stack overflow em imagens grandes.
- **WR-05**: timeout 30s por imagem em `posts-suggestion`. Worst-case 900s → 30s/img.
- **WR-06**: `runQuickTest` valida tweet ID com `/^\d{6,25}$/` pra prevenir gasto descontrolado de creditos TwitterAPI.
- **WR-07**: erros silenciosos de `getAuthorProfiles` / `enrichWithIntelligence` agora surfam pelo banner via `notifySyncError`.
- **WR-08**: coberto por CR-03 (cache LRU com TTL invalida falhas em 5min, permite retry).
- **WR-09**: removido `pullAll()` duplo no boot do `App.tsx`. Antes rodava 2 vezes em paralelo.
- **WR-10**: novo `recordTriageSelected` so atualiza `triage_selected + mode`. Antes sobrescrevia `triage_passed`, corrompendo funnel analytics.
- **WR-11**: `getNum` em twitterapi rejeita negativos. Counts corrompidos nao alteram mais o ranking de viralScore.
- **WR-12**: `handleConfirmDelete` em Settings agora bloqueia duplo-click + so limpa input apos sucesso. Loading state visivel.
- **WR-13**: regex de `inferTopics` (intelligence.ts) endurecida — exige contextos especificos. Sem mais false-positive em "llama" (animal) ou "ai" curto.
- **WR-14**: cleanup com `cancelled` flag em `Dashboard.useEffect` e `MyRepliesView.load`. Sem mais setState em fetch antigo.
- **WR-15**: `safeModelId()` em gemini-image valida modelId antes de interpolar URL. Defesa preemptiva contra URL injection.
- **WR-16**: `runQuickTest` cria session_log dedicado e devolve sessionId; App.tsx liga reply_logs.

### Info (7/9 aplicados, IN-02 e IN-03 deferidos)

- **IN-01**: novo `src/lib/constants.ts` com `TIMEOUTS`, `TTLS`, `LIMITS`. Magic numbers de 5+ arquivos consolidados.
- **IN-04**: nao aplicado (deferido — extracao de `PostedConfirmCore` shared component).
- **IN-05**: `PostsView` usa `useRef` pra timer + cleanup no unmount. Sem mais setState em componente unmounted.
- **IN-06**: `resetMetrics()` exportado de metrics.ts, chamado em `signOut`. Queue limpa entre usuarios.
- **IN-07**: `[storage] cloud ...` logs gated por flag `REPLAI_DEBUG` no chrome.storage. Devtools nao acumula mais PII por default.
- **IN-08**: `buildSystemPrompt` memoizado por (voice, basePrompt). Evita reconstrucao de 100 linhas a cada call LLM.
- **IN-09**: scripts `build:cws:win` e `build:cws:unix` no package.json. REPLAI_CWS_BUILD setado automatico.

### Deferidos (V4.2+)

- **IN-02**: split de `Settings.tsx` (1422 linhas) em sub-componentes
- **IN-03**: extrair hooks de `App.tsx` (1294 linhas, 25+ useState)
- **IN-04**: shared `PostedConfirmCore` entre PostConfirmDialog/PostConfirmFlow

### Docs novas

- `docs/guia-uso.md` — guia curto pro time (instalacao + setup + fluxo)
- `docs/roteiro-video.md` — roteiro 6-8min pro video tutorial
- `docs/manual-install.md` — sideload da extensao enquanto a Web Store nao aprova

### Bump version

`0.4.13` → `0.4.14`. Build artifact em `dist/`. Pro CWS upload usar `npm run build:cws:win`.

### Pra subir

Migration nao precisa. Re-deploy da Edge Function `notion-watchtower` com `--verify-jwt`:
```bash
supabase functions deploy notion-watchtower
```

---

## V4.1.3 — 2026-06-26, defaults do time embedados (Notion + Watchtower)

Padrao do TwitterAPI agora aplicado pro Notion: token e page ID do Watchtower viram defaults do time, embutidos no build via env. Cada analista pode override se quiser apontar pra paginas externas, mas ninguem precisa configurar manual.

### Mudancas

- `env/.env`: novos `VITE_NOTION_API_TOKEN` + `VITE_WATCHTOWER_PAGE_ID` (gitignored, embedados pelo build)
- `env/.env.example`: documentado pra futuros devs entenderem como popular
- [`src/lib/keys.ts`](src/lib/keys.ts): novos exports `NOTION_API_TOKEN` + `WATCHTOWER_PAGE_ID_DEFAULT`
- [`src/lib/posts-suggestion.ts`](src/lib/posts-suggestion.ts) `suggestPosts`:
  - `effectiveNotionToken = profile.notion_api_token || NOTION_API_TOKEN`
  - `effectivePageId = config.watchtower_page_id || WATCHTOWER_PAGE_ID_DEFAULT`
  - Mesma logica de fallback que TwitterAPI usa ha tempos
- [`src/sidepanel/components/Settings.tsx`](src/sidepanel/components/Settings.tsx): inputs Notion agora mostram "✓ usando default do time" quando vazios, com placeholder explicativo

### Por que isso importa pro time

Antes V4.1.3:
- Cada analista precisava criar uma Notion integration pessoal
- Compartilhar a pagina Watchtower com sua integration
- Colar token e page ID em Settings

Depois V4.1.3:
- Analista loga no Replai → aba "posts" funciona ja na primeira abertura
- Zero config Notion por user
- Override so se quiser pagina diferente (Marketing/RH/etc)

### Bump version

`0.4.5` → `0.4.6`. `releases/replai-v4.0.6.zip` (300 KB).

### Pra subir

Migration nao precisa (so build novo).

1. Subir `replai-v4.0.6.zip` no CWS dashboard
2. Apos aprovacao, todos os analistas tem Notion funcionando automaticamente

### Nota de seguranca

- Token Notion embutido no JS bundle → extraivel via DevTools por quem tem a extension
- Pra time interno @moicdigital (Web Store Unlisted), risco e baixo
- Notion integration e "Internal" — so consegue acessar paginas explicitamente compartilhadas com ela
- Pra revogar: https://www.notion.so/profile/integrations → Refresh secret → rebuild + redeploy

---

## V4.1.2 — 2026-06-26, aba "minhas replies" + metricas manuais

Nova view pra analista ver e enriquecer suas proprias replies com dados manuais (sem scraping). Resolve o gap entre "registrei que postei" e "qual foi o resultado real" — likes/RTs/quotes/replies + flag de "OP respondeu de volta" + notas livres.

### Migration

[`supabase/migrations/0006_reply_metrics_manual.sql`](supabase/migrations/0006_reply_metrics_manual.sql):
- `reply_logs` ganha 7 colunas novas: `actual_likes`, `actual_retweets`, `actual_replies`, `actual_quotes`, `op_replied_back`, `analyst_notes`, `metrics_updated_at`
- Nova policy RLS **UPDATE own** (antes era so SELECT + INSERT — append-only). Analista atualiza so suas proprias linhas
- Index `idx_reply_logs_user_logged_at(user_id, logged_at desc)` pra performance da view

### sync.ts: queries novas

- `pullMyReplies(filters)`: retorna ate 200 replies do user logado, filtravel por workspace / decisao / has_url / author_handle (ilike) / ultimos N dias
- `updateReplyMetrics(replyLogId, updates)`: PATCH em reply_logs com auto-set de `metrics_updated_at = now()`

### MyRepliesView.tsx (nova)

[`src/sidepanel/components/MyRepliesView.tsx`](src/sidepanel/components/MyRepliesView.tsx) — tela completa:

**Filtros (top):**
- Workspace: so atual ou todos
- Decisao: todas / postadas / descartadas / ignoradas
- URL postada: qualquer / so verificadas / sem URL
- Ultimos N dias (1-365)
- Busca por handle (ilike, Enter pra aplicar)

**Lista de reply rows:**
- Header: @handle (link X), badge da decisao, badge QT se aplicavel, badge "verificada" se tem posted_reply_id, badge tier autor, data
- Card compacto do tweet original (line-clamp-2)
- Reply text completo (com flag "editada" se foi alterada)
- Link "abrir no X" se tem posted_reply_id

**Editor de metricas (collapsivel por linha):**
- 4 number inputs: likes, RTs, replies, quotes
- Checkbox "OP respondeu de volta" (sinal mais forte que engaged)
- Checkbox "OP engajou (like/follow/etc)"
- Textarea de notas livres
- Read-only: scores originais (persona/eng/combined) + categoria
- Status "salvo ha 3min" + botao "salvar metricas" com flash visual

### Header

Botao novo "replies" entre "atividade" e "posts" — abre `view: "my-replies"`.

### Why isso importa

Antes V4.1.2:
- Reply era postada, marcada como `posted` em reply_logs, e fim
- Analytics admin agregava por decision mas nao tinha noção do **resultado real** das replies
- Treino futuro do selection scorer ficava cego — sabia o input (scores) e o ato (postou) mas nao o **outcome** (engajou? virou conversa?)

Depois V4.1.2:
- Analista revisita replies recentes e enriquece com dados reais que so ele consegue (likes na propria reply, OP respondeu, virou DM)
- Painel admin futuro pode mostrar conversion rate (eng_potential_score vs actual_likes)
- LLM scorer pode ser fine-tuned no futuro com esses pares (input → outcome real)

### Bump version

`0.4.4` → `0.4.5`. `releases/replai-v4.0.5.zip` (300 KB).

### Pra subir

1. Rodar `supabase/migrations/0006_reply_metrics_manual.sql` no Supabase
2. Subir `replai-v4.0.5.zip` no CWS dashboard

---

## V4.1.1 — 2026-06-26, batches grandes + Watchtower integration real

Continuacao da V4.1.x apos feedback. Duas frentes:

### Batches realmente grandes + multi-list merged

- `Config.maxBatch` ceiling **subiu de 100 → 200** (Gemini Flash da conta sem problemas com batch grande)
- `Config.maxPages` ceiling **subiu de 10 → 20** (mais paginas TwitterAPI por refresh, menos cliques no atualizar)
- Novo `Config.fetchAllLists: boolean` — quando workspace tem **2+ listas** configuradas, toggle pra buscar de TODAS em paralelo e fundir resultados num unico batch LLM
- [`src/lib/orchestrator.ts`](src/lib/orchestrator.ts) `resolveListsToFetch(config)` decide quais listas buscar; fetches em paralelo via `Promise.all` com fallback por-lista (se uma falha, outras seguem)

### Engagement metrics (parse + viral score)

- Novo `RawTweet.engagement: TweetEngagement` com `likeCount`, `retweetCount`, `replyCount`, `quoteCount`, `viewCount`, `bookmarkCount`
- [`src/lib/twitterapi.ts`](src/lib/twitterapi.ts) `parseEngagement` extrai dos campos camelCase/snake_case da TwitterAPI.io
- Helper `viralScore(tweet)`: ponderacao `likes + RT*2 + replies*3 + quotes*4` (replies/quotes sao sinais mais fortes de discussao real)

### Aba Posts — integracao Watchtower (Notion) real

Substitui scaffolding pela implementacao end-to-end:

**Cliente Notion** ([`src/lib/notion.ts`](src/lib/notion.ts)):
- Internal integration token (secret_xxx), sem OAuth (mais simples pro caso interno)
- `listBlockChildren(token, pageId)` — pagina ate 1000 blocos
- `blocksToText(blocks)` — converte blocos Notion (heading, paragraph, list, quote, code, callout, etc) pra markdown-ish
- `fetchTodayWatchtower(token, parentPageId)` — busca child_pages, faz match por data (formatos: `YYYY-MM-DD`, `DD/MM/YYYY`, `DD de mes`, etc), retorna conteudo do dia ou fallback pro mais recente
- `extractNotionPageId(input)` — aceita URL completa ou ID puro com/sem hifens

**Posts suggestion engine** ([`src/lib/posts-suggestion.ts`](src/lib/posts-suggestion.ts)):

Pipeline `suggestPosts(workspace, notionToken)`:
1. Pull do Watchtower de hoje (opcional, com token + page_id)
2. Pull dos viral posts da Lista ativa (top-15 das ultimas 24h por viralScore)
3. Query agregada de categorias mais usadas em replies recentes da persona (limit 50, supabase)
4. Chamada Gemini Flash com prompt cross-referenciando os 3 + voz do workspace
5. Retorna 5-10 `PostSuggestion` com angle/hook/body/why/category

Custo total: ~$0.002/refresh.

**PostsView nova** ([`src/sidepanel/components/PostsView.tsx`](src/sidepanel/components/PostsView.tsx)):
- Auto-fetch ao abrir + botao "regerar"
- Avisos de config faltando (sem token Notion, sem page_id, sem voz, etc) explicitos
- Stats: Watchtower carregado? Quantos virais? Top categorias?
- Cards de sugestao com angle/category badges, hook destacado, body editavel-quase (so copy + abrir no X), why-rationale, char counter 280
- Details expansiveis: viral posts usados como input + Watchtower bruto
- Botoes copy + "abrir no X" (intent URL com texto pre-preenchido)

**Settings** ([`src/sidepanel/components/Settings.tsx`](src/sidepanel/components/Settings.tsx)):
- Bloco novo "Notion API token" nas Chaves (per-profile)
- Bloco novo "Watchtower Daily Digest" (per-workspace, normaliza URL/ID na hora)

**Migration** ([`supabase/migrations/0005_notion_integration.sql`](supabase/migrations/0005_notion_integration.sql)):
- `profiles.notion_api_token text null` — coluna nova, encriptada at-rest pelo Supabase
- View `notion_adoption` pra trackear adocao (security_invoker)

### Como o time configura o Watchtower (1x)

1. Cria Internal Integration em https://www.notion.so/profile/integrations → copia `secret_xxx`
2. Vai pra pagina `Watchtower Daily Digest` no Notion → Share → Add connections → escolhe a integration
3. Em Replai Settings → cola o token em "Notion API token"
4. Cola a URL ou ID da page em "Watchtower Daily Digest" do workspace
5. Aba Posts puxa sozinho

### Bump version

`0.4.3` → `0.4.4`. `releases/replai-v4.0.4.zip` (297 KB).

### Migracoes Supabase

Antes do deploy, rodar (alem das anteriores ja aplicadas):
- `supabase/migrations/0005_notion_integration.sql`

### Notas

- Se Notion API estiver fora ou page sem permissao, PostsView mostra warnings explicitos e segue com so viral posts + categorias (sugestoes ficam mais fracas mas funciona)
- Date matching do Watchtower e best-effort — se page do dia nao tem titulo no formato esperado, cai pro mais recente
- Posts sugeridos NAO vao automaticamente pro X — analista revisa, copia, posta. Mesmo padrao do reply flow

---

## V4.1.x — 2026-06-26, expansao completa pos-feedback do time

Em cima da V4.1, time pediu pra trazer pra dentro desta release todas as 6 features que estavam deferidas pra V4.2. Resultado: V4.1.x e o release que efetivamente entrega a visao do plano completo.

### Camada de inteligencia cross-data (2.11)

Modulo novo [`src/lib/intelligence.ts`](src/lib/intelligence.ts) com 3 sub-camadas:

- **A. `analyzePost`** — analise local (regex + heuristica) de cada tweet:
  - `entities`: mentions, tickers (`$XYZ`), hashtags, URLs externas
  - `topics`: 10 categorias semanticas via keyword match (ai-llm, macro-fed, crypto, startup-fundraise, product-launch, hiring, engineering, design-ux, fintech, marketing-growth)
  - `claim_type`: opinion / fact_claim / question / announcement / personal / joke / thread_continuation
  - `engagement_hooks`: tem pergunta aberta? tem afirmacao polemica?
  - `data_gaps`: lista declarativa do que NAO temos (sinal de incerteza pro LLM)
  - Cache 24h em chrome.storage.local via [`src/lib/intelligence-cache.ts`](src/lib/intelligence-cache.ts) (LRU, max 1000 entries)

- **B. `getAuthorProfiles`** — agregacao batched do historico Supabase via funcao SQL `get_author_profiles(handles[])` (SECURITY INVOKER, respeita RLS). Por autor: interaction_count, engagement_back_rate, successful_categories, cooldown_recommended (3+ replies sem retorno em 30d), is_first_contact. Cache 1h.

- **C. `detectBatchRelations`** — padroes locais cross-batch: hot_topics (topico mencionado por 2+ tweets), co_mentioned_entities (entidade citada por multiplos autores).

`enrichWithIntelligence(tweets)` roda as 3 sub-camadas e anexa `.intelligence` a cada `EnrichedTweet`. Custo: Supabase ~50ms batched, restante local.

### Selection scorer dual (2.9)

Novo modulo [`src/lib/selection-scorer.ts`](src/lib/selection-scorer.ts) — 1 chamada Gemini 2.5 Flash batched que pontua cada tweet em 2 eixos:

- `persona_relevance` (0-100): tema alinhado com a voz da persona?
- `engagement_potential` (0-100): autor especifico provavelmente engajar de volta? (calibrado por tier mega/large/mid/small + sinais do intelligence layer — cooldown, first_contact, engagement_back_rate, hot_topic)
- `combined`: media ponderada (default 60% eng / 40% relevance, configuravel)

`applyScores(tweets, result, config)` separa visible (top-N por combined) de hidden (banner expansivel na triagem). Custo ~$0.001 por refresh, +1-2s na latencia. Pulado silenciosamente quando sem voz / sem chave Gemini / dryRun.

### Reply engagement-aware (2.10)

[`src/lib/skill-prompt.ts`](src/lib/skill-prompt.ts) ganha bloco novo "OBJETIVO ESTRATEGICO" antes do skill base. Calibra tom pelo tier do autor:

- **mega** (ISV >=90): foco em valor publico citavel, sem pergunta direta
- **large** (ISV 70-89): ancore em dado concreto que provoque curiosidade
- **mid** (ISV 40-69): tier sweet-spot, pergunta genuina + extensao de raciocinio
- **small** (ISV <40): tom direto, vale so se conteudo curto/aberto

Prompt instrui sobre cooldown_recommended (considera pular), is_first_contact (sem historico falso), successful_categories (preferencia pra UMA das replies).

`PayloadTweet.author_context` populado em [`src/lib/orchestrator.ts`](src/lib/orchestrator.ts) `buildAuthorContext` a partir de `EnrichedTweet` + scores. `deriveAuthorTier(isv, followers)` em intelligence.ts.

UI: TweetCard mostra chips de inteligencia discretos:
- tier (cores diferenciadas por mega/large/mid/small)
- score voz (cinza) + score eng (laranja)
- 1a interacao (verde)
- cooldown (vermelho)
- topico quente (amber)

PostConfirmDialog ganha checkbox opcional "o autor ja deu sinal de engajamento?" — vira `author_engaged_at_post` em `reply_logs` pra treino futuro do scorer.

### Imagens dos tweets (2.2)

- [`src/lib/twitterapi.ts`](src/lib/twitterapi.ts) `parseMediaFromRaw` extrai `entities.media[]`/`extendedEntities.media[]` da TwitterAPI.io. Normalizado em `RawTweet.media: TweetMedia[]` (photo/video/gif com url + thumbnailUrl).
- `normalizeRawTweet` aplicado em todos os pontos de entrada (fetchListTweets, fetchTweetsBatch, fetchTweetById).
- Multimodal LLM:
  - [`src/lib/anthropic.ts`](src/lib/anthropic.ts): imagens vao como content blocks `{type: "image", source: {type: "url", url}}` — Anthropic aceita URL direto, sem fetch.
  - [`src/lib/gemini.ts`](src/lib/gemini.ts): imagens baixadas + base64-encoded em chunks (evita stack overflow) + enviadas como `inlineData`. Limit MAX_IMAGES_PER_CALL=12.
- UI: TweetCard renderiza grid de thumbs (max 4) com tag de tipo (photo/video/gif) + click pra abrir em nova aba.

### Attachments per-tweet + per-reply (2.5)

- Estado `attachmentsByTweetId: Record<string, string>` em App.tsx (reseta a cada refresh).
- TweetCard tem botao paperclip discreto que abre input inline pra colar URL de report/artigo.
- `PayloadTweet.attachments?: PayloadAttachment[]` adicionado em types.
- `skill-prompt.ts` instrui o LLM: "Quando o payload incluir attachments, leia as URLs como contexto extra (sao reports/artigos anexados pelo analista). Use titulo/dominio como ancora, mas nunca invente conteudo."
- Suportado tambem no regen Dialog (URL opcional ao regerar reply individual).

### Regenerar reply individual (2.6)

- Nova funcao em [`src/lib/orchestrator.ts`](src/lib/orchestrator.ts) `regenerateSingleReply(workspace, tweet, replyIndex, existingReplies, opts)`.
- Chama LLM com payload de 1 tweet + flag `regen: { reply_index, keep_categories }`.
- skill-prompt detecta flag e instrui: "Retorne apenas 1 reply nova com categoria DIFERENTE das listadas em keep_categories."
- ReplyCard ganha botao "regerar" + Dialog com input opcional pra attachment URL.
- App `handleRegenerateReply` faz merge da nova reply no `rendered`, mantem as outras. Loading state inline (disabled em todos os botoes durante regen).

### Settings — bloco de selecao filter (2.9 UI)

Bloco novo apos "filtros e batch":
- Toggle ativar/desabilitar
- Input numerico topN (5-50)
- Slider "peso engajamento vs relevancia" (0-100%)

### Migracao Supabase

[`supabase/migrations/0004_intelligence_and_scores.sql`](supabase/migrations/0004_intelligence_and_scores.sql):
- `reply_logs` ganha: `persona_relevance`, `engagement_potential`, `selection_combined`, `author_engaged_at_post`, `author_tier`
- `session_logs` ganha: `selection_filter_hidden_count`, `selection_filter_avg_engagement`, `selection_filter_avg_relevance`
- Index `idx_reply_logs_author_handle(tweet_handle, user_id)` pra agregacao do scorer
- Funcao SQL `get_author_profiles(handles text[])` SECURITY INVOKER + grant authenticated

### Arquivos novos

- `src/lib/intelligence.ts` (300+ linhas)
- `src/lib/intelligence-cache.ts` (LRU local)
- `src/lib/selection-scorer.ts` (Gemini Flash scorer)
- `supabase/migrations/0004_intelligence_and_scores.sql`

### Bump version

`0.4.2` → `0.4.3`. `releases/replai-v4.0.3.zip` (290 KB).

### Rollout obrigatorio

1. Rodar migration 0004 no Supabase (`supabase db push` ou SQL Editor)
2. Subir `replai-v4.0.3.zip` no CWS Dashboard → Pacote → Enviar pacote novo
3. Atualizar notas para o avaliador (mencionar version + multimodal use de imagens)
4. Submit for review

### Notas sobre o filtro de selecao

- Default `enabled: true` quando ha voz no workspace
- Default `topN: 15` (configuravel 5-50)
- Default `engagementWeight: 0.6` (60% peso pra engajamento, 40% relevancia)
- Quando sem chave Gemini ou sem voz, filtro pula silenciosamente e todos os tweets aparecem na triagem (zero regressao)

---

## V4.1 — 2026-06-26, bugfixes pos-release + UX expansion

Primeira atualizacao depois do go-live na Chrome Web Store. Foco em 2 bugs P0 que travavam adocao do time alem da Cabral, mais 5 melhorias funcionais que vieram da operacao usando o produto na pratica. Features mais profundas (camada de inteligencia, selection scorer, engagement-aware reply, imagens, attachments, regen individual) ficaram planejadas para as versoes seguintes e serao implementadas em V4.2.

### Bugs P0 corrigidos

- **RLS workspaces INSERT falhando pra analistas nao-admin** (Sync error "USING expression"). Causa real: race entre handle_new_user trigger e o primeiro `pushWorkspace` apos login, agravado por erro silencioso no log. Fix em 3 camadas:
  - Migration [`supabase/migrations/0002_workspace_rls_relax.sql`](supabase/migrations/0002_workspace_rls_relax.sql): policy INSERT/UPDATE agora exige `(select auth.uid()) is not null` explicitamente
  - Retry 1x com backoff 500ms em [`src/lib/sync.ts`](src/lib/sync.ts) `pushWorkspace` cobre o race
  - `SyncError.isRlsError` flag pra detectar 42501; `logCloudError` em storage.ts agora reescreve mensagem RLS pra texto amigavel ("permissao negada pelo Supabase, tente sair e logar de novo")

- **Nome do workspace nao persistia** (voltava pro nome antigo apos refresh). Causa: `pullAll()` reescrevia local com cloud sem preservar pushes em voo. Fix em [`src/lib/storage.ts`](src/lib/storage.ts):
  - Novo `inFlightPushes: Set<string>` rastreado em `saveWorkspace` (try/finally)
  - `pullAll` agora faz **merge nao-destrutivo**: comeca de localMap, overlaya cloud, PULA workspaces em-flight
  - Workspaces locais com `createdAt > 60s` que nao estao no cloud sao limpos (defesa contra contas trocadas no mesmo device)
  - `getActiveWorkspace` fallback menos agressivo: preserva localActiveId antes de cair pro "mais recente por updated_at"
  - `App.tsx handleRenameWorkspace` ganha feedback visual ("workspace renomeado pra X")

### Botao Quote Tweet (QT)

Cada ReplyCard tem botao "QT" alem do "responder". Abre intent do X com `?text=...&url=<tweetUrl>` (X infere quote tweet quando URL de tweet vai como anexo). PostConfirmDialog detecta `actionType` e mostra "voce postou esse Quote Tweet?" em vez de "essa reply".

- [`supabase/migrations/0003_decision_type.sql`](supabase/migrations/0003_decision_type.sql) adiciona coluna `reply_logs.decision_type` (`'reply'` ou `'quote_tweet'`)
- ReplyCard, TweetCard, App.tsx, PostConfirmDialog propagam `actionType` end-to-end ate o reply_logs

### Batches maiores no fetch

- `Config.maxPages` configuravel em Settings (default 4, range 1-10). Cada pagina = 1 chamada TwitterAPI (paga), mas reduz cliques no "atualizar" e cooldowns
- Default `maxBatch` subiu de 25 → 50 (analista pode descer pra 15-25 se preferir batches menores)
- `fetchListTweets` em twitterapi.ts agora aceita maxPages como param do orchestrator

### Prompt base editavel por workspace (replies menos genericas)

Bug de UX: SKILL.md hardcoded era dominante demais e voz custom virava adendo. Replies saiam genericas mesmo com voz detalhada.

- `Config.basePrompt?: string` em [`src/lib/types.ts`](src/lib/types.ts) — vazio = usa SKILL.md default; preenchido = sobrescreve
- `buildSystemPrompt` em [`src/lib/skill-prompt.ts`](src/lib/skill-prompt.ts) **INVERTE A PRECEDENCIA**: agora monta voz no TOPO (define o tom), base no meio (regras tecnicas), lembrete no fim (compliance). LLMs respeitam mais o que abre e fecha o contexto
- Novo bloco amber em Settings (paralelo ao bloco violeta da voz): textarea + upload .md/.pdf/.txt (reusa `extractTextFromFile`) + botao "voltar pro default"
- Suporta upload de arquivo (mesma logica do upload de voz)

### Multiplas Listas por workspace + dropdown no Header

- `Config.lists: WorkspaceList[]` + `Config.activeListId` em types.ts
- Backfill silencioso em [`src/lib/storage.ts`](src/lib/storage.ts) `ensureListsBackfill`: workspace V4.0 com `listId` ganha automaticamente `lists: [{ id, name: "Lista 1", listId }]`
- Settings tem novo bloco "Listas do X deste workspace" pra adicionar/remover/renomear listas + radio pra ativar
- Header mostra dropdown ativa-lista quando `lists.length > 1` (acima dos botoes de acao)
- App.tsx ganha `handleSwitchActiveList` que sincroniza `activeListId` + `listId` top-level + limpa cache de sessao
- Orchestrator resolve `resolvedListId = config.lists.find(l => l.id === config.activeListId)?.listId ?? config.listId` em runTriage e runQuickTest

### Aba Posts (scaffolding pra Watchtower)

Nova view `"posts"` no App.tsx + botao "posts" no Header (entre atividade e admin). Componente [`src/sidepanel/components/PostsView.tsx`](src/sidepanel/components/PostsView.tsx) com placeholder e TODO inline documentando integracao Notion futura (pagina Watchtower Daily Digest). Zero fetch real nesta release — pura UI scaffolding pra preparar V4.2.

### Plano LinkedIn (planejamento, sem codigo)

O plano (documento interno, fora do repo) detalha:
- 3 opcoes de fonte de dados (content script, Unipile, LinkedIn API oficial) com pros/cons
- Channel abstraction proposta (provider pattern)
- Schema changes futuras (channel column em reply_logs/replied_tweets/workspaces)
- Roadmap 6-7 semanas distribuido em 4 fases (A pesquisa → B refactor X em provider → C provider LinkedIn → D analytics)
- Riscos (ToS LinkedIn, compliance, manutencao scraper) + decisoes pendentes do time

### Deferido pra V4.2 (planejado, nao implementado nesta release)

Estas features estao detalhadas no plano e foram dimensionadas, mas o escopo era grande demais pra uma release so. Ordem recomendada quando voltar:

1. **Camada de inteligencia cross-data** (2.11 no plano): `analyzePost` + `getAuthorProfile` (Supabase historico) + `detectBatchRelations`. Base pra scorer + reply prompt
2. **Selection scorer dual** (2.9): Gemini Flash batch ranqueia tweets por (persona_relevance + engagement_potential), default top-15 visiveis na triagem
3. **Reply engagement-aware** (2.10): prompt enriquecido com author_context (tier mega/large/mid/small) + instrucao explicita pra engajar autor especifico
4. **Imagens dos tweets** (2.2): parse de media na twitterapi, multimodal nas LLM calls (Anthropic/Gemini), grid de thumbs nos cards
5. **Attachments per-tweet + per-regen** (2.5): URL extra como contexto adicional pro LLM, paperclip no TweetCard
6. **Regenerar reply individual** (2.6): botao refresh no ReplyCard com Dialog, mantem outras 2 replies

### Migracoes Supabase nesta release

```
supabase/migrations/0002_workspace_rls_relax.sql  -- relax INSERT/UPDATE workspaces
supabase/migrations/0003_decision_type.sql         -- reply_logs.decision_type
```

Rodar antes do deploy: `supabase db push` ou rodar manualmente no SQL Editor.

### Version bump

`0.4.1` → `0.4.2`. Rebuild + rezip + upload no Chrome Web Store como atualizacao.

---

## V4.0 — 2026-06-15, cloud-native + admin role + Web Store ready

Versão grande que transforma o Replai de POC local em produto utilizável pelo time inteiro. Saímos de configuração por device, dados locais e distribuição manual via zip, e chegamos em login Google único, sync cross-device via Supabase, painel admin com analytics rico, e prep completo pra publicação Chrome Web Store Unlisted.

### Backend Supabase (8 tabelas + RLS + admin role)

Tudo passa pelo Supabase agora (cliente JS na extension via [`src/lib/supabase.ts`](src/lib/supabase.ts) com `chromeStorageAdapter` pra session persistir entre restarts). Schema completo em [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql):

- `profiles` — 1 row por analista, com chaves API encriptadas at-rest (AES-256 via Supabase EBS), `active_workspace_id` cross-device, `total_replies` denormalizado via trigger
- `user_roles` — admin vs analyst (tabela dedicada, NÃO coluna em profiles, pra evitar recursão RLS). Função `is_admin()` SECURITY DEFINER usada em todas policies
- `workspaces` — config jsonb por workspace (listId, voice, voice_source, twitter_handle, llm_provider, model, filtros)
- `voice_versions` — histórico imutável da voz por workspace, dedup por hash SHA-256, version sequencial. Pra A/B test futuro
- `replied_tweets` — marker simples "já respondi este tweet" (unique por workspace+tweet)
- `session_logs` — 1 row por clique em "atualizar", captura sessões inteiras incluindo as que falharam. Tokens LLM + custo + erros
- `reply_logs` — 50+ colunas por reply disparado: tweet meta (autor, thread, content, timing), voice snapshot, config snapshot, all candidates, decision (`posted`/`skipped`/`edited_only`/`ignored`), `posted_reply_id`, custo LLM. Tabela principal pra analytics
- `events` — telemetria operacional sanitizada (sem chaves nos payloads)

RLS pattern: `(select auth.uid()) = user_id OR is_admin()`. View `admin_overview` com `security_invoker = true` pra agregados respeitando role.

### Auth + restrição @moicdigital

- Google OAuth via `chrome.identity.launchWebAuthFlow` ([`src/lib/auth.ts`](src/lib/auth.ts)), integrado com Supabase Auth (PKCE flow)
- Trigger `handle_new_user` no Postgres rejeita emails que não batem `@moicdigital\.` — defesa server-side. Frontend ([`src/lib/auth.ts`](src/lib/auth.ts) `DomainNotAllowedError`) também valida pra UX boa
- Trigger cria automaticamente row em `profiles` (com `name = email_prefix` se Google não devolver full_name) + `user_roles` com role `analyst`
- Session persiste cross-restart via `chrome.storage.local` (adapter customizado em [`src/lib/chrome-storage-adapter.ts`](src/lib/chrome-storage-adapter.ts))
- Logout limpa cache local mas mantém profile/workspaces no cloud — re-login restaura tudo automaticamente

### Sync cross-device

- Cloud-first writes + cache-first reads ([`src/lib/storage.ts`](src/lib/storage.ts))
- Background polling 15min via `chrome.alarms` ([`src/background/index.ts`](src/background/index.ts)) chama `pullAll()`
- `pullAll` filtra workspaces pra só os do user atual (admin vê outros via AdminPanel, não no dropdown principal)
- Fallback de active workspace: profile.active_workspace_id se válido, senão workspace mais recente (`updated_at`)
- Banner aria-live no topo da App pra surface de erros silenciosos de sync (`onSyncError`)

### Voz por workspace (substitui `custom_prompt` da V3)

- Cada workspace tem voz própria: texto livre OU upload `.md`/`.pdf`/`.txt` ([`src/lib/voice-loader.ts`](src/lib/voice-loader.ts) com pdfjs lazy-loaded)
- Voz vira parte do system prompt do LLM ([`src/lib/skill-prompt.ts`](src/lib/skill-prompt.ts) → `buildSystemPrompt(voice)`). SKILL.md fica genérico (anti-tropes, categorias); voz é o que diferencia
- Versionamento automático em `voice_versions` ([`src/lib/voice-versions.ts`](src/lib/voice-versions.ts))
- Settings exibe textarea destacada (border violeta) + botão upload
- Campo novo `twitter_handle` por workspace (pra scraping futuro de engagement)
- Removido conceito de "persona estruturada" da V3 — voz texto livre é suficiente

### Triage flow (economia de tokens)

Antes: "atualizar" → fetch + filtro + LLM em batch → mostra cards. LLM gastava tokens em tweets que o analista nem ia usar.

Agora ([`src/lib/orchestrator.ts`](src/lib/orchestrator.ts) `runTriage` + `generateRepliesForSelected`):
1. "atualizar" → fetch + filtro **sem LLM** → mostra triage view ([`src/sidepanel/components/TriageView.tsx`](src/sidepanel/components/TriageView.tsx))
2. Analista escolhe quais quer responder (modo **swipe** tipo Tinder por default, ou **lista** com checkboxes — toggle persiste em `chrome.storage.local.triage_mode`)
3. "gerar replies" → LLM SÓ pros selecionados → cards
4. Loading overlay enquanto LLM processa (não silencioso mais)

SwipeCard ([`src/sidepanel/components/SwipeCard.tsx`](src/sidepanel/components/SwipeCard.tsx)): pointer events + keyboard arrows (← skip, → like).

### PostConfirmDialog enriquecido

Dialog pós-clique de "responder" ([`src/sidepanel/components/PostConfirmDialog.tsx`](src/sidepanel/components/PostConfirmDialog.tsx)) refatorado:
- Mostra tweet original + reply text completos (não só `tweet_id.slice(0,12)`)
- Reply editável (analista pode colar texto final se mudou no composer)
- **Campo URL/ID da reply destacado** com borda colorida + instrução clara ("volta no X, ... → Copy link"). URL preenchida → badge verde "verificada"
- Decision: `posted` (URL coletada → `verified` mais forte) / `skipped` / `edited_only` (futuro)

### AdminPanel ([`src/sidepanel/components/AdminPanel.tsx`](src/sidepanel/components/AdminPanel.tsx))

Visível só pra users com role admin. 3 abas:
- **Visão geral** — totais agregados do time, top 5 analistas, custo LLM acumulado, toggle "contar só replies verificadas (com URL postada)"
- **Analistas** — lista com click-expand inline: stats individuais + botões promover/revogar admin + export específico desse analista (CSV/JSON)
- **Exportar (geral)** — filtros (data, analista, workspace, categoria) → download CSV/JSON. Paginação automática até 50k linhas. 4 tabelas exportáveis: reply_logs, replied_tweets, session_logs, events

Refresh do cache `isAdmin` (TTL 5min em `chrome.storage.local.is_admin_cached`).

### Reply logs — 50+ colunas por reply

Capturadas em [`src/lib/sync.ts`](src/lib/sync.ts) → `pushReplyLog` + helpers em [`src/lib/tweet-meta.ts`](src/lib/tweet-meta.ts) (`extractAuthorMeta`, `extractTiming`, `extractThreadInfo`, `extractContentMeta`):

- Ownership: user_id, user_email, workspace_id/name, session_id (FK)
- Voice: voice_version_id (FK), voice_snapshot (inline backup)
- Config snapshot: jsonb com timeWindowHours, maxBatch, model, etc no momento (pra A/B de hyperparams)
- Tweet básico: id, url, handle, text, lang, ISV, is_poi, inferred_layer
- Tweet autor: followers, is_automated, verified, display_name
- Tweet timing: created_at, age_minutes
- Tweet thread: is_reply, in_reply_to_username, conversation_id, is_quote, quoted_handle/text, is_limited_reply, thread_size
- Tweet content: char_count, has_media, has_links, hashtags[], mentions[], emoji_count
- Reply: text final, text original (LLM raw), category, pattern, index, all_candidates jsonb
- Decision: was_edited, posted_confirmed, posted_at, posted_reply_id, decision enum, time_to_decide_ms
- LLM meta: provider, model, input/output tokens, cost_usd

Indexes em (user_id, workspace_id, logged_at), category+decision, pattern+decision, posted_reply_id partial.

### Design system primitives

[`src/sidepanel/ui/`](src/sidepanel/ui/) com:
- `tokens.css` (em [`src/sidepanel/styles.css`](src/sidepanel/styles.css)) — variáveis CSS pra cores semânticas, font sizes, spacing, radius (mata os `text-[10px]` hardcoded)
- `Button.tsx` — primary | ghost | danger | subtle | success variants
- `Badge.tsx` — substituiu badges duplicados de ISV/layer/POI/lang
- `Alert.tsx` — info | success | warning | error com aria-live built-in
- `Dialog.tsx` — role="dialog" + aria-modal + focus trap + Esc fecha
- `Input.tsx` / `Textarea.tsx` / `Select.tsx` — wrappers com focus-visible
- `Tabs.tsx` — usado em AdminPanel
- `SectionHeader.tsx`

[`src/lib/constants.ts`](src/lib/constants.ts) centraliza `CATEGORY_LABELS` (antes duplicado em ReplyCard + Dashboard).

### Cost tracking

[`src/lib/cost-calc.ts`](src/lib/cost-calc.ts) com pricing por modelo (Anthropic Opus/Sonnet/Haiku, Gemini Flash/Pro). `estimateCost(provider, model, in_tokens, out_tokens)` retorna USD com 6 casas. `formatCostUsd` pra display. Roda em cada `generateRepliesForSelected` e salva em `session_logs.llm_cost_usd` + `reply_logs.llm_cost_usd`.

### Web Store prep

- Privacy policy completa em [`docs/privacy-policy.md`](docs/privacy-policy.md) cobrindo Limited Use (Google API Services), admin access, data retention
- Checklist completo em [`docs/web-store.md`](docs/web-store.md)
- Manifest atualizado: `downloads` removido (não precisava), Supabase host_permissions **pinnado** no subdomain específico (não wildcard, evita warnings na review)
- OAuth Consent Screen no GCP setado como **Internal** (sem verification process, sem 100-user cap, só funciona se @moicdigital é Google Workspace)
- Version bump pra 0.4.0

### Build modes simplificados

Antes: `build`, `build:team`, `build:public`, `build:v3` (4 modos de distribuição manual via zip). Com Web Store unica, sobra:
- `dev` — vite serve pra hot reload local (UI isolada com mocks)
- `build` — production build pra Web Store (tsc + vite build)
- `preview` / `preview:ui` — auxiliares

Deletados: `env/.env.team`, `env/.env.public`, `env/.env.v3` + scripts correspondentes.

### Fixes pos-V3 importantes

- **Chaves persistem cross-device**: refatoradas pra viverem só em `profiles.*_api_key`. Settings agora lê/escreve direto via prop. `profileDeltaFromConfig` defensivo (nunca push key vazia que sobrescreveria uma boa)
- **pushProfile** virou upsert (auto-cria profile se trigger não rodou pro user existente — defesa contra dropping schema + recreating)
- **Active workspace fallback**: se `profile.active_workspace_id` aponta pra workspace deletada, cai no mais recente do user (não cria Default novo)
- **pullAll** filtra workspaces pra só os do user atual (admin não vê alheios no dropdown principal)
- **Boot do App.tsx** força `pullAll` antes de ler cache local (resolve "key sumiu apos reload")
- **CATEGORY_LABELS** duplicado removido — `lib/constants.ts` é única source of truth

### Reorganização docs

Estrutura flat em `docs/` (consolidada):
- `SETUP.md` — dev onboarding completo (Supabase + OAuth + build + bootstrap admin)
- `ARCHITECTURE.md` — diagrama + critical files + schema das 8 tabelas
- `ADMIN.md` — bootstrap role + queries SQL (analytics, voice versions, session logs)
- `DEVELOPERS.md` — LLM providers + como adicionar novo
- `guia.md` — guia do analista (final-user)
- `TROUBLESHOOTING.md` — erros comuns
- `web-store.md` — checklist Chrome Web Store submission
- `privacy-policy.md` — politica de privacidade
- `archive/` — V1/V2 historicos preservados (briefing, twitterapi-cost, v1-update-prompt)

---

## 2026-06-07, qualidade das replies e setup inicial

Sessão focada em três frentes: tirar atrito do fluxo de responder no X, garantir que workspace novo ou fresh install sempre passa por configuração antes de rodar, e dar ao LLM o contexto completo de QTs e replies (que antes ficava só com o handle do parent).

### Botão "responder" direto no X

Cada reply gerada agora tem um botão **responder** (que substituiu o "copiar"). Ao clicar:

- Abre uma aba do X em `intent/post?in_reply_to=<id>&text=<texto>`, com o texto da sugestão (ou da sua edição inline) já preenchido no composer.
- Marca o tweet como respondido automaticamente, vai pro final da lista e fica esmaecido.

**O que muda na prática:** dois passos viraram um. Antes era copiar, alternar pro X, achar o tweet, clicar reply, colar. Agora o composer abre pronto. O botão "marcar" do card continua existindo pra desfazer.

### Replies não truncam mais

O textarea de cada reply usava `field-sizing: content` (CSS novo do Chrome 123+) pra auto-crescer. Em navegadores que não suportam, o campo travava em duas linhas e cortava replies longas visualmente.

**Correção:** auto-resize via JS, com `useEffect` que ajusta a altura pelo `scrollHeight` a cada mudança de texto. Funciona em qualquer navegador. Validado headless: textareas ficaram entre 52-70px, proporcionais ao texto, sem truncamento.

### Setup inicial sempre em settings

Antes, fresh install ou criar workspace novo podia já cair na tela principal com a config padrão sem o analista revisar. Agora:

- **Fresh install:** flag `setup_seen` no storage começa `false` → App força a tela de configurações. Depois do primeiro "salvar", marca como true, abre na main daí em diante.
- **Workspace novo:** `handleCreateWorkspace` faz `setView("settings")` explícito, mesmo se a config foi duplicada de outro workspace.

**O que muda na prática:** o analista sempre é apresentado às opções (persona, Lista, idioma, dry-run, etc.) antes de começar. Reduz o cenário "atualizei e não saiu nada" porque tinha config errada que nunca foi revisada.

### Lista da Shira como padrão + grafo novo

`DEFAULT_CONFIG.listId` aponta agora pra Lista nova `2062525705263423672`, muito mais ativa: 75 tweets/página dentro de 5h, vs a antiga onde quase tudo era >10h.

Grafo bundled também trocado pelo `node_metrics.csv` que a Shira gerou:

| | Antes | Agora (Shira) |
|---|---|---|
| Handles | 3057 | 1803 (mais curado) |
| POIs | 14 | **24** |
| Layers | 1: ? · 2: 137 · 3: 3235 | 1: 24 · 2: 310 · 3: 1469 |
| Cobertura da Lista nova | — | 43 de 47 autores (91%) |

Novo script `scripts/convert-graph.mjs` faz a conversão CSV→JSON sem dependências externas, pra próximas atualizações do grafo virem rápido.

### Janela padrão de 10h

`DEFAULT_CONFIG.timeWindowHours` mudou de 24 pra **10**. Reflete o uso real: numa Lista ativa, a vida útil de um post-a-responder é curta (após 10h, reply tem pouca tração). A janela continua editável em settings pra quem quiser mais.

### Context completo pra QT e Reply

A TwitterAPI tinha um gap: pra **replies**, devolvia só `inReplyToId` + `inReplyToUsername`, sem o texto do tweet pai. Antes o context que ia pro LLM dizia apenas `reply to @x` — o modelo não tinha noção do que estava sendo respondido.

Implementação:

- Novo `fetchTweetsBatch(ids[], key)` em [twitterapi.ts](src/lib/twitterapi.ts): pega múltiplos tweets numa só request (chunked em lotes de 100).
- Helper `enrichReplyParents` em [orchestrator.ts](src/lib/orchestrator.ts): entre o dedup e o prefilter, identifica replies dentro da janela com `inReplyToId`, faz **uma** batch request pra todos os parents distintos, anexa em `raw.parent_tweet`.
- `buildContext` em [prefilter.ts](src/lib/prefilter.ts) inclui o texto do parent quando disponível.

Comparativo validado ao vivo com um reply do @sama:

| | Context que ia pro LLM |
|---|---|
| **Antes** | `reply to @sama` |
| **Agora** | `reply to @sama: 'customers are increasingly asking us for certainty on capacity. as models get better, we expect that the world will be capacity-constrained for some time. we are offering discount...'` |

Best-effort: se a batch falhar (rate limit, tweet deletado, parent protegido), a sessão segue normal com o context só de username. QT já funcionava antes (a API devolve `quoted_tweet` inline), continua igual.

Aproveitando, o **quick test** também passou a usar `buildContext`. Antes setava `context: null` direto — perdia inclusive o context de QT. Agora QT e parent fetch funcionam consistentes tanto na Lista quanto no quick test.

**Custo:** ~$0.00015 por parent fetched, uma batch request por sessão. Pra uso típico (5-15 replies por sessão), ~$0.001-0.002. Desprezível.

**O que muda na prática:** replies que continuam threads agora têm contexto real. O LLM distingue "respondendo a uma pergunta sobre X" vs "fazendo uma afirmação solta". Qualidade das sugestões aumenta bem nesses casos, que antes geravam respostas genéricas.

### Resumo numa frase

Reply direto no composer do X, replies sem truncamento, fresh install sempre em settings, Lista e grafo da Shira como padrão, janela default de 10h, e finalmente o LLM tem o texto do tweet pai pra replies que continuam threads.

---

## 2026-06-01, release multi-analista

Essa sessão tirou o Replai do modo "POC pessoal" e deixou ele pronto pra **uso simultâneo por vários analistas**, cada um com seu contexto isolado. Quem usava antes não perde nada, a configuração atual vira automaticamente um workspace "Default" no primeiro carregamento.

### Workspaces

Você agora consegue ter **vários contextos isolados** dentro da mesma extensão. Cada workspace é uma "caixa" com sua própria Lista do X, chaves de API, persona, CSV de grafo e histórico, totalmente independentes.

- Trocar entre workspaces pelo dropdown no header. Tudo muda junto: configurações, replies geradas, marcações.
- Criar workspace novo (vazio ou duplicando um existente, útil pra testar variações de persona).
- **Exportar workspace** como arquivo JSON pra compartilhar com colegas ou fazer backup.
- **Importar workspace** a partir de um JSON exportado, cria um novo contexto pronto.
- Renomear e excluir, com confirmação inline.

**O que muda na prática:** um analista pode manter "Cliente A", "Cliente B" e "Teste de voz nova" como workspaces separados, alternando em um clique. Compartilhar uma config de cliente que funcionou bem com o time virou questão de mandar um arquivo.

### Persona / contexto customizado

Campo de texto livre no settings onde o analista descreve o ângulo que quer pras replies (ex: "sou VC de fintech, foco em B2B, priorize replies que citem fundadores que escalaram esse playbook").

- Influencia o conteúdo e os ângulos das replies sem mexer no código.
- Um badge **persona** aparece no header sempre que está ativa, pra ficar visível.
- A regra de idioma é **inviolável**: tweet em inglês recebe reply em inglês mesmo que a persona esteja escrita em português. Isso foi um detalhe sutil mas crítico, sem ele, o LLM puxava as replies pro idioma da persona.

**O que muda na prática:** dá pra moldar a voz por contexto sem precisar criar prompt novo. Testado ao vivo: persona "VC de fintech" trouxe referências a Hamilton Helmer / 7 Powers (livro real e relevante pro contexto), sem inventar dados.

### Provider de LLM trocável

Gemini 2.5 Flash virou o provider padrão (free tier, **1500 requisições/dia grátis**). Claude Sonnet 4.6 continua como alternativa paga, alternável por radio button nas configurações.

- Troca entre providers sem mexer no código nem rebuildar.
- Cada provider valida a chave certa antes de chamar.

**O que muda na prática:** começar a usar não custa nada, só a TwitterAPI. Quem quiser qualidade de Claude liga em um clique.

### Upload de CSV de grafo

Antes, atualizar o `node_metrics` (a tabela de ISV / POIs) significava trocar o arquivo no código e rebuildar. Agora dá pra subir **direto na interface**, por workspace.

- Aceita CSV padrão com cabeçalho `handle,isv,inferred_layer,is_poi`. Ordem das colunas livre.
- Preview antes de salvar mostrando as 5 primeiras linhas parseadas + contadores + erros visíveis.
- "Voltar pro bundled" se quiser cancelar e usar o grafo padrão de novo.
- O grafo bundled continua disponível como fallback (hoje 3057 handles, 14 POIs).

**O que muda na prática:** atualizar o grafo virou trabalho de UI. Cada analista pode ter um grafo próprio por workspace (cliente A com universo X, cliente B com universo Y).

### Quick test por URL

Seção "testar um tweet específico" no topo do painel: cola a URL de um tweet qualquer, gera replies só pra ele.

- Pula o filtro da Lista, o analista escolheu esse tweet a dedo.
- Roda com a persona ativa do workspace.
- Mesma TwitterAPI, mesmo LLM, mesmo cooldown.

**O que muda na prática:** acelera muito o loop de calibração de persona. Ao invés de esperar um tweet relevante aparecer na Lista pra ver como a reply sai, você cola um exemplo concreto e itera.

### Painel de tweets

- **Editar replies inline.** Cada reply é editável com contador de caracteres. As edições **persistem**: fechar e reabrir o painel mantém o que você escreveu (antes perdia tudo).
- **Marcar como respondido.** Botão em cada card. Tweet marcado fica esmaecido e vai pro final da lista, independente do critério de ordenação. Ajuda a navegar batches grandes (25 tweets) sem se perder.
- **Cooldown de 30 segundos** no botão "atualizar" depois de cada refresh, com contagem regressiva visível. Protege contra duplo-clique acidental, cada refresh gasta cota da TwitterAPI (que é paga).
- **Auto dry-run.** Se você não configurou chave de LLM nenhuma, o app **não dá erro**: roda o filtro e mostra os tweets que passariam, com mensagem explicando o que falta. Onboarding mais amigável.

### Distribuição

Três modos de build, escolhidos pelo cenário:

| Modo | O que embute | Pra quê |
|---|---|---|
| `build` | Todas as chaves do seu `env/.env` | Uso pessoal, dev |
| `build:team` | Só a chave da TwitterAPI | Distribuir pro time (TwitterAPI compartilhada, cada analista usa seu Gemini grátis) |
| `build:public` | Nenhuma chave | Distribuição totalmente externa |

**O que muda na prática:** mandar a extensão pra um analista virou uma operação simples e segura. Eles abrem, colam só a chave do Gemini deles (grátis), e estão prontos pra usar.

### Migração transparente

Quem já tinha a extensão instalada com configurações salvas **não perde nada** na primeira vez que carregar essa versão. A config antiga, o cache da última sessão e o grafo uploaded migram automaticamente pro workspace "Default". Sem ação necessária por parte do usuário.

### Robustez

- **Idioma das replies** virou regra inviolável, atrelada ao campo `lang` que vem por tweet. Resolve o bug em que o LLM (especialmente Gemini Flash com thinking off) puxava as replies pra língua dominante do prompt.
- **JSON schema** ajustado pro formato exato que o Gemini aceita, antes dava erro de validação em alguns casos.
- **Migração de storage** testada com cenários de upgrade, preserva config legada, é idempotente (rodar duas vezes não duplica nada).
- **Parser de CSV** tolerante: aceita aspas, BOM, CRLF, ordem livre de colunas, normaliza `@handle`, pula linhas com erro mostrando mensagem clara em vez de abortar tudo.

### Onde tem mais detalhe

- [docs/guia-uso.md](docs/guia-uso.md), **guia do analista**: referência de cada funcionalidade da extensão
- [README.md](README.md), visão completa de features, setup e distribuição

---

### Resumo numa frase

De um POC com chaves hardcoded e configuração única pra **plataforma multi-analista** com workspaces isolados, persona customizável, upload de grafo na UI, quick test, edits persistentes, marcação de tweets respondidos, distribuição zipada em 78KB pronta pra o time abrir e usar.
