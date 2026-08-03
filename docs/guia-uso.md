# Guia de uso — Replai V5.1

Replai gera replies calibradas pela sua voz em **X** e **LinkedIn** — no LinkedIn usa a estrategia Groundswell (reply em Bridges pra impactar POIs indiretamente).

Setup completo cobre: instalar, logar, escolher canal, gerar replies. Pra troubleshooting detalhado ver [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

## 1. Instalar (unpacked local)

V5.1 e distribuida como pacote local (nao pela Web Store ainda).

1. Recebe o arquivo `replai-v0.5.1-sideload.zip` do time
2. Descompacta numa pasta permanente (nao delete depois — o Chrome le direto dela)
3. Chrome → `chrome://extensions` → liga **Modo do desenvolvedor** (canto direito)
4. Clica **Carregar sem compactacao** → seleciona a pasta descompactada
5. Fixa o icone do Replai na barra (puzzle → alfinete)
6. Clica no icone pra abrir o sidepanel

Atualizacao futura: mesma pasta, novo `.zip` → sobrescreve → botao **recarregar** em `chrome://extensions`.

---

## 2. Login

1. Clique **entrar com Google** no sidepanel
2. Use email `@moicdigital.com` — outros dominios sao bloqueados
3. Primeiro login cria seu perfil automatico no Supabase

---

## 3. Setup do workspace (uma vez)

Primeiro login cai direto em **Settings**. Preencha em 3 tabs:

### Tab **Geral** (obrigatorio)
- **Chaves LLM**: cola chave Gemini ([aistudio.google.com](https://aistudio.google.com/app/apikey)) ou Anthropic ([console.anthropic.com](https://console.anthropic.com/settings/keys))
- **Provider**: escolhe qual usar (Gemini = mais barato / Claude = mais preciso)
- **Modelo**: default `claude-sonnet-4-6` funciona

### Tab **X** (se voce vai usar X)
- **Voz do canal X** (obrigatorio, min 50 chars, ideal 200-500 palavras): cola texto ou sobe .md
- **Persona X** (opcional): 1 publico-alvo por linha (ex: "VCs cripto SP")
- **Fontes** → cola 1+ Lista do X (URL ou ID)
- **Chave TwitterAPI**: pega em [twitterapi.io](https://twitterapi.io) (compartilhada do time)

### Tab **LinkedIn** (se voce vai usar LinkedIn)
- **Voz LinkedIn** (obrigatorio, min 50 chars): **separada da voz do X** — LinkedIn premia tom formal/longform
- **Persona LinkedIn** (opcional): publicos-alvo especificos do LinkedIn (ex: "CTOs fintech B2B")
- **Listas Groundswell**: sobe 1+ bundle Groundswell (`.zip`). Cada bundle vira uma "lista" alternavel no Header.
- **Filtros + batch**: janela de tempo (default 168h = 1 semana) + max posts por atualizar (default 50)

Clique **salvar** no topo do Settings.

---

## 4. Fluxo — canal X

1. Header → chip **X** → botao azul **atualizar**
2. Replai roda em background: fetch da Lista → prefilter → selection scorer LLM → triagem
3. Cada tweet aparece como card com autor + texto + ISV + chips
4. Selecione tweets → clique **gerar replies**
5. Reply gerada: **responder** (abre X com texto), **QT**, **regerar**, **editar**
6. Apos postar no X, volta pro Replai → cola link do tweet postado no dialog → registrado

---

## 5. Fluxo — canal LinkedIn

1. Header → chip **LINKEDIN** → posts armazenados aparecem instant (mode cache, $0 APIFY)
2. Se vazio ou desatualizado, clique **atualizar** — chama APIFY, upsert delta (so posts novos)
3. Chip de custo APIFY no topo: `hoje: $X · N runs / mes: $Y · N runs`
4. Cards mostram post da Bridge + POI-target sugerido
5. Clique no post → LLM gera reply LinkedIn (com contexto Groundswell)
6. Botao **voltar** preserva o draft (nao regenera se voltar depois)
7. **postar** copia texto pro clipboard + abre post original no LinkedIn → cola no comentario
8. Cola URL do comment postado pra registrar (opcional)

**Comportamento importante**:
- **Trocar aba/canal e voltar NAO gasta APIFY** — usa store persistente
- **Cada post scraped fica salvo por 1 semana** — atualizar traz so os novos
- **Posts respondidos** vao pro fim da lista, em cinza (nao somem — vao pro historico depois)
- Empty state mostra funnel de filtros pra diagnosticar (raw / old / reposts / engaged)

---

## 6. Historico + Analytics

- **Header → historico**: replies X (canal X ativo) ou replies LinkedIn (canal LinkedIn ativo). Filtros por status.
- **Header → admin**: cost APIFY (LinkedIn) + eventos + inteligencia + exportar CSV.

---

## 7. Glossario (help contextual)

`?` no Header abre o glossario com termos tecnicos (POI, Bridge, ISV, Groundswell, Persona, etc). Cada bloco de Settings tambem tem `?` inline nos termos-chave.

---

## 8. Troubleshooting rapido

| sintoma | acao |
|---|---|
| "OAuth flow falhou" | reinstala pela mesma pasta descompactada (ID pinnado no manifest) |
| Login recusa | confere email `@moicdigital` |
| LinkedIn: 429 na Edge Function | teto diario APIFY estourou. Pede admin subir `APIFY_DAILY_LIMIT_HARD` no Supabase |
| LinkedIn: 0 posts mesmo com janela grande | ve funnel no empty state. Bridges podem realmente estar dormentes. Botao "ver bridges" pra checar manual |
| LinkedIn: chip de custo alto | reduz janela pra 72h ou trabalha em canais alternados |
| replies genericas | voz curta/vazia. Reescreve com 200+ palavras especificas |
| dashboard vazio | gera pelo menos 1 reply postada primeiro |

Detalhes em [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
