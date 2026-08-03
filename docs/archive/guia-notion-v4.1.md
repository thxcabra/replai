# Guia do Replai

Como usar a extensao no dia a dia. Cada secao explica **o que e**, **pra que serve** e **como usar**.

> Dica: depois de colar este conteudo no Notion, adicione um bloco `/table of contents` logo abaixo deste paragrafo pra gerar o indice automatico.

---

## Resumo (TL;DR)

> Se voce so vai ler uma secao, e essa.

**O que e.** Extensao Chrome (side panel) que escolhe os tweets de uma Lista do X que valem responder e gera 2-3 sugestoes de reply pra cada um. Voce revisa, edita, posta, registra. Tudo sincronizado com o Supabase do time.

**Setup em 4 passos:**

1. **Instalar.** Pela Chrome Web Store (link interno do time @moicdigital).
2. **Login com Google.** Use seu email `@moicdigital` (outros dominios sao rejeitados).
3. **Colar a chave do Gemini** (gratis): [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → **Create API key** → cola no setup wizard.
4. **Configurar o workspace.** Define a voz, cola o ID da Lista do X, opcional: handle do @ X linkado.

Pronto. Aperta **atualizar** no header. Em 5-15s aparece a tela de **triagem**.

**Fluxo de cada sessao:**

1. **atualizar** → puxa tweets e prefiltra (sem gastar token LLM)
2. **triagem** swipe ou lista → voce escolhe quais quer responder
3. **gerar replies** → LLM gera 2-3 sugestoes so pros selecionados
4. **revisar/editar** o texto da reply no card
5. **responder** → abre o composer do X em nova aba
6. **dialog de confirmacao** → confirma "sim, postei" e cola a URL da reply pra rastreio

**Pra ficar fluente:**

- **Voz do workspace** (Settings → bloco roxo "voz"): define o tom. Sem voz = replies genericas.
- **Workspaces multiplos**: um por cliente. Dropdown no header pra alternar.
- **Painel admin** (so pra admins): visao agregada do time + export CSV/JSON.

**Custo.** Gemini grátis até 1500 reqs/dia. TwitterAPI paga, gerenciada pelo admin. Cooldown de 30s no atualizar evita duplo-clique.

---

# Instalacao

## Pela Chrome Web Store (analistas)

Voce recebe um link interno do time. Clica em **Adicionar ao Chrome** → confirma permissoes → o icone do Replai aparece na barra. Clica no icone pra abrir o side panel.

Se nao ver o icone na barra, clica no quebra-cabecas (canto superior direito) → fixa o Replai.

## Load unpacked (devs)

Se voce esta testando localmente ou ainda nao foi publicado:

1. `npm run build` na raiz do repo
2. Abre `chrome://extensions`
3. Liga **Developer mode** (canto superior direito)
4. **Load unpacked** → seleciona a pasta `dist/`

Roda em Chrome 114+ em Windows, Mac e Linux.

---

# Primeiro acesso

## Login com Google

**O que e:** primeira tela apos abrir o side panel. Botao "login com Google".

**Pra que serve:** sua identidade. Sem login nao da pra usar a extensao — workspaces, voz, replied tweets, tudo vive no Supabase do time.

**Como usar:**

1. Clica **login com Google**
2. Popup do Google abre
3. Escolhe sua conta `@moicdigital` (Gmail pessoal e rejeitado)
4. Volta pro side panel ja logado

Apos login, seu profile e criado automaticamente no Supabase. Por padrao voce entra como **analyst**. Se voce era admin antes, role permanece.

## Setup wizard

**O que e:** tela apos primeiro login que pede chave Gemini.

**Pra que serve:** sem chave LLM, replies nao geram. E captado logo no inicio.

**Como usar:**

- Cola a chave do [Gemini](https://aistudio.google.com/apikey) (free tier, sem cartao) → **continuar**
- Da pra **pular** e configurar depois em Settings

**Importante:** chaves valem pra **TODOS** os seus workspaces. Nao precisa configurar uma chave por workspace.

---

# O cabecalho do painel

## Titulo + badge "voz"

**O que e:** o nome "Replai" no canto superior esquerdo. Ao lado, chip violeta **voz** quando o workspace ativo tem voz configurada, ou chip cinza "sem voz" quando nao tem.

**Pra que serve:** sinaliza se o LLM esta recebendo voz custom ou nao. Sem voz, replies tendem a sair genericas.

**Hover** mostra preview da voz.

## Seletor de workspace

**O que e:** dropdown ao lado do titulo com o nome do workspace ativo.

**Pra que serve:** alternar entre contextos isolados (Cliente A, Cliente B, sandbox de testes). Cada workspace tem **sua propria configuracao, voz, Lista do X, historico e marcacoes**.

**Como usar:** clica no dropdown e escolhe outro workspace. Tudo no painel troca junto. Pra criar workspace novo, vai em **Settings**.

## Botao atualizar

**O que e:** botao azul "atualizar" no canto superior direito.

**Pra que serve:** dispara uma nova sessao. Puxa tweets da Lista, filtra, e leva pra triagem. **Cada sessao substitui a anterior** (nao acumula).

**Como usar:** clica. Em 5-15s aparece a tela de triagem.

Depois de cada sucesso, o botao entra em **cooldown de 30s** mostrando contagem regressiva (`29s`, `28s`...). Isso protege contra duplo-clique e queima da cota da TwitterAPI.

## Botao config

**O que e:** botao "config" ao lado de atualizar.

**Pra que serve:** abrir Settings do workspace ativo (voz, Lista, chaves, filtros).

## Botao admin (so pra admins)

**O que e:** botao "admin" que aparece **so se voce tem role admin**.

**Pra que serve:** abrir o painel admin (visao agregada do time + exports).

Se nao ve esse botao, voce nao e admin. Peca a um admin atual te promover.

---

# Fluxo principal

## 1. atualizar → triagem

Apos clicar **atualizar**, o app:

- Faz fetch da Lista do X (TwitterAPI)
- Aplica prefilter (janela de tempo, idiomas, autores fora do grafo, etc) — **sem chamar LLM**
- Mostra os tweets que passaram na tela de **triagem**

Voce nao gasta token nenhum nesse passo.

## 2. Modo swipe ou lista

**O que e:** dois modos de escolher quais tweets quer responder.

**Modo swipe** (padrao):

- Um tweet por vez no centro da tela, estilo Tinder
- Swipe pra **direita** (ou tecla `→`, ou botao coracao) = like → entra na fila pra gerar reply
- Swipe pra **esquerda** (ou tecla `←`, ou botao X) = skip → descartado
- Bom pra triar com calma, tweet por tweet

**Modo lista**:

- Todos os tweets ao mesmo tempo com checkboxes
- Voce marca varios e clica gerar
- Bom quando tem muitos (>10) pra triar rapido

**Como alternar:** toggle no header da triagem. Preferencia salva entre sessoes.

**Footer** mostra "X selecionado(s)". Quando terminar, clica **gerar replies (N)**.

## 3. LLM gera replies

Tela de loading aparece enquanto o LLM processa (geralmente 5-15s).

**Por que e mais barato:** o LLM so processa os tweets que voce **selecionou na triagem**, nao todos. Se voce selecionou 5 de 30, paga por 5.

## 4. Card de tweet + cards de reply

Volta pro painel principal. Cada caixa e um tweet selecionado, com 2-3 ReplyCards dentro.

**No card de tweet:**

- **@handle do autor** (clicavel, vai pro perfil no X)
- **ISV** (0-100): relevancia do autor na rede
- **layer** (1-5): proximidade do nucleo da rede (1 = nucleo, 5 = periferia)
- **POI** (badge dourado): Person of Interest, prioritario
- **fora do grafo** (badge cinza): autor nao mapeado, metricas placeholder
- **padrao N** (1-11): padrao semantico identificado no tweet
- **texto do tweet** e **contexto** (quote/reply de outro POI, se houver)

**Acoes do card:**

- **ver tweet**: abre o original em outra aba
- **marcar / respondido**: alterna status. Marcado fica esmaecido e desce pro final

**No card de reply:**

- **reply N** (selo azul)
- **categoria** (texto cinza): qual categoria de valor (`dado concreto`, `referencia nominal`, etc — 9 no total)
- **textarea editavel** com o texto da reply
- **contador X/280**: vermelho se passar de 280
- **botao responder**

**Edicoes sao salvas automaticamente.** Fechar e reabrir o painel mantem o que voce escreveu.

## 5. Responder

Clica **responder** num card de reply:

1. Abre uma nova aba no X com o composer ja apontando pro tweet original (intent URL)
2. O texto da reply (com suas edicoes) ja vai bake pra clipboard pronto pra colar
3. Posta no X
4. Volta pro side panel — o **dialog de confirmacao** esta aberto

## 6. Dialog de confirmacao

**O que e:** modal que abre apos voce clicar responder.

**Pra que serve:** capturar "voce postou de verdade?" + **URL da reply postada** pra rastreio.

**Como usar:**

1. Edita o texto final no campo (caso voce tenha ajustado no composer do X)
2. **CRITICO**: cola a URL da reply postada no campo destacado em amarelo
    - Como pegar a URL: no X, clica `...` na sua reply → **Copy link**
    - Ou copia da barra de URL apos clicar na sua propria reply
3. Botao **"sim, postei"** registra com a URL capturada → badge verde **verificada**
4. Botao **"nao postei"** registra como descartado
5. Botao **"voltar pra editar"** dispensa sem registrar

Replies com URL preenchida contam como **verificadas** no painel admin (sinal mais forte que auto-report).

---

# Settings

> Clica **config** no header pra abrir.

## Workspace

**Nome do workspace ativo.** Edita e salva. Aparece no dropdown do header.

**+ novo workspace.** Cria contexto novo do zero ou clonando o atual (checkbox "copiar config e grafo"). Util pra testar variacao de voz sem perder o original.

**Exportar.** Baixa `.json` com toda config do workspace. Pra backup ou compartilhar com colega. **Atencao**: inclui suas chaves de API em texto claro.

**Importar.** Cria workspace novo a partir de JSON exportado.

**Excluir.** Apaga config, voz e marcacoes do workspace ativo. Se for o ultimo, um "Default" vazio e criado pra voce nunca ficar sem workspace.

## Voz do workspace (caixa violeta)

**O que e:** texto que define a personalidade do workspace (PM de fintech, jurista, especialista em RH, etc).

**Pra que serve:** anexar ao prompt do LLM pra replies sairem com tom especifico. SEM voz, o LLM gera replies genericas.

**Como usar:**

- **Cola texto** OU **carrega arquivo** `.md`/`.pdf`/`.txt` (botao "carregar arquivo")
- Limite ~50.000 chars
- Voz e versionada automaticamente no Supabase (historico em `voice_versions`)

**Exemplo:**

```
sou PM de fintech B2B focado em risco. priorize replies que tragam
casos de risk modeling e referencias a praticantes da area (varo,
nubank, etc). evite jargao academico, prefira casos concretos.
```

**Boas praticas:**

- Concreto e direto: diga seu papel, sua industria, o que priorizar
- Cite nomes validos (autores, empresas, frameworks reais)
- Diga o que **evitar** tanto quanto o que priorizar

**O que evitar:**

- Voz vaga ("seja interessante") — nao muda nada
- Pedir coisas que o skill base proibe (travessoes, paralelismo, etc) — vai ser ignorado
- Escrever em outro idioma achando que muda o idioma da reply — **a reply replica o idioma do tweet**, nao da voz

## Twitter handle do workspace

**O que e:** campo `@` em Settings, opcional.

**Pra que serve:** marcar qual conta do X esta postando as replies desse workspace. Pra scraping futuro de engagement (V5).

**Como usar:** Settings → "@ do perfil X linkado a este workspace" → digita o handle (sem `@`).

## Conexao com a Lista do X

**ID da Lista do X.** Cola ID puro (`1234567890`) ou URL completa (`https://x.com/i/lists/1234567890`). A Lista precisa ser **publica** — privadas dao erro 403.

**Provider de LLM.**

| Provider | Custo | Quando usar |
|---|---|---|
| **Gemini 2.5 Flash** | Gratis (1500 req/dia) | Default. Suficiente pra maioria dos casos. |
| **Claude Sonnet 4.6** | Pago (~$3/M input, ~$15/M output) | Quando voz do Gemini nao bate ou em contextos que pedem nuance |

**Chaves de API.** Tres campos password: TwitterAPI, Gemini, Anthropic. Em V4 as chaves ficam no seu profile (Supabase) e valem pra todos workspaces.

| Chave | Onde obter |
|---|---|
| **Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (gratis) |
| **Anthropic** | [console.anthropic.com](https://console.anthropic.com) (so se for usar Claude) |
| **TwitterAPI** | Gerenciada pelo admin do time, voce normalmente nao precisa colar |

---

# Painel admin

> So aparece pra usuarios com role admin. Se voce nao ve o botao "admin" no header, peca a um admin te promover.

## Aba "visao geral"

- Totais agregados do time: replies geradas, postadas, ultimos 7 dias, custo LLM total
- **Toggle "contar so replies verificadas (com URL postada)"** — filtra metricas pras que tem `posted_reply_id` (sinal mais forte que auto-report)
- Top 5 analistas por replies postadas
- Banner: "admins tambem sao analistas — replies deles entram nas mesmas agregacoes"

## Aba "analistas"

Lista todos os analistas + stats individuais. Click no card de qualquer um **expande inline** com:

- Stats (replies, postadas, descartadas, ultimos 7 dias, workspaces, custo LLM)
- Botao **promover a admin** ou **revogar admin** (nao da pra mudar o proprio)
- **Export especifico** dele (CSV/JSON, baixa so os replies desse analista)

Novos analistas aparecem aqui automaticamente apos primeiro login.

## Aba "exportar (geral)"

Download em CSV/JSON com filtros de varias tabelas.

**Tabelas exportaveis:**

- `reply_logs` (recomendado, 52 colunas com analytics rico)
- `replied_tweets` (resumo de marcadores)
- `session_logs` (sessoes inteiras com tokens + custo + erros)
- `events` (telemetria operacional)

**Filtros:** data inicio, data fim, analista (opcional), formato (CSV ou JSON).

**Limite:** 50k linhas por export. Pra mais, use o SQL Editor do Supabase diretamente.

---

# Recursos avancados

> Voce raramente vai precisar destes. Pula se nao precisar.

## Quick test por URL

**O que e:** seccao colapsavel acima dos cards.

**Pra que serve:** rodar a pipeline em UM tweet escolhido por voce. Pula triagem e gera replies direto. Util pra:

- Calibrar voz (cola um tweet, ve se a reply muda como queria)
- Decidir se vale responder um tweet que voce viu fora da Lista

**Como usar:** cola URL completa (`https://x.com/usuario/status/123...`) → **rodar quick test**.

> O resultado **substitui** o lote atual. Considere fazer no workspace separado se quiser preservar o batch atual.

## Dry-run

**O que e:** checkbox em Settings → filtros.

**Pra que serve:** rodar pipeline **sem chamar o LLM**. So filtra os tweets e mostra os que passariam.

Util pra conferir se a Lista esta puxando certo, ou testar config de janela/idiomas sem gastar token.

## Filtros e batch

Tudo dentro do colapsavel "filtros e batch" em Settings:

- **Janela de tempo** (horas): quanto pra tras o Replai puxa tweets. Default 10h, vai de 1 a 168.
- **Teto de tweets por chamada** (default 25): quantos vao pro LLM. Quase nunca precisa mexer.
- **Idiomas aceitos**: checkboxes ingles, portugues, indefinido.
- **Incluir handles fora do grafo**: tweets de autores nao mapeados entram com placeholder (ISV 50, layer 3) ou sao descartados.

## Social graph custom (CSV)

O Replai vem com um grafo padrao (~3000 handles com ISV, layer, POI). Voce pode subir um CSV proprio que substitui o padrao **so nesse workspace**.

**Formato:**

```csv
handle,isv,inferred_layer,is_poi
patio11,92.4,1,1
naval,88.0,1,1
random_dev,45.3,3,0
```

Em Settings, **carregar CSV** → preview → **salvar grafo**. Pra reverter: **voltar pro bundled**.

## Modelo Anthropic

So aparece quando o provider e Claude. Dropdown com:

| Modelo | Pra que |
|---|---|
| **Sonnet 4.6** | Default. Bom equilibrio qualidade/custo. |
| **Opus 4.7** | Maxima qualidade, ~5x mais caro. |
| **Haiku 4.5** | Mais barato e rapido. |

## Cooldown e auto dry-run

**Cooldown** de 30s no botao atualizar apos cada sucesso — protege contra duplo-clique e cota da TwitterAPI.

**Auto dry-run**: se voce nao tem chave de LLM configurada e clica atualizar, o app roda em dry-run automaticamente (em vez de dar erro). Pra desligar, configure uma chave em Settings.

## Ordenacao dos cards

Dropdown "ordenar por" no painel principal quando ha cards:

| Opcao | Ordena por |
|---|---|
| **ISV (maior primeiro)** | Relevancia na rede (default) |
| **Mais recentes** | Tweets mais novos primeiro |
| **POI primeiro** | Persons of Interest no topo, depois ISV |

Tweets marcados como respondidos sempre vao pro final.

---

# Mensagens de erro comuns

> Aparecem em caixa vermelha no topo do painel.

| Mensagem | Causa provavel | Como resolver |
|---|---|---|
| **acesso restrito ao time @moicdigital** | Tentando logar com Gmail pessoal | Usa o email `@moicdigital` |
| **login cancelado** | Popup OAuth fechou ou redirect URL bate errado | Confere com admin se Supabase URL Configuration tem o extension ID atual |
| **Sync falhou em 'X': ...** (banner vermelho) | Operacao Supabase falhou silenciosamente | Mensagem mostra detalhe. Comum: profile do user nao existe — pede backfill ao admin |
| **Configure a chave do Gemini...** | Sem chave configurada | Cola em Settings, ou liga dry-run pra testar antes |
| **Chave do Gemini invalida (401)** | Chave errada ou expirada | Gera nova em [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| **Chave da TwitterAPI invalida (401)** | Chave errada ou nao gerenciada pelo admin | Avise o admin |
| **Acesso negado (403). A Lista pode ser privada** | Lista privada | Use uma Lista publica |
| **Lista nao encontrada (404)** | ID errado | Verifica o ID/URL da Lista |
| **Rate limit da TwitterAPI (429)** | Cota estourou | Espera 1 minuto |
| **A resposta do Gemini foi cortada por limite de tokens** | Batch grande demais pra resposta | Diminui "Teto de tweets por chamada" em Settings |
| **Nada na Lista** | Janela curta ou Lista vazia recentemente | Aumenta janela de tempo |
| **N tweets na janela, nenhum passou nos filtros** | Filtros muito restritivos | Reve idiomas aceitos e "incluir handles fora do grafo" |
| **URL ou ID invalido** (quick test) | URL mal formada | Cola URL completa: `https://x.com/usuario/status/123...` |
| **Arquivo nao parece ser um workspace exportado** | JSON invalido | Use so arquivos baixados via "exportar workspace" |
