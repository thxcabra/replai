# Replai

Extensão Chrome (Manifest V3) que faz **triagem semântica** e **gera 2-3 sugestões de reply** pra tweets de POIs (Persons of Interest) numa Lista do X.

A ideia: você curadoriza uma Lista de contas-alvo no X, aperta um botão, e a extensão devolve só os tweets que valem responder, cada um com algumas sugestões de reply no idioma do post original.

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
cp .env.example .env   # cole sua chave do Gemini e da TwitterAPI
npm run build          # gera dist/
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

As chaves vão no `.env` (fora do git) **ou** podem ser preenchidas na tela de configurações da extensão (prioridade: UI > `.env`). **Aviso:** `VITE_*` são embutidas no bundle em build time; o `.env` serve pra não vazar segredo no git, não pra esconder do cliente. Pra produção, mover pra um backend proxy.

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

O ISV **não é calculado em tempo de execução**. Ele vem de uma tabela estática (`src/assets/node_metrics_index.json`) gerada pelo projeto MOIC fora desta extensão.

- Handle **dentro do grafo** → recebe ISV, layer e flag de POI reais.
- Handle **fora do grafo** → recebe defaults (`isv=50`, `layer=3`, `is_poi=0`) e fica marcado como "fora do grafo" na UI.

Hoje o `node_metrics` tem **3057 handles mapeados, 14 POIs**. Pra ter ISV real de gente nova, é preciso regenerar o `node_metrics` pelo pipeline MOIC e trocar o JSON em `src/assets/`.

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
│   │   ├── twitterapi.ts       # fetch da Lista
│   │   ├── prefilter.ts        # triagem mecanica
│   │   ├── graph.ts            # lookup no node_metrics
│   │   ├── llm.ts              # dispatcher de provider
│   │   ├── gemini.ts           # provider Gemini (ativo)
│   │   ├── anthropic.ts        # provider Claude (alternativo)
│   │   ├── parse-skill.ts      # parsing tolerante do output
│   │   ├── replai-schema.ts    # JSON schema da saida
│   │   ├── skill-prompt.ts     # carrega SKILL.md como system prompt
│   │   ├── orchestrator.ts     # cola tudo: fetch -> prefilter -> LLM
│   │   ├── storage.ts          # chrome.storage.local (config + cache)
│   │   ├── errors.ts           # ApiError + mensagens amigaveis
│   │   ├── keys.ts             # chaves do .env (fallback)
│   │   ├── types.ts            # tipos do dominio
│   │   └── util.ts             # helpers de parsing
│   ├── sidepanel/              # UI Preact + Tailwind
│   ├── background/             # service worker (abre o side panel)
│   ├── preview/                # UI standalone p/ dev fora da extensao
│   └── assets/                 # SKILL.md + node_metrics_index.json
├── scripts/gen-icons.mjs       # gera os PNGs dos icones
├── public/icons/               # icones servidos pelo manifest
├── docs/                       # briefing, analise de custo, etc
├── replai.skill                # source-of-truth da skill (zip)
└── manifest.config.ts          # manifest MV3 (via CRXJS)
```

---

## Scripts npm

| Comando | O que faz |
|---|---|
| `npm run dev` | dev server CRXJS (recarrega a extensao com HMR) |
| `npm run build` | `tsc --noEmit && vite build` → gera `dist/` |
| `npm run preview` | preview do build do Vite |
| `npm run preview:ui` | roda o side panel como página web normal (com mock do `chrome.*` e proxy pra TwitterAPI, contorna CORS no dev) |

---

## Limitações conhecidas (POC)

- **Chaves no cliente.** `VITE_*` são embutidas no bundle. Pra produção, backend proxy.
- **Grafo estático.** Não há pipeline integrado pra atualizar o `node_metrics`. Handles novos caem no default.
- **Sem polling.** Atualização é manual por design (POC). Polling automático tá no roadmap.
- **TwitterAPI custa.** Cada "atualizar" gasta tweets da cota. Ver `docs/twitterapi-cost.md` pra estimativas.
- **Voz depende do modelo.** Gemini Flash com `thinkingBudget: 0` é determinístico e rápido, mas pode escorregar em nuance. Se a qualidade não bater, trocar pra Claude na UI.
