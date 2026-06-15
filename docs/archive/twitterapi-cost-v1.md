# TwitterAPI.io — análise de custos pro POC do Replai

Análise feita em 27/mai/2026 com base em docs.twitterapi.io e twitterapi.io/pricing. Os preços abaixo podem mudar; valide antes de implementar.

## TL;DR

**Recomendação:** começar com **List Timeline + polling esparso** (~$0.50/mês). Estrutura o código pra trocar pra Stream Monitoring depois sem dor se a extensão ganhar muitos usuários.

Custo total POC esperado (TwitterAPI + Anthropic): **$1 a $5/mês** pra uso individual.

---

## Modelo de cobrança da TwitterAPI.io

- **$0.15 por 1.000 tweets retornados** ($0.00015 por tweet)
- **$0.18 por 1.000 perfis retornados** ($0.00018 por perfil)
- **Piso de $0.00015 por chamada** (mesmo retornando 0 ou 1 tweet)
- **Piso especial de $0.0015 (150 créditos) por chamada em "list functions"** — entra em vigor a partir de 1/out/2026. Isso é 10x o piso normal. Importante: é "list functions" plural, provavelmente cobrindo `/list/tweets_timeline`, `/list/followers`, `/list/members`. Não foi 100% claro se inclui Advanced Search. **Validar com o suporte antes de assumir.**
- 100.000 créditos = $1.00. Sem mensalidade, sem mínimo. Créditos não expiram.
- $0.10 de crédito grátis pra teste, sem cartão.

---

## Endpoints relevantes pra o caso

### 1. List Timeline — `GET /twitter/list/tweets_timeline`

Puxa tweets de uma Lista do X (até 20 por página, ordenados por mais recente).

- **Parâmetros:** `listId` e `cursor`. **Sem filtro de data nativo.**
- **Custo:** 20 tweets × $0.00015 = $0.003 por página. Depois de 1/out: piso $0.0015 mesmo se vier menos.
- **Vantagem:** uma chamada cobre N POIs (todos numa Lista).
- **Desvantagem:** sem `since_time`, então paga tweets velhos que serão descartados pela extensão.

### 2. Advanced Search — `GET /twitter/tweet/advanced_search`

Tem filtro por data nativo via query string.

- **Query exemplo:** `from:patio11 since_time:1716800000 until_time:1716840000`
- **Custo:** $0.00015 por tweet retornado, com piso de $0.00015 por chamada.
- **Vantagem:** só puxa o que importa. Sem desperdício.
- **Desvantagem:** 1 chamada por POI. Pra 14 POIs = 14 chamadas, cada uma cobra no mínimo o piso.
- **Importante:** não foi confirmado se o piso especial de "list functions" se aplica aqui. O nome do endpoint sugere que não, mas vale confirmar no suporte.

### 3. Stream Monitoring — webhook/WebSocket

Assinatura mensal. Tweets chegam em <500ms via push.

- **Starter $29/mês** monitora até 6 contas. Pra 14 POIs: $29 + 8 × $5 = **$69/mês**.
- **Growth $79/mês** monitora até 20 contas. **Cabe os 14 POIs com folga.**
- **Cobertura "fast-lane"** apenas pra contas com 5000+ followers (caindo pra 2000+). Os 14 POIs do CSV provavelmente passam fácil, mas Bridges menores (layers 2/3) podem cair no path padrão.
- **Setup:** ~20min após configurar.

---

## Comparação de custos pra o cenário-base

**Universo:** 14 POIs × 5 tweets/dia ≈ 70 tweets úteis por dia.

| Estratégia | Custo/mês | Latência | Quando faz sentido |
|---|---|---|---|
| List Timeline, polling 1x/dia | $0.09 | até 24h | Uso muito esporádico, vê 1x/dia |
| List Timeline, polling 6x/dia | $0.54 | até 4h | **POC inicial.** Equilíbrio bom. |
| List Timeline, polling de hora em hora (12h ativas) | $0.54 | até 1h | POC ativo durante horário comercial |
| List Timeline, polling 24x/dia | $2.16 | até 1h | Não vale, melhor migrar pra Stream |
| Advanced Search 6x/dia (14 calls/sessão) | $0.38 | até 4h | Se piso de "list functions" valer pra List Timeline mas não pra Search |
| Advanced Search 12x/dia | $0.76 | até 2h | Mesmo cenário, mais granular |
| Stream Growth ($79/mês fixo) | $79.00 | <500ms | Quando latência importa de verdade |

**Add Anthropic API por cima:**

| Modelo | Model string | Preço (in/out por MTok) | Custo estimado/mês (skill replai) |
|---|---|---|---|
| Opus 4.7 | `claude-opus-4-7` | $15 / $75 | ~$37/mês sem cache, ~$24/mês com cache |
| **Sonnet 4.6** | `claude-sonnet-4-6` | $3 / $15 | **~$7/mês sem cache, ~$5/mês com cache** ← escolha do POC |
| Haiku 4.5 | `claude-haiku-4-5-20251001` | $1 / $5 | ~$2/mês com cache (qualidade de voz a validar) |

Preços confirmados em docs.claude.com (mai/2026). Prompt caching de blocos ≥ 1024 tokens (o system prompt da skill tem ~10k) fica em ~10% do preço de input nos cache hits, com TTL de 5 minutos. Múltiplas chamadas dentro da mesma sessão pagam ~10% do system prompt; só a primeira paga 100%.

---

## Recomendação pro POC

**Stack escolhida (decisões fechadas):**

1. **TwitterAPI: List Timeline + polling manual.** UMA Lista do X com os 14 POIs (a ser criada). A extensão chama o endpoint quando o usuário aperta "atualizar" no popup. Pega a primeira página (20 tweets), filtra por janela de tempo no client. Sem polling em background no POC.

2. **Anthropic: Sonnet 4.6 com prompt caching** (model string `claude-sonnet-4-6`). Se a qualidade da voz nos primeiros 20 tweets reais não bater, dá pra trocar pra Opus 4.7 (`claude-opus-4-7`) mudando uma linha — vale considerar Opus pontualmente pra eventuais "replies premium" pros POIs de ISV mais alto, mantendo Sonnet pro resto.

3. **Não compre Stream Monitoring agora.** $79/mês fixo só compensa se:
   - latência <1min for crítica (não é, no fluxo "humano lê e responde")
   - vários usuários estiverem na mesma instância
   - você passar de ~500 polls/dia (~16/dia continuamente)

**Custo total esperado do POC:** $1-5/mês.

---

## Estratégias de economia (implementar desde o início)

### 1. Pull "smart": só chama o endpoint quando faz sentido

- Botão "atualizar" manual em vez de polling automático no background.
- Se polling automático: respeitar horário ativo do usuário (ex: 9h-21h no fuso dele). Cortar polling fora disso reduz custo proporcionalmente.

### 2. Deduplicação no client

- Guardar `tweet_id` dos tweets já vistos em `chrome.storage.local`.
- Se o mesmo `tweet_id` voltar numa próxima página, ignorar (já foi processado pela skill).
- Se TODOS os tweets da página já foram vistos, não paginar pra próxima.

### 3. Filtros antes da chamada à skill (Anthropic)

Cada tweet que chega na skill custa tokens. Filtrar mecanicamente na extensão antes de mandar:

- `lang != "en" && lang != "pt"` → descarta (a skill cobre os dois, mas se você quiser limitar inicialmente, descarta os outros).
- `text.split(/\s+/).length < 5` → descarta (anti-padrão de contexto insuficiente).
- `retweeted_tweet != null && quoted_tweet == null` → descarta (retweet puro, não há o que responder).
- `isLimitedReply == true` E o usuário não preenche os requisitos → descarta (não vai conseguir responder).
- `tweet_id` já visto → descarta.
- `author.userName.toLowerCase()` não está no `node_metrics_index.json` → descarta (ou marca, dependendo da config).
- `createdAt` fora da janela de tempo (>X horas) → descarta.

Numa Lista de 14 POIs, das 20 retornadas, expectativa é descartar 50-70% antes de chegar à skill.

### 4. Batch eficiente pra skill

- Acumular tweets de uma sessão e mandar tudo em UMA chamada pra Anthropic API (não uma por tweet).
- Batch ótimo: 15-25 tweets. Acima disso, output pode estourar `max_tokens`.
- Prompt caching: system prompt da skill (~10k tokens) fica em cache por 5min. Múltiplas chamadas seguidas pagam apenas 10% do input.

### 5. Cache de resultados

- Se o usuário re-abre a extensão em <5min, mostrar o último resultado em vez de chamar a API de novo.
- TTL de cache configurável (default 10min).

### 6. Modo "draft" pra desenvolvimento

- Flag pra usar Haiku 4.5 (mais barato) em vez de Sonnet/Opus durante desenvolvimento, mesmo que a voz fique mais fraca. Útil pra iterar UI/UX sem queimar crédito.

---

## Cuidados específicos

### Piso de "list functions" a partir de 1/out/2026

O piso de $0.0015 por chamada de "list functions" muda o cálculo se polling for agressivo. Exemplos:

- **Polling 1x/hora (24/dia):** mínimo $0.036/dia = $1.08/mês só de pisos. Se cada call retornar 20 tweets, paga $0.003 (o maior dos dois). Polling agressivo praticamente não muda custo, mas polling com poucos tweets retornados é punido.
- **Polling 1x/dia:** $0.0015/dia mínimo = $0.045/mês. Insignificante.

**Conclusão:** o piso afeta principalmente polling agressivo com retorno pequeno. Pra polling moderado (4-12x/dia) com Listas ativas, o piso não bate (porque os 20 tweets cobrem mais que o piso).

### Cobertura "fast-lane" do Stream

Se você migrar pra Stream Monitoring depois e quiser monitorar Bridges (layers 2/3), muitas têm <2000 followers e podem cair no path padrão (latência maior). Pros 14 POIs principais isso não é problema.

### Listas privadas

Se a Lista do X for privada, **você precisa logar com o cookie do dono da Lista**. A TwitterAPI tem `/twitter/user_login_v2` mas isso adiciona complexidade (token cookie, refresh, etc). **Recomendação: use Lista pública** pro POC. Pode ser uma Lista escondida (não-listada no perfil) mas com privacidade pública.

### Rate limit

- Default: 1000+ req/s. Nada que o POC vá bater.

---

## Decisões fechadas (mai/2026)

1. **Lista do X:** será criada com os 14 POIs antes do POC ir ao ar.
2. **Polling:** manual via botão "atualizar" no popup. Sem background polling.
3. **Modelo Anthropic:** Sonnet 4.6 (`claude-sonnet-4-6`) com prompt caching ativo.
4. **Janela de tempo default:** a definir durante implementação. Sugestão: 24h, configurável.
