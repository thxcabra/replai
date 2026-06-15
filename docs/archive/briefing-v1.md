# Briefing técnico: extensão Chrome Replai (POC)

Briefing pra começar a implementação da extensão. Pode ser usado como prompt-base pra Claude Code ou agente similar. Cobre escopo do POC, arquitetura, decisões já tomadas, e o que ainda precisa ser definido.

---

## Objetivo do produto

Extensão de navegador que ajuda o usuário a responder estrategicamente tweets de POIs (Persons of Interest) com o objetivo de entrar na rede de influência deles.

**Por que funciona.** O projeto Groundswell (mãe do Replai) parte da assimetria de que POIs têm escudos altos contra abordagem direta, mas confiam em Bridges (pessoas ao redor deles). Replicar valor em replies a essas pessoas, em escala, gera "infecção da rede" e eventualmente chega ao POI com confiança herdada.

**O que a extensão faz, em uma frase.** Puxa tweets recentes de uma Lista do X, classifica quais merecem reply usando uma skill de LLM, e renderiza 2-3 sugestões de reply pra cada um que o usuário pode editar e postar.

---

## Escopo do POC

**Está dentro:**
- Extensão Chrome (Manifest V3)
- Integração com TwitterAPI pra puxar posts de uma Lista do X
- Social graph estático: `node_metrics.csv` da MOIC, embarcado na extensão ou em storage local
- Chamada pra skill `replai` via API da Anthropic
- UI mínima de timeline: tweet + 3 sugestões de reply + botão de copiar/editar
- Usuário fornece a própria chave de API (Anthropic) e token do X

**Não está dentro do POC:**
- Posting automatizado (usuário copia e cola na timeline do X manualmente)
- Multi-workspace (vem do Groundswell, fora de escopo)
- Backend próprio, banco de dados, telemetria
- Listas dinâmicas / atualização do social graph (vem do Groundswell integration)
- Autenticação OAuth do X dentro da extensão (token manual via config)

---

## Arquitetura

```
┌──────────────────────────────────────────────────────────┐
│  Extensão Chrome                                          │
│                                                           │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────┐ │
│  │ Background   │ ── │ Content/UI   │ ── │ Storage    │ │
│  │ (service     │    │ (popup ou    │    │ (chave API,│ │
│  │  worker)     │    │  side panel) │    │  CSV, conf)│ │
│  └──────┬───────┘    └──────────────┘    └────────────┘ │
│         │                                                 │
└─────────┼─────────────────────────────────────────────────┘
          │
    ┌─────┴──────┐
    ▼            ▼
TwitterAPI    Anthropic API
(GET tweets   (POST messages
da Lista)      com skill replai)
```

**Fluxo de uma sessão:**

1. Usuário abre o popup da extensão (clicando no ícone na barra do Chrome).
2. Extensão lê config do `chrome.storage.local`: chave Anthropic, chave TwitterAPI.io, ID da Lista monitorada, janela de tempo (default 24h).
3. Usuário aperta o botão "atualizar" no popup.
4. Extensão chama TwitterAPI.io: `GET https://api.twitterapi.io/twitter/list/tweets_timeline?listId={list_id}`. Endpoint retorna até 20 tweets ordenados por mais recentes (sem filtro de data nativo).
5. Pra cada tweet recebido:
   - Extrai handle do autor (`tweet.author.userName`, lowercase).
   - Cruza com o `node_metrics_index.json` embarcado. Pega ISV, layer, is_poi.
   - Aplica pré-filtros (ver seção "Pré-filtros").
6. Ordena tweets que passaram por ISV desc, POI desempata, layer menor desempata.
7. Monta payload JSON pra skill `replai` (ver contrato no SKILL.md).
8. Chama Anthropic API (Sonnet 4.6 com prompt caching) com a skill como system prompt e o payload como user message.
9. Recebe JSON estruturado de volta. Parseia.
10. Renderiza na UI: cards verticais, um por tweet que passou. Cada card tem 2-3 replies clicáveis.
11. Usuário clica em uma reply pra copiar (ou edita inline antes de copiar). Cola no composer do X manualmente.

---

## Decisões fechadas

| Decisão | Valor | Por quê |
|---|---|---|
| Provedor de tweets | TwitterAPI.io (`/twitter/list/tweets_timeline`) | $0.15/1K tweets, sem aprovação, key direta. Análise completa em `twitterapi_cost_analysis.md`. |
| Polling | Manual (botão "atualizar" no popup) | Custo previsível, fluxo "humano lê e decide" não precisa de latência <1min |
| Modelo Anthropic | Sonnet 4.6 (`claude-sonnet-4-6`) | 5x mais barato que Opus 4.7, qualidade suficiente. Trocar é 1 linha. |
| Prompt caching | Sim, no system prompt da skill | ~10k tokens do SKILL.md viram ~10% do custo após primeiro hit (TTL 5min) |
| Lista do X | Será criada com os 14 POIs do CSV | Lista pública (pode ser não-listada no perfil). Privada exigiria login cookie. |
| Janela de tempo default | 24h, configurável | Filtro aplicado no client porque o endpoint não aceita `since_time` |
| Idioma das replies | Replica idioma do tweet (maioria EN) | Já está no SKILL.md |
| Formato de I/O da skill | JSON estruturado | Mais barato em tokens, mais fácil de parsear |
| Onde fica o CSV | Embarcado como `node_metrics_index.json` | Lookup O(1) por handle lowercase, sem parse de CSV em runtime |
| Pré-filtros mecânicos | Extensão (não a skill) | LLM não desperdiça tokens com lixo |
| Filtro semântico (vende produto, luto, etc.) | Skill | Precisa de julgamento contextual |
| Tamanho do batch | 10-25 tweets por chamada | Balanceia latência e overhead de tokens |
| Quantas replies por tweet | 2 ou 3 | Skill devolve 2 se a 3ª ficaria forçada |
| Tweets descartados | Skill não devolve | Economia de tokens |
| Chave de API da Anthropic | Usuário fornece a própria | POC interno, custos individuais |
| Chave da TwitterAPI.io | Usuário fornece a própria | POC interno, $0.10 de crédito grátis pra testar |
| Posting automatizado | Não (copy/paste manual) | Reduz risco e complexidade do POC |

---

## Pré-filtros (responsabilidade da extensão)

A extensão **não chama a skill** com tweets que caem em qualquer destes (todos os campos referem-se ao schema da TwitterAPI.io):

1. `tweet.createdAt` mais antigo que `agora - janela_horas` (config, default 24h)
2. `tweet.text` ausente, vazio ou só com URLs/mentions sem conteúdo próprio
3. `tweet.text.split(/\s+/).length < 5` (palavras suficientes pra ter contexto)
4. `tweet.retweeted_tweet != null` E `tweet.text` está vazio ou é só "RT @..." (retweet puro sem comentário, não há o que responder do retweetador)
5. `tweet.lang` não está em `['en', 'pt', '']` (configurável; '' acontece em tweets curtos sem detecção de idioma confiável)
6. `tweet.isLimitedReply === true` e o usuário não atende as restrições (verificado opcionalmente; pra POC pode só marcar com warning na UI)
7. `tweet.author.userName.toLowerCase()` não está no `node_metrics_index.json` **e** o modo "strict" está ligado (config: incluir não-mapeados ou não)
8. `tweet.author.isAutomated === true` (a TwitterAPI fornece esse flag)
9. `tweet.id` já foi visto numa sessão anterior (deduplicação por `chrome.storage.local`)

Tweets que passam vão pra skill enriquecidos com `isv`, `inferred_layer`, `is_poi` do lookup no JSON.

**Sobre `context`:** se o tweet tem `quoted_tweet != null`, a extensão monta um `context: "quoting @{handle}: '{text}'"` e inclui no payload. Mesmo pra reply (`isReply === true` e `inReplyToUsername` presente), incluir o context ajuda a skill a entender o sentido.

**Estimativa de descarte:** numa Lista de 14 POIs com 20 tweets recentes, 50-70% costumam cair em algum filtro (lang, palavras < 5, retweet puro, já visto). A skill recebe entre 6 e 10 tweets por sessão em média.

---

## Estrutura do payload pra skill

A extensão monta e envia (via Anthropic API) algo como:

```json
{
  "tweets": [
    {
      "tweet_id": "1234567890",
      "handle": "patio11",
      "text": "the more i use cursor the more i think...",
      "timestamp": "2026-05-26T14:32:00Z",
      "isv": 92.4,
      "inferred_layer": 1,
      "is_poi": 1,
      "context": null
    }
  ]
}
```

`context` é texto livre que ajuda a skill a desambiguar (quote tweet, thread, reply a não-POI, etc.). Ver SKILL.md pros casos típicos.

Tweets devem vir **já ordenados** por prioridade (ISV desc, POI desempata, layer menor desempata).

---

## Chamada à TwitterAPI.io

```js
const url = `https://api.twitterapi.io/twitter/list/tweets_timeline?listId=${encodeURIComponent(listId)}`;

const response = await fetch(url, {
  method: "GET",
  headers: {
    "X-API-Key": userTwitterApiKey
  }
});

const data = await response.json();
// data.tweets é o array. Schema completo:
// https://docs.twitterapi.io/api-reference/endpoint/list_timeline
//
// Campos relevantes por tweet:
//   id, url, text, createdAt, lang, isReply, inReplyToUsername,
//   conversationId, isLimitedReply,
//   author.userName, author.followers, author.isAutomated,
//   quoted_tweet (pode ser null), retweeted_tweet (pode ser null)
//
// Pra paginar (se for buscar > 20 tweets): passar cursor=data.next_cursor.
// Pra o POC, primeira página resolve.

if (!data.tweets || data.tweets.length === 0) {
  // mostrar mensagem amigável "nada novo na Lista"
  return [];
}
```

**Custo esperado por chamada:** 20 tweets × $0.00015 = $0.003 por sessão (até 1/out/2026; depois disso, piso de $0.0015 se a página vier vazia, mas página cheia continua igual).

**Sem rate limit prático** (1000+ req/s). Pra POC com botão manual, não preocupa.

---

## Chamada à Anthropic API

```js
const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "x-api-key": userApiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json"
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: SKILL_REPLAI_SYSTEM_PROMPT,  // corpo do SKILL.md sem o frontmatter
        cache_control: { type: "ephemeral" }  // ativa prompt caching (TTL 5min)
      }
    ],
    messages: [
      { role: "user", content: JSON.stringify(payload) }
    ]
  })
});

const data = await response.json();
const text = data.content[0].text;
const parsed = JSON.parse(text);  // { results: [...], summary: {...} }
```

**Notas:**

- O `SKILL_REPLAI_SYSTEM_PROMPT` é o corpo do SKILL.md embarcado na extensão como string (importar como asset estático). Não usar a API de Skills do Claude (que é pra Files API / agentes); essa rota direta é mais simples.
- `cache_control: { type: "ephemeral" }` ativa o prompt cache. Primeira chamada da sessão paga 100% do system prompt; chamadas subsequentes dentro de 5min pagam ~10%. Como o usuário tipicamente faz várias atualizações por sessão, vale muito.
- `max_tokens` em 4096 dá folga pra batch de 25 tweets devolvendo 3 replies cada (200 tokens × 25 × 0.7 pass rate ≈ 3500). Ajuste se faltar.
- A resposta vem em `data.content[0].text`. Parsear com `JSON.parse()`. Tratar parse fail (ver "Questões abertas").
- Pra migrar pra Opus 4.7 (qualidade superior, custo 5x): trocar `model: "claude-opus-4-7"`. Sem outras mudanças necessárias.

---

## UI mínima

**Tela única.** Lista vertical de cards, um por tweet. Cada card mostra:

```
┌────────────────────────────────────────────┐
│  @patio11   ISV 92.4   layer 1   POI       │
│  ──────────────────────────────────────    │
│  the more i use cursor the more i think    │
│  the future of coding is just a really     │
│  good autocomplete with the entire         │
│  codebase as context                       │
│  ──────────────────────────────────────    │
│  [ reply 1 ]  experiencia_builder          │
│  trabalhando num codebase de ~80k linhas   │
│  com cursor há uns 3 meses. o pulo não...  │
│  [ copiar ]                                │
│                                            │
│  [ reply 2 ]  pergunta_especialista        │
│  qual o ponto pra você onde "autocomplete  │
│  com codebase no contexto" vira outra...   │
│  [ copiar ]                                │
│                                            │
│  [ reply 3 ]  nomear_fenomeno              │
│  isso meio que tem nome em IDE clássico,   │
│  intellisense holístico...                 │
│  [ copiar ]                                │
└────────────────────────────────────────────┘
```

**Interações mínimas:**

- Clicar em "copiar" → copia o texto pro clipboard, dá feedback visual rápido.
- Hover ou clicar no texto da reply → torna editável inline. Botão de copiar puxa o texto editado.
- Botão "abrir no X" → abre `https://x.com/intent/tweet?in_reply_to={tweet_id}` em nova aba. (Não preenche o texto automaticamente, isso depende de como o X estiver tratando o param `text` no momento. Testar.)
- Header da extensão: contador "N tweets, M passaram", botão "atualizar" pra recarregar.

**Sem precisa de roteamento, login flow, ou navegação multi-tela no POC.**

---

## Estado e storage

`chrome.storage.local`:

- `anthropic_api_key`: string (chave do console.anthropic.com)
- `twitterapi_io_key`: string (chave do dashboard twitterapi.io)
- `list_id`: string (ID da Lista do X monitorada — pega da URL: `x.com/i/lists/{id}`)
- `time_window_hours`: número, default 24
- `include_unmapped`: bool, default false (incluir tweets de handles fora do CSV)
- `seen_tweet_ids`: array ou Set serializado (deduplicação; podar IDs com createdAt > 72h pra não inchar)
- `last_results_cache`: objeto com `{ timestamp, results }` (cache de sessão pra evitar re-call ao reabrir popup em <5min)

**Social graph.** O `node_metrics.csv` original tem 1.4MB e 26 colunas. A skill só precisa de 4 (`handle`, `isv`, `inferred_layer`, `is_poi`), e dá pra reduzir o arquivo de 1.4MB pra ~67KB (CSV enxuto) ou ~172KB (JSON indexado por handle lowercase). **Recomendo embarcar o JSON indexado** (`node_metrics_index.json`): lookup O(1) em runtime, sem parse de CSV. Arquivos prontos estão em `/mnt/user-data/outputs/` desta conversa.

Dataset atual tem **3057 handles únicos**, dos quais **14 são POIs** (`is_poi=1`), 137 em layer 2 e 3235 em layer 3. ISV varia de -99 a +96 (mediana negativa, ou seja, a maioria das contas no grafo é "supervalorizada" ou neutra; as oportunidades de bridge estão nas caudas positivas).

Versões seguintes: botão "atualizar social graph" que aceita upload manual de um CSV no formato MOIC. Versão Groundswell: pull automático por workspace.

---

## Custos esperados

Detalhamento completo em `twitterapi_cost_analysis.md`. Resumo:

**TwitterAPI.io (List Timeline manual):**
- Por chamada: $0.003 (20 tweets retornados × $0.00015)
- Sessão típica (1-2 chamadas/dia): $0.003-0.006/dia → ~$0.10-0.20/mês

**Anthropic API (Sonnet 4.6 com prompt caching):**
- Por batch de 20 tweets: ~$0.06 (primeira chamada da sessão) ou ~$0.02 (chamadas seguintes com cache hit)
- Uso típico do POC: ~$5/mês

**Total esperado do POC: $5-7/mês.** Pra escalar pra uso mais intenso ou múltiplos usuários, considerar TwitterAPI Stream Monitoring ($79/mês fixo) e Opus 4.7 (~$24-37/mês na skill).

**Otimizações já planejadas no design:**
- Prompt caching no system prompt da skill (reduz ~90% após primeira chamada)
- Deduplicação de tweet IDs (não re-processa o que já viu)
- Cache de resultado de sessão (não re-chama se reabrir popup em <5min)
- Pré-filtros mecânicos na extensão (50-70% dos tweets nunca chegam à skill)

---

## Stack sugerido

- **Manifest V3** (obrigatório pra Chrome novo)
- **TypeScript** (a skill devolve JSON estruturado, vale ter type safety)
- **Vite** com plugin pra extensão (`vite-plugin-chrome-extension` ou similar), ou **CRX bundler**
- **React** ou **Preact** pra UI (algo leve, não precisa do React inteiro)
- **Tailwind** se quiser estilizar rápido sem CSS file separado
- Sem state management library externa. `useState` resolve.

---

## Questões em aberto (resolver durante implementação)

1. **Lidar com falha de parse JSON.** Se a skill devolver texto malformado (raro mas acontece), a UI quebra. Implementar retry com prompt explícito de "devolva apenas JSON válido", ou cair pra modo degradado (mostra texto cru com aviso).

2. **TTL de cache de resultados.** Sugestão: 5min (alinhado com o TTL do prompt cache da Anthropic). Mas se o usuário aperta "atualizar" dentro desse intervalo, deve invalidar o cache e re-chamar mesmo assim.

3. **Privacidade da chave de API.** Chave Anthropic numa extensão fica acessível via DevTools. Pra uso interno (POC), ok. Pra distribuir, precisaria de backend proxy.

4. **Botão "abrir no X".** O endpoint `https://x.com/intent/tweet?in_reply_to={tweet_id}&text={encoded}` historicamente preenchia o composer com o texto, mas o X muda esse comportamento periodicamente. Testar e ajustar.

5. **Tratamento de erros HTTP.** Chave inválida (401), rate limit (429), Lista privada (403), Lista não existe (404), erro do servidor (5xx). Mensagens claras na UI pra cada caso.

6. **Comparar Sonnet 4.6 vs Opus 4.7 em produção.** Depois de 20-30 tweets reais processados, vale colocar Opus na frente de Sonnet em 10 tweets e ver se a diferença de voz justifica o custo 5x maior. Talvez Opus só pros tweets com ISV > 80 (estratégia híbrida).

---

## Critérios de aceite do POC

- [ ] Extensão carrega no Chrome em modo developer (Manifest V3)
- [ ] Tela de configurações salva: chave Anthropic, chave TwitterAPI.io, ID da Lista
- [ ] `node_metrics_index.json` embarcado e carregado em memória no service worker
- [ ] Botão "atualizar" no popup chama TwitterAPI.io, aplica pré-filtros, chama Anthropic com Sonnet 4.6 e prompt caching, renderiza cards
- [ ] Cada card mostra: handle + ISV/layer/POI · texto do tweet · 2-3 replies com categoria visível
- [ ] Clique no botão "copiar" copia o texto da reply (editado ou não) pro clipboard
- [ ] Botão "abrir no X" abre `x.com/intent/tweet?in_reply_to={id}` em nova aba
- [ ] Tweets descartados (pré-filtro ou semântico) não aparecem na UI, mas contador mostra "N tweets coletados, M passaram"
- [ ] Deduplicação funciona: re-apertar "atualizar" não re-processa tweets já vistos
- [ ] Cache de sessão funciona: reabrir popup em <5min mostra resultado anterior sem chamar API
- [ ] Erros (chave inválida 401, lista vazia, rate limit 429, parse fail) são exibidos sem crash
- [ ] Funciona com a Lista real dos 14 POIs, processando 1 batch de ~10-20 tweets úteis em <30s

---

## Próximos passos depois do POC

- **Groundswell integration.** Substituir CSV estático por pull de listas geradas dinamicamente pelo Groundswell por projeto.
- **Posting direto.** OAuth do X dentro da extensão, postar reply sem copy/paste.
- **Multi-workspace.** Usuário troca entre projetos/Listas sem reconfigurar.
- **Métricas de outcome.** Tracking de quais replies foram postadas, quais geraram engajamento do POI, alimenta de volta o ranking.
- **Backend proxy.** Centralizar chamadas Anthropic, esconder chave de API, permitir cobrança por org.
- **Modelo fine-tuned ou prompt-tuned em voz.** Calibrar a voz com exemplos reais do operador (mencionado nas notas originais como "voz vai ser calibrada via exemplos anexados separadamente").
