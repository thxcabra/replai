# Replai

Extensão Chrome (Manifest V3) que faz **triagem semântica** e **gera 2-3 sugestões de reply** pra tweets de POIs (Persons of Interest) numa Lista do X.

A ideia: você curadoriza uma Lista de contas-alvo no X, aperta um botão, e a extensão devolve só os tweets que valem responder, cada um com algumas sugestões de reply no idioma do post original.

> **Vai só usar (não construir)?** Pula direto pro **[guia do analista](docs/guia.md)** — explica cada botão e funcionalidade da extensão.

---

## O que faz, passo a passo

1. **Puxa tweets** de uma Lista do X via [TwitterAPI.io](https://twitterapi.io), paginando até cobrir a janela de tempo configurada (default 10h).
2. **Pré-filtra** mecanicamente: descarta tweets fora da janela, sem texto, com menos de 5 palavras, retweets puros, idioma fora do filtro e contas marcadas como automatizadas.
3. **Enriquece** cada tweet cruzando o handle com um *social graph* local (`node_metrics_index.json`, gerado pelo projeto GroundSwell): pega ISV (Influence Score Vector), `inferred_layer` e flag de POI.
4. **Chama o LLM** (Gemini 2.5 Flash por padrão; Claude Sonnet 4.6 trocável) com o batch enriquecido. O system prompt é a *skill* `replai` (ver `replai.skill`), que faz a triagem semântica e escreve as replies seguindo regras de voz que evitam *tells* de LLM.
5. **Renderiza** os cards no side panel: ISV, layer, POI, padrão identificado, replies editáveis com contador de caracteres, e atalhos pra abrir a reply no X.

Tudo é manual (botão "atualizar") — sem polling automático.

---

## Setup

Pré-requisitos: Node 20+, npm. Chrome 114+.

```bash
git clone <repo>
cd replai
npm install
cp env/.env.example env/.env   # cole sua chave do Gemini e da TwitterAPI
npm run build                  # gera dist/
```

Depois, no Chrome:

1. Abra `chrome://extensions`
2. Ative **Developer mode** (canto superior direito)
3. Clique em **Load unpacked** e selecione a pasta `dist/`
4. Clique no ícone do Replai → abre o side panel → aperte **atualizar**

### Chaves de API

| Chave | Onde obtém | Custo |
|---|---|---|
| `VITE_TWITTERAPI_KEY` | https://twitterapi.io | pay-as-you-go (~$0.15/1k tweets) |
| `VITE_GEMINI_API_KEY` | https://aistudio.google.com/apikey | grátis (1500 req/dia) |
| `VITE_ANTHROPIC_API_KEY` | https://console.anthropic.com | pago |

As chaves vão no `env/.env` (fora do git) **ou** podem ser preenchidas na tela de configurações da extensão (prioridade: UI > `env/.env`). **Aviso:** `VITE_*` são embutidas no bundle em build time; o `env/.env` serve pra não vazar segredo no git, não pra esconder do cliente. Pra produção, mover pra um backend proxy.

---

## Workspaces

Cada **workspace** é um pacote isolado de configuração: ID da Lista, chaves (TwitterAPI + LLM), provider e modelo, custom prompt/persona, CSV de grafo uploaded, cache da última sessão e tweets marcados como respondidos. O analista cria um workspace por contexto (cliente, vertical, persona) e troca entre eles no dropdown do header.

Operações no topo da tela de settings:

- **Renomear o workspace ativo** — edita o nome no input, "salvar" persiste junto com o resto.
- **+ novo workspace** — abre form inline com nome e checkbox "copiar config e grafo deste workspace" (útil pra criar variações).
- **exportar** — baixa um JSON com config + grafo deste workspace (sem cache nem replied). Útil pra compartilhar setups entre analistas ou fazer backup. **Atenção:** o JSON inclui suas chaves de API em texto claro.
- **importar** — cria um novo workspace a partir de um JSON exportado.
- **excluir este workspace** — abre confirmação inline. Apaga config, grafo uploaded, cache e marcações. Se for o último, um Default vazio é recriado automaticamente.

Trocar de workspace no header também troca o cache da sessão renderizado — se você gerou replies no workspace A, voltar pra ele depois mostra elas de novo sem refazer a chamada. Um badge **"persona"** aparece no header quando o workspace ativo tem um custom prompt configurado.

**Migração não-destrutiva.** Quem já estava usando o Replai antes desta versão tem o config atual movido automaticamente pro workspace "Default" no primeiro carregamento. CSV uploaded e cache também. Nenhuma perda.

---

## Features no painel principal

- **Editar replies inline.** Cada reply é uma textarea editável com contador de chars. As edições são **persistidas no cache da sessão** — fechar e reabrir o painel mantém o que você escreveu.
- **Marcar tweet como respondido.** Botão "marcar" em cada card. Quando marcado, o card fica esmaecido e é empurrado pro final da lista (independente do critério de ordenação). Estado é persistido por workspace.
- **Quick test por URL.** Seção colapsável "testar um tweet específico" no topo do painel: cola URL de um tweet, roda a pipeline (com persona ativa) só nele. Pula o prefilter da Lista. Útil pra tunar a persona sem esperar o tweet aparecer organicamente.
- **Cooldown de 30s no atualizar.** Após cada refresh bem-sucedido, o botão fica desabilitado por 30s mostrando contagem regressiva — protege contra duplo-clique que queimaria cota da TwitterAPI.
- **Auto dry-run.** Se você apertar "atualizar" sem ter nenhuma chave de LLM configurada (UI ou `.env`), em vez de erro o app roda em dry-run automaticamente e mostra os tweets filtrados com mensagem clara do que falta configurar.
- **Ordenar.** Por ISV (default), mais recentes, ou POI primeiro. Tweets marcados como respondidos sempre vão pro final.

---

## CSV de grafo: upload com preview

Na seção "Social graph" do settings você pode subir um CSV próprio (substitui o `node_metrics_index.json` bundled, **por workspace**):

- Formato esperado: cabeçalho `handle,isv,inferred_layer,is_poi`. Ordem das colunas livre, case-insensitive. Aceita BOM, CRLF, campos com aspas. Handles podem vir com `@`.
- Após escolher o arquivo, aparece um **preview** com as 5 primeiras linhas parseadas + total de handles válidos + total de linhas puladas. Você confirma com "salvar grafo" ou descarta.
- "voltar pro bundled" remove o CSV uploaded e volta pro grafo padrão.

---

## Configuração (tela de settings)

| Campo | O que faz | Default |
|---|---|---|
| ID da Lista do X | aceita ID puro ou URL `x.com/i/lists/...` | (a Lista de seed) |
| Provider de LLM | Gemini (gratuito) ou Claude (pago) | Gemini |
| Janela de tempo | quantas horas pra trás puxar tweets | 10h |
| Teto de batch | máximo de tweets por chamada ao LLM | 25 |
| Idiomas aceitos | filtro de `lang` da TwitterAPI | en, pt, indefinido |
| Incluir handles fora do grafo | se desativado, descarta tweets de quem não está no `node_metrics` | ligado |
| Dry-run | só filtra, não chama o LLM (útil pra debug) | desligado |

A Lista precisa ser **pública**. Lista privada → 403.

---

## Como funciona o ISV e o social graph

O ISV **não é calculado em tempo de execução**. Ele vem de uma tabela estática (`src/assets/node_metrics_index.json`) gerada pelo projeto GroundSwell fora desta extensão.

- Handle **dentro do grafo** → recebe ISV, layer e flag de POI reais.
- Handle **fora do grafo** → recebe defaults (`isv=50`, `layer=3`, `is_poi=0`) e fica marcado como "fora do grafo" na UI.

Hoje o `node_metrics` tem **3057 handles mapeados, 14 POIs**. Pra ter ISV real de gente nova, é preciso regenerar o `node_metrics` pelo pipeline GroundSwell e trocar o JSON em `src/assets/`.

Implicação prática: trocar o ID da Lista funciona pra **puxar tweets** de qualquer Lista pública, mas a **priorização por ISV** só faz sentido pros handles que já estão no grafo.

---

## Provider de LLM

A camada de provider vive em `src/lib/`:

- `gemini.ts` — provider ativo por default. Usa `responseSchema` do Gemini pra forçar o JSON.
- `anthropic.ts` — provider alternativo. Usa prefill `{` pra forçar JSON.
- `llm.ts` — dispatcher: olha `config.llm_provider`, valida a chave (UI > `.env`), chama o provider certo.
- `parse-skill.ts` — parsing tolerante (markdown fence, brace extraction) compartilhado.
- `replai-schema.ts` — JSON schema (ajustado pro subset OpenAPI que o Gemini aceita: `nullable` em vez de `type: [..., "null"]`, sem `enum` de inteiro).

Pra alternar provider em runtime: trocar o radio na tela de settings. Sem reload, sem mudar código.

O system prompt vem da skill `replai`, embarcada como `src/assets/SKILL.md` (cópia idêntica do `replai.skill` zip que fica na raiz). Se editar o `replai.skill`, re-extraia o `SKILL.md` pra dentro de `src/assets/`.

---

## Estrutura de pastas

```
replai/
├── src/
│   ├── lib/                    # nucleo da logica (sem UI)
│   │   ├── twitterapi.ts       # fetch da Lista + fetchTweetById (quick test)
│   │   ├── prefilter.ts        # triagem mecanica
│   │   ├── graph.ts            # lookup no node_metrics (per-workspace)
│   │   ├── csv-parser.ts       # parse tolerante do CSV de upload
│   │   ├── llm.ts              # dispatcher de provider
│   │   ├── gemini.ts           # provider Gemini (ativo)
│   │   ├── anthropic.ts        # provider Claude (alternativo)
│   │   ├── parse-skill.ts      # parsing tolerante do output
│   │   ├── replai-schema.ts    # JSON schema da saida
│   │   ├── skill-prompt.ts     # SKILL.md + buildSystemPrompt c/ custom prompt
│   │   ├── orchestrator.ts     # cola tudo: fetch -> prefilter -> LLM (+ quick test)
│   │   ├── storage.ts          # workspaces + cache + replied + export/import
│   │   ├── errors.ts           # ApiError + mensagens amigaveis
│   │   ├── keys.ts             # chaves do .env (fallback)
│   │   ├── types.ts            # tipos do dominio
│   │   └── util.ts             # helpers de parsing
│   ├── sidepanel/              # UI Preact + Tailwind
│   ├── background/             # service worker (abre o side panel)
│   ├── preview/                # UI standalone p/ dev fora da extensao
│   └── assets/                 # SKILL.md + node_metrics_index.json
├── env/                        # variaveis de ambiente (configurada via envDir)
│   ├── .env                    # secrets reais (gitignored)
│   ├── .env.example            # template versionado
│   ├── .env.public             # override pro modo "public" (chaves vazias)
│   └── .env.team               # override pro modo "team" (so TwitterAPI)
├── scripts/gen-icons.mjs       # gera os PNGs dos icones
├── public/icons/               # icones servidos pelo manifest
├── docs/                       # guia do analista, briefing, analise de custo
│   ├── guia.md                 # referencia de funcionalidades p/ usuario final
│   ├── briefing.md             # contexto original do projeto
│   ├── twitterapi-cost.md      # analise de custo da TwitterAPI
│   └── v1-update-prompt.md     # historico: prompt da v1 update
├── releases/                   # zips de distribuicao (gitignored)
├── replai.skill                # source-of-truth da skill (zip)
├── manifest.config.ts          # manifest MV3 (via CRXJS)
├── vite.config.ts              # build da extensao
└── vite.preview.config.ts      # build standalone do side panel p/ dev
```

---

## Scripts npm

| Comando | O que faz |
|---|---|
| `npm run dev` | dev server CRXJS (recarrega a extensao com HMR) |
| `npm run build` | `tsc --noEmit && vite build` → gera `dist/` (com **todas** as chaves do `env/.env` embutidas, uso pessoal) |
| `npm run build:team` | gera `release/` com **apenas a chave da TwitterAPI** embutida — pra distribuir pro time que compartilha conta da TwitterAPI mas cada analista usa o próprio Gemini |
| `npm run build:public` | gera `release/` **sem nenhuma chave** embutida — pra distribuição totalmente externa (cada usuário traz tudo) |
| `npm run preview` | preview do build do Vite |
| `npm run preview:ui` | roda o side panel como página web normal (com mock do `chrome.*` e proxy pra TwitterAPI, contorna CORS no dev) |

---

## Distribuir pra outras pessoas

O `npm run build` padrão **embute as chaves do seu `env/.env`** no bundle (qualquer pessoa que abrir os arquivos JS dentro de `dist/` consegue extrair). Pra distribuir sem expor todas as chaves, existem dois modos:

```bash
# pro time: TwitterAPI compartilhada, cada analista usa o proprio Gemini
npm run build:team

# pra distribuicao externa: nenhuma chave embutida
npm run build:public
```

Os dois geram a pasta **`release/`** (o último a rodar vence). O build é universal — feito no Linux, roda igual em Windows, Mac e ChromeOS (extensão Chrome é só HTML/JS/CSS/PNG, sem dependência de SO).

**Como o destinatário usa:**

1. Recebe a pasta `release/` (zipada ou não)
2. Em `chrome://extensions`, liga **Developer mode**
3. **Load unpacked** → seleciona a pasta `release/`
4. Abre o side panel do Replai → clica em **config**
5. Cola a chave do Gemini (e a da TwitterAPI se for o build `public`)
6. Aperta **atualizar**

A pessoa precisa de:
- Chrome 114+ (qualquer SO)
- Chave do Gemini ([aistudio.google.com/apikey](https://aistudio.google.com/apikey)) — grátis (1500 req/dia)
- Chave da TwitterAPI ([twitterapi.io](https://twitterapi.io)) — só no build `public`

**Diferença entre os builds:**

| Comando | Pasta | TwitterAPI | Gemini/Anthropic | Pra quê |
|---|---|---|---|---|
| `npm run build` | `dist/` | sim | sim | uso pessoal / dev |
| `npm run build:team` | `release/` | **sim** (do `env/.env`) | não | distribuir pro time |
| `npm run build:public` | `release/` | não | não | distribuição externa total |

---

## Limitações conhecidas (POC)

- **Chaves no cliente.** `VITE_*` são embutidas no bundle. Pra produção, backend proxy.
- **Grafo estático.** Não há pipeline integrado pra atualizar o `node_metrics`. Handles novos caem no default.
- **Sem polling.** Atualização é manual por design (POC). Polling automático tá no roadmap.
- **TwitterAPI custa.** Cada "atualizar" gasta tweets da cota. Ver `docs/twitterapi-cost.md` pra estimativas.
- **Voz depende do modelo.** Gemini Flash com `thinkingBudget: 0` é determinístico e rápido, mas pode escorregar em nuance. Se a qualidade não bater, trocar pra Claude na UI.
