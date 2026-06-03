# Guia do Replai

Referência das funcionalidades. Cada item explica **o que é**, **pra que serve** e **como usar**.

Pensado pra ser lido por seções (use o índice) ou por busca direta no Ctrl+F.

---

## Índice

- [O que é o Replai](#o-que-é-o-replai)
- [Instalação](#instalação)
- **Cabeçalho do painel**
  - [Título e badge "persona"](#título-e-badge-persona)
  - [Seletor de workspace](#seletor-de-workspace)
  - [Botão atualizar](#botão-atualizar)
  - [Botão config](#botão-config)
- **Painel principal**
  - [Quick test por URL](#quick-test-por-url)
  - [Seletor de ordenação](#seletor-de-ordenação)
  - [Card de tweet](#card-de-tweet)
  - [Card de reply](#card-de-reply)
- **Configurações: Workspace**
  - [Nome do workspace ativo](#nome-do-workspace-ativo)
  - [Novo workspace](#novo-workspace)
  - [Exportar workspace](#exportar-workspace)
  - [Importar workspace](#importar-workspace)
  - [Excluir workspace](#excluir-workspace)
- **Configurações: Conexão e dados**
  - [ID da Lista do X](#id-da-lista-do-x)
  - [Social graph (CSV)](#social-graph-csv)
- **Configurações: LLM**
  - [Provider de LLM](#provider-de-llm)
  - [Contexto / persona](#contexto--persona)
  - [Chaves de API](#chaves-de-api)
  - [Modelo Anthropic](#modelo-anthropic)
- **Configurações: Filtros e batch**
  - [Janela de tempo](#janela-de-tempo)
  - [Teto de tweets por chamada](#teto-de-tweets-por-chamada)
  - [Idiomas aceitos](#idiomas-aceitos)
  - [Incluir handles fora do grafo](#incluir-handles-fora-do-grafo)
  - [Dry-run](#dry-run)
- **Comportamentos automáticos**
  - [Cooldown pós-refresh](#cooldown-pós-refresh)
  - [Auto dry-run](#auto-dry-run)
  - [Persistência de edits e marcações](#persistência-de-edits-e-marcações)
  - [Migração transparente](#migração-transparente)
- [Mensagens de erro comuns](#mensagens-de-erro-comuns)

---

## O que é o Replai

Uma extensão de Chrome que olha uma Lista que você curou no X, escolhe os tweets que valem ser respondidos, e gera 2-3 sugestões de reply pra cada um seguindo regras de voz que evitam *tells* de LLM. Você revisa, edita se quiser, copia, posta.

---

## Instalação

1. Descompactar a pasta `replai-team-*.zip`
2. Abrir `chrome://extensions`
3. Ligar **Developer mode** (canto superior direito)
4. **Load unpacked** → selecionar a pasta descompactada
5. Fixar o ícone na barra de extensões (opcional, mas recomendado)

Roda em Chrome 114+ em qualquer sistema (Windows, Mac, Linux).

---

# Cabeçalho do painel

## Título e badge "persona"

**O que é:** o nome "Replai" no canto superior esquerdo. Ao lado, um chip roxo escrito **persona** quando o workspace ativo tem contexto customizado configurado.

**Pra que serve:** dizer visualmente quando há uma persona influenciando as replies geradas. Sem o badge, o Replai está usando só o prompt base padrão.

**Como usar:** o badge aparece automaticamente. Pra ativar/desativar, você muda o campo "contexto / persona" em configurações.

## Seletor de workspace

**O que é:** um dropdown ao lado do título com o nome do workspace ativo.

**Pra que serve:** alternar entre contextos isolados (cliente A, cliente B, "sandbox de testes", etc). Cada workspace tem **sua própria configuração, persona, grafo, chaves, histórico e marcações** — totalmente independentes.

**Como usar:** clica no dropdown, seleciona outro workspace. Tudo no painel troca junto: cards renderizados, replies editadas, tweets marcados. Pra criar um novo, vai em **config**.

## Botão atualizar

**O que é:** o botão azul "atualizar" no canto superior direito.

**Pra que serve:** dispara uma nova sessão. Puxa tweets da Lista, filtra, e gera replies. **Cada sessão substitui a anterior** — não acumula.

**Como usar:** clica. Em 5 a 15 segundos os cards aparecem. Durante a chamada o botão mostra "..." e fica desabilitado.

> Depois de cada sucesso, o botão entra em [cooldown de 30 segundos](#cooldown-pós-refresh) mostrando contagem regressiva. Isso protege contra duplo-clique e queima desnecessária de cota da TwitterAPI (que é paga).

## Botão config

**O que é:** o botão "config" ao lado do "atualizar".

**Pra que serve:** abrir a tela de configurações do workspace ativo.

**Como usar:** clica. A tela toma o lugar do painel principal até você fechar (botão "fechar" no topo da tela de config).

---

# Painel principal

## Quick test por URL

**O que é:** uma seção colapsável "testar um tweet específico" logo acima dos cards.

**Pra que serve:** rodar a pipeline em um tweet escolhido por você — **pula o filtro automático da Lista**. Útil pra:
- Calibrar persona (cola um tweet conhecido, vê se a reply muda do jeito que você queria depois de ajustar a persona)
- Decidir se vale responder um tweet específico que você viu fora da Lista
- Documentar exemplos pra mostrar a colegas

**Como usar:**
1. Abre o colapsável
2. Cola a URL completa do tweet (ex: `https://x.com/usuario/status/123...`)
3. Clica em **rodar quick test**

> O resultado **substitui** o lote atual do painel. Se você tinha cards bons da última atualização, eles somem. Considere fazer o quick test num workspace separado se quiser preservar o batch atual.

## Seletor de ordenação

**O que é:** dropdown "ordenar por" que aparece quando há cards no painel.

**Pra que serve:** controlar a ordem em que os cards aparecem.

**Como usar:** três opções:

| Opção | Ordena por |
|---|---|
| **ISV (maior primeiro)** | Relevância na rede, do mais alto pro mais baixo (default) |
| **Mais recentes** | Tweets mais novos primeiro |
| **POI primeiro** | Persons of Interest no topo, depois pelo ISV |

Tweets [marcados como respondidos](#card-de-tweet) sempre vão pro final, independente do critério escolhido.

## Card de tweet

**O que é:** cada caixinha no painel principal — representa um tweet que passou nos filtros e tem replies geradas.

**Pra que serve:** mostrar tudo que você precisa pra decidir se vale responder e copiar uma reply.

**Componentes do card:**

- **@handle do autor** (link clicável vai pro perfil no X)
- **ISV** — número de 0 a 100. Quanto maior, mais relevante o autor na rede mapeada.
- **layer** — proximidade do núcleo da rede (1 = núcleo, 4-5 = periferia).
- **POI** — badge dourado quando o autor é um Person of Interest (alguém que você marcou prioritário no grafo).
- **fora do grafo** — badge cinza quando o autor **não está** no grafo carregado. Métricas dele são placeholder (ISV 50, layer 3).
- **padrão N** — número do padrão semântico identificado (1 a 11, ex: "opinião declarativa", "compartilha dado").
- **texto do tweet** — o tweet original em si.
- **contexto** (itálico, fundo escuro) — quando é quote tweet, reply de outro POI, ou tem informação adicional relevante.
- **respostas limitadas** (amarelo) — aviso quando o autor restringiu quem pode responder.

**Ações do card:**

- **abrir no X** — abre direto a tela de compor reply no X já apontando pro tweet original. Você cola a reply editada e posta.
- **ver tweet** — abre o tweet original em uma aba nova.
- **marcar** / **✓ respondido** — alterna o status de "já respondi este". Marcado fica esmaecido (opacity reduzido) e desce pro final da lista.

## Card de reply

**O que é:** cada caixinha menor dentro de um card de tweet — uma sugestão de resposta.

**Pra que serve:** mostrar a reply pronta pra você revisar, editar e copiar.

**Componentes:**

- **reply N** (selo azul) — número da reply (1, 2 ou 3)
- **categoria** (texto cinza) — qual das 9 categorias de valor: `dado concreto`, `referencia nominal`, `experiencia builder`, `pergunta especialista`, `info pratica`, `nomear fenomeno`, `caso concreto`, `cross-pollination`, `update info`
- **textarea editável** com o texto da reply
- **contador X/280** — vermelho se passar de 280 caracteres
- **botão copiar** — copia o texto editado pra área de transferência. Vira "copiado!" em verde por 1.5s depois do clique.

**Como usar:**
1. Lê a reply
2. Edita direto no texto se quiser ajustar tom/palavras
3. Copia
4. Cola no X (use o botão "abrir no X" no card pra ir direto)

**As edições são salvas automaticamente.** Fechar e reabrir o painel mantém o que você escreveu. Trocar de workspace e voltar também mantém.

---

# Configurações: Workspace

> Essa seção fica no topo da tela de **config**, dentro de uma caixa com o título `WORKSPACE (N NO TOTAL)`.

## Nome do workspace ativo

**O que é:** campo de texto com o nome do workspace que você está usando agora.

**Pra que serve:** identificar o workspace no dropdown do header. Pode ter qualquer texto.

**Como usar:** edita o nome, clica em **salvar** no fim da tela. O dropdown atualiza.

## Novo workspace

**O que é:** botão **+ novo workspace** que abre um pequeno formulário inline.

**Pra que serve:** criar um contexto novo do zero ou clonando o atual.

**Como usar:**
1. Clica em **+ novo workspace**
2. Digita o nome
3. (opcional) Marca **copiar config e grafo deste workspace** se quiser duplicar tudo (útil pra testar variações de persona sem perder o original)
4. Clica em **criar**

Você é levado pro novo workspace automaticamente. Se desmarcar a opção, ele começa com defaults.

## Exportar workspace

**O que é:** botão **exportar** na seção workspace.

**Pra que serve:** baixar um arquivo `.json` com **toda a configuração e o grafo** desse workspace. Útil pra:
- Compartilhar com um colega ("aqui está minha config do Cliente X")
- Fazer backup antes de mudar tudo
- Trocar de máquina (exporta na velha, importa na nova)

**Como usar:** clica em **exportar**. O navegador baixa um `.json` chamado `replai-workspace-<nome>.json`.

> **Atenção:** o JSON inclui suas chaves de API em texto claro. Compartilhe só com gente que você compartilharia as chaves diretamente.

## Importar workspace

**O que é:** botão **importar** na seção workspace.

**Pra que serve:** criar um workspace novo a partir de um JSON exportado.

**Como usar:**
1. Clica em **importar**
2. Escolhe o `.json`
3. Pronto — o workspace novo aparece no dropdown e vira o ativo

Se o arquivo for inválido, aparece mensagem de erro vermelha no topo do painel.

## Excluir workspace

**O que é:** botão vermelho **excluir este workspace** que abre uma confirmação inline.

**Pra que serve:** apagar config, grafo, cache e marcações do workspace ativo.

**Como usar:**
1. Clica em **excluir este workspace**
2. Lê o aviso vermelho que aparece
3. Clica em **confirmar exclusao**

Se for o último workspace, um "Default" vazio é criado automaticamente no lugar — você nunca fica sem workspace.

---

# Configurações: Conexão e dados

## ID da Lista do X

**O que é:** campo de texto onde você cola o identificador da Lista do X de onde os tweets vão ser puxados.

**Pra que serve:** definir a fonte dos tweets. **A Lista precisa ser pública** (Listas privadas dão erro 403).

**Como usar:** aceita dois formatos:
- ID puro: `1234567890`
- URL completa: `https://x.com/i/lists/1234567890` (o app extrai o ID)

Salva e atualiza pra puxar da Lista nova. Trocar a Lista limpa o cache da sessão (o que estava antes não vale mais).

## Social graph (CSV)

**O que é:** seção com status do grafo de relevância (ISV, layer, POI) usado pra enriquecer os tweets. Mostra "Usando o grafo bundled (N handles)" ou "<nome do arquivo> (N handles, M POIs)" se você subiu um próprio.

**Pra que serve:** controlar de onde vêm as métricas de relevância. O Replai vem com um grafo padrão (3057 handles). Você pode subir um CSV próprio que **substitui o padrão só nesse workspace**.

**Formato do CSV:**

```csv
handle,isv,inferred_layer,is_poi
patio11,92.4,1,1
naval,88.0,1,1
random_dev,45.3,3,0
```

- **handle:** username do X (pode ter `@`, case-insensitive, espaços são trimados)
- **isv:** número de 0 a 100
- **inferred_layer:** inteiro (1 = núcleo, 5 = periferia)
- **is_poi:** 0 ou 1
- Ordem das colunas livre. Aceita BOM, CRLF, campos com aspas.

**Como usar:**

1. Clica em **carregar CSV** → escolhe o arquivo
2. Aparece um **preview** com as 5 primeiras linhas parseadas, contadores e (se houver) lista de linhas que foram puladas com motivo
3. **salvar grafo** → ativa pro workspace, ou **descartar** se quiser cancelar
4. Pra reverter pro padrão depois: **voltar pro bundled**

**Quando subir um próprio:**
- Cliente tem rede própria já mapeada
- Você quer focar num nicho que o grafo padrão não cobre
- Está testando metodologia nova de scoring

---

# Configurações: LLM

> Estas configurações ficam dentro do colapsável **chaves de API e modelo** (fechado por default — você raramente mexe nelas) e nos campos visíveis logo acima.

## Provider de LLM

**O que é:** radio button com duas opções: **Gemini 2.5 Flash (gratuito)** e **Claude Sonnet 4.6 (pago)**.

**Pra que serve:** escolher qual modelo gera as replies.

| Provider | Custo | Quando usar |
|---|---|---|
| **Gemini 2.5 Flash** | Grátis (1500 req/dia) | Default. Suficiente pra maioria dos casos. |
| **Claude Sonnet 4.6** | Pago (~$3/M tokens input, ~$15/M output) | Quando a qualidade de voz do Gemini não bate ou em contextos que pedem nuance |

**Como usar:** seleciona o radio. A próxima atualização usa o provider escolhido.

## Contexto / persona

**O que é:** textarea opcional onde você descreve quem você é e que tipo de reply quer.

**Pra que serve:** **moldar a voz das replies por contexto** sem mexer no prompt base. O texto que você escreve aqui é anexado ao prompt antes da chamada do LLM, e o modelo usa pra escolher referências, ângulos e tom.

**Como usar:** escreve texto livre, salva. Quando há persona ativa, o badge **persona** aparece no header.

**Exemplo:**

```
sou PM de fintech B2B focado em risco. priorize replies que tragam casos
de risk modeling e referencias a praticantes da area (varo, nubank, etc).
```

**Boas práticas:**
- Concreto e direto ao ponto. Diga seu papel, sua indústria, o que priorizar.
- Cite nomes válidos pra ancorar (autores, empresas, frameworks reais).
- Diga o que evitar tanto quanto o que priorizar.

**O que evitar:**
- Persona vaga ("seja interessante") — não muda nada
- Pedir coisas que o skill base proíbe (travessões, paralelismo negativo, etc.) — vai ser ignorado, as regras de voz vencem
- Escrever em outro idioma pensando que vai mudar o idioma da reply — **a reply replica o idioma do tweet, não da persona**

## Chaves de API

**O que são:** três campos `password` pras chaves dos serviços.

**Pra que servem:** autenticar suas chamadas. Cada um tem fallback: se você não colar nada na UI, o app tenta usar a chave embutida no build (`.env`).

| Chave | Onde obter | Quando configurar |
|---|---|---|
| **TwitterAPI** | [twitterapi.io](https://twitterapi.io) | Se o build que você recebeu não tem chave embutida ("Vazio = Chave Padrão" no placeholder indica que tem fallback) |
| **Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (grátis, sem cartão) | Sempre. Cada analista usa a sua. |
| **Anthropic** | [console.anthropic.com](https://console.anthropic.com) | Só se você for trocar pra Claude |

**Como usar:** cola a chave, salva. Os campos são tipo password — não mostram o texto na tela.

> Você pode deixar os campos vazios se o build tem chave embutida pra aquele serviço. A chave da UI tem prioridade sobre a embutida — colou aqui, é essa que vale.

## Modelo Anthropic

**O que é:** dropdown que aparece **só quando** o provider selecionado é Claude. Lista os modelos disponíveis.

**Pra que serve:** escolher a variante de Claude.

**Opções:**

| Modelo | Pra quê |
|---|---|
| **Sonnet 4.6 (padrão)** | Default. Bom equilíbrio qualidade/custo. |
| **Opus 4.7** | Máxima qualidade, ~5x mais caro. Pra casos sensíveis. |
| **Haiku 4.5** | Mais barato e rápido. Pra rascunho ou volumes altos. |

**Como usar:** seleciona, salva.

---

# Configurações: Filtros e batch

> Estas configurações ficam dentro do colapsável **filtros e batch** (fechado por default).

## Janela de tempo

**O que é:** campo numérico em **horas**.

**Pra que serve:** controlar quanto tempo pra trás o Replai puxa tweets da Lista a cada atualizar.

**Como usar:**
- Lista muito ativa (muitos tweets/hora) → diminui pra não estourar batch
- Lista pouco ativa → aumenta pra ter material suficiente

Default: **10h**. Vai de 1 a 168 (uma semana).

## Teto de tweets por chamada

**O que é:** campo numérico (padrão **25**).

**Pra que serve:** limitar quantos tweets vão pro LLM por chamada. Se a Lista trouxe mais que isso depois dos filtros, os excedentes ficam fora dessa sessão.

**Como usar:** quase nunca precisa mexer. Default está bom. Diminuir reduz custo por refresh; aumentar tem risco de truncar a resposta do LLM.

## Idiomas aceitos

**O que é:** três checkboxes: **ingles**, **portugues**, **indefinido**.

**Pra que serve:** filtrar tweets pelo idioma detectado pela TwitterAPI. Tweet em idioma não-marcado vai pro descarte.

**Como usar:**
- Lista mista (PT + EN) → marca os dois + "indefinido" (default)
- Lista só em EN → desmarca PT pra reduzir ruído
- Lista em outro idioma → marca "indefinido" e desmarca os outros (você vai precisar testar)

## Incluir handles fora do grafo

**O que é:** checkbox.

**Pra que serve:** decidir o que fazer com tweets de autores que **não estão no grafo carregado**.

**Como usar:**

| Estado | Comportamento |
|---|---|
| **Ligado** (default) | Tweets de handles fora do grafo entram com métricas placeholder (ISV 50, layer 3) e badge "fora do grafo" |
| **Desligado** | Tweets de handles fora do grafo são descartados |

Liga quando sua Lista pode ter pessoas relevantes que ainda não foram mapeadas. Desliga se você só quer focar nos handles que já tem score.

## Dry-run

**O que é:** checkbox.

**Pra que serve:** rodar o pipeline **sem chamar o LLM**. Só filtra os tweets e mostra os que passariam.

**Como usar:** liga quando quer:
- Conferir se a Lista tá puxando os tweets certos
- Ver quantos passam no filtro antes de gastar requisição
- Testar configuração de janela / idiomas

Os cards aparecem sem as replies geradas (texto "modo dry-run: passou no filtro, replies nao geradas"). Desliga depois pra ter as replies de novo.

---

# Comportamentos automáticos

> Estes não têm botão nem campo — acontecem sozinhos.

## Cooldown pós-refresh

**O que é:** bloqueio de 30 segundos no botão **atualizar** depois de cada refresh bem-sucedido.

**Pra que serve:** proteger sua carteira. Cada atualizar consome cota da TwitterAPI (que é paga por tweet baixado). Sem o cooldown, dois cliques rápidos = dois custos.

**Como usar:** o botão fica desabilitado mostrando contagem regressiva (`29s`, `28s`, ...). Espera ou faz outra coisa até voltar a aparecer "atualizar".

O cooldown também vale pro **quick test** (que também usa TwitterAPI).

## Auto dry-run

**O que é:** o app **não** dá erro quando você não tem chave de LLM configurada — ele roda em dry-run automaticamente.

**Pra que serve:** primeiro contato mais amigável. Se você instalou agora, ainda não configurou Gemini, mas já apertou atualizar, em vez de "ERRO" você vê os tweets filtrados com mensagem explicando "sem chave de LLM configurada — rodou em dry-run. configure uma chave em settings pra gerar replies".

**Como usar:** o auto dry-run ativa sozinho. Pra desligar, é só configurar uma chave de LLM (Gemini grátis em [aistudio.google.com/apikey](https://aistudio.google.com/apikey)).

## Persistência de edits e marcações

**O que é:** as edições que você faz nas replies e os tweets marcados como respondidos **ficam salvos** entre sessões.

**Pra que serve:** não perder trabalho. Fechar o painel, trocar de aba, reiniciar o navegador — tudo continua lá quando você abrir de novo.

Persistência por workspace: cada workspace tem suas próprias edições e marcações. Trocar de workspace troca esse histórico junto. Atualizar **substitui** os cards (porque é uma sessão nova), mas o que você editou na sessão anterior fica no cache até a próxima atualizar.

## Migração transparente

**O que é:** se você já usava versões anteriores do Replai (antes de workspaces existirem), sua config antiga é movida automaticamente pro workspace "Default" no primeiro carregamento.

**Pra que serve:** upgrade sem dor. Você não precisa reconfigurar nada.

O cache da sessão antiga e o CSV de grafo que você tinha uploaded também migram pro Default.

---

# Mensagens de erro comuns

> As mensagens aparecem numa caixa vermelha no topo do painel principal.

| Mensagem | Causa provável | Como resolver |
|---|---|---|
| "Configure a chave da TwitterAPI..." | Build sem chave embutida e UI vazia | Cola sua chave em config → "chaves de API e modelo" |
| "Chave da TwitterAPI.io invalida (401)" | Chave errada ou expirada | Confere em [twitterapi.io](https://twitterapi.io) |
| "Acesso negado (403). A Lista pode ser privada" | Lista privada | Use uma Lista pública |
| "Lista nao encontrada (404)" | ID errado | Verifica o ID/URL da Lista |
| "Rate limit da TwitterAPI (429)" | Cota estourou | Espera 1 minuto |
| "Configure a chave do Gemini..." | Sem chave configurada nem embutida | Cola em config, ou liga dry-run pra testar antes |
| "Chave do Gemini invalida (401)" | Chave errada ou expirada | Gera nova em [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| "A resposta do Gemini foi cortada por limite de tokens" | Batch grande demais pra resposta | Diminui o "Teto de tweets por chamada" |
| "Nada na Lista" | Janela curta ou Lista vazia recentemente | Aumenta janela de tempo |
| "N tweets na janela, nenhum passou nos filtros" | Filtros restritivos | Revê idiomas aceitos, "incluir handles fora do grafo" |
| "URL ou ID invalido" (quick test) | URL mal-formada | Cola URL completa: `https://x.com/usuario/status/123...` |
| "Arquivo nao parece ser um workspace exportado" | Tentando importar JSON inválido | Use apenas arquivos baixados via "exportar workspace" |
