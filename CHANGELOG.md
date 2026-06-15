# Changelog

Notas das mudanças por sessão de trabalho. Versão mais recente primeiro.

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

- [docs/guia.md](docs/guia.md), **guia do analista**: referência de cada funcionalidade da extensão
- [README.md](README.md), visão completa de features, setup e distribuição
- [docs/briefing.md](docs/briefing.md), contexto original do projeto
- [docs/twitterapi-cost.md](docs/twitterapi-cost.md), análise de custo da TwitterAPI

---

### Resumo numa frase

De um POC com chaves hardcoded e configuração única pra **plataforma multi-analista** com workspaces isolados, persona customizável, upload de grafo na UI, quick test, edits persistentes, marcação de tweets respondidos, distribuição zipada em 78KB pronta pra o time abrir e usar.
