# Instruções para o agente — adicionar camada de LLM na extensão Replai

Cola esse documento inteiro no agente (Claude Code, Cursor, etc) junto com o repositório da extensão. O agente vai entender o que fazer e em qual ordem.

---

## Contexto

A extensão Replai já existe em uma primeira versão funcional. Ela:

- Puxa tweets de uma Lista do X via TwitterAPI.io
- Consulta um social graph local (`node_metrics`) e enriquece cada tweet com `isv`, `inferred_layer`, `is_poi`
- Tem o system prompt da skill `replai` embarcado em algum arquivo no projeto

**O que falta:** a chamada de LLM. Atualmente os tweets enriquecidos não chegam a um modelo, então não há geração de replies. Sua tarefa é fechar esse gap **sem refatorar partes que já funcionam**.

---

## Tarefa principal

Adicionar uma camada de abstração de LLM provider que:

1. **Default:** chama Google Gemini 2.5 Flash via free tier
2. **Alternativo (esqueleto pronto):** Anthropic Claude Sonnet 4.6, ativável sem mudar código (só config no storage da extensão)
3. **Pluga no flow existente:** após o enriquecimento dos tweets, manda o batch pro provider ativo e recebe um JSON estruturado com as replies sugeridas

A escolha de Gemini como default é proposital: free tier de 1500 req/dia + JSON schema enforcement nativo (elimina parse fails). Anthropic fica como upgrade path pago se a qualidade pedir.

---

## Antes de codar: orientação

**Não refatore o que já funciona.** TwitterAPI integration, parsing de tweets, lookup no node_metrics, pré-filtros (se já existem), embedding do system prompt — tudo isso fica como está. Sua intervenção é cirúrgica: adicionar o provider, plugar no ponto certo do flow, e ajustar UI de settings pras chaves de API.

**Leia o estado atual primeiro.** Antes de criar arquivos novos, varra o projeto pra entender:
- Onde está o flow principal (puxar tweets → filtrar → enriquecer)
- Onde está o system prompt embarcado e em que formato (string, arquivo .md raw, template literal)
- Como o storage da extensão está estruturado (`chrome.storage.local`)
- Se já tem TypeScript ou só JavaScript
- Se já tem alguma tela de settings ou só um popup simples

**Adapte a estrutura sugerida à arquitetura existente.** Se o projeto não usa pastas tipo `src/providers/`, encaixe os arquivos na convenção que já tem. O que importa é a separação lógica, não os caminhos exatos.

---

## Verificação prévia: o system prompt está atualizado?

Antes de adicionar o provider, confirme que o system prompt embarcado no projeto corresponde à versão atual da skill. A versão atual:

1. Tem contrato JSON estruturado (input e output)
2. Espera `isv`, `inferred_layer`, `is_poi` já anexados em cada tweet do payload
3. Devolve APENAS tweets que passaram (descartados não vão no output)
4. Gera 2 ou 3 replies por tweet (não sempre 3)
5. Tem categorias em snake_case (`experiencia_builder`, `pergunta_especialista`, etc.)
6. Tem idioma replicando o do tweet (maioria EN, alguns PT)

Se o prompt embarcado for de uma versão anterior (sem contrato JSON ou com formato de saída em prosa), **substitua pelo conteúdo do SKILL.md mais recente** (anexado a este prompt, ou peça pro usuário).

---

## Estrutura sugerida (adapte ao projeto)

```
src/
├── providers/
│   ├── types.ts          ← interface comum + tipos compartilhados
│   ├── gemini.ts         ← GeminiProvider (ativo)
│   ├── anthropic.ts      ← AnthropicProvider (esqueleto pronto)
│   └── index.ts          ← factory createProvider(config)
├── schema/
│   └── replai-response.ts ← JSON schema da resposta
└── (resto do projeto, intocado)
```

Se o projeto for JS puro sem TypeScript, mantenha a mesma separação em `.js`, apenas sem os tipos. Recomendo migrar pra TS gradualmente, mas não bloqueie a tarefa por causa disso.

---

## Implementação: arquivos a criar

### `providers/types.ts`

```ts
export type ReplyCategory =
  | "dado_concreto"
  | "referencia_nominal"
  | "experiencia_builder"
  | "pergunta_especialista"
  | "info_pratica"
  | "nomear_fenomeno"
  | "caso_concreto"
  | "cross_pollination"
  | "update_info";

export interface TweetInput {
  tweet_id: string;
  handle: string;
  text: string;
  timestamp?: string;
  isv: number;
  inferred_layer: number | null;
  is_poi: 0 | 1;
  context?: string | null;
  not_in_graph?: boolean;
}

export interface BatchPayload {
  tweets: TweetInput[];
}

export interface Reply {
  text: string;
  category: ReplyCategory;
}

export interface ResultItem {
  tweet_id: string;
  handle: string;
  isv: number;
  inferred_layer: number | null;
  is_poi: 0 | 1;
  pattern: number;
  pattern_label: string;
  replies: Reply[];
  not_in_graph?: boolean;
}

export interface SkillResponse {
  results: ResultItem[];
  summary: { received: number; passed: number; discarded: number };
}

export interface LLMProvider {
  name: "gemini" | "anthropic";
  generateReplies(payload: BatchPayload, systemPrompt: string): Promise<SkillResponse>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly statusCode?: number,
    public readonly raw?: unknown
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
```

### `schema/replai-response.ts`

JSON schema usado pelo Gemini pra forçar estrutura. Mantém o output sob controle.

```ts
export const REPLAI_RESPONSE_SCHEMA = {
  type: "object",
  required: ["results", "summary"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        required: ["tweet_id", "handle", "isv", "inferred_layer", "is_poi", "pattern", "pattern_label", "replies"],
        properties: {
          tweet_id: { type: "string" },
          handle: { type: "string" },
          isv: { type: "number" },
          inferred_layer: { type: ["integer", "null"] },
          is_poi: { type: "integer", enum: [0, 1] },
          pattern: { type: "integer", minimum: 1, maximum: 11 },
          pattern_label: { type: "string" },
          not_in_graph: { type: "boolean" },
          replies: {
            type: "array",
            minItems: 2,
            maxItems: 3,
            items: {
              type: "object",
              required: ["text", "category"],
              properties: {
                text: { type: "string", maxLength: 320 },
                category: {
                  type: "string",
                  enum: [
                    "dado_concreto", "referencia_nominal", "experiencia_builder",
                    "pergunta_especialista", "info_pratica", "nomear_fenomeno",
                    "caso_concreto", "cross_pollination", "update_info"
                  ]
                }
              }
            }
          }
        }
      }
    },
    summary: {
      type: "object",
      required: ["received", "passed", "discarded"],
      properties: {
        received: { type: "integer" },
        passed: { type: "integer" },
        discarded: { type: "integer" }
      }
    }
  }
} as const;
```

### `providers/gemini.ts` (provider ativo)

```ts
import type { BatchPayload, LLMProvider, SkillResponse } from "./types";
import { ProviderError } from "./types";
import { REPLAI_RESPONSE_SCHEMA } from "../schema/replai-response";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini" as const;
  constructor(private readonly apiKey: string) {}

  async generateReplies(payload: BatchPayload, systemPrompt: string): Promise<SkillResponse> {
    const body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: REPLAI_RESPONSE_SCHEMA,
        temperature: 0.8,
        maxOutputTokens: 4096
        // pra economizar tokens desabilitando thinking:
        // thinkingConfig: { thinkingBudget: 0 }
      }
    };

    let res: Response;
    try {
      res = await fetch(GEMINI_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey
        },
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw new ProviderError("Network error calling Gemini", "gemini", undefined, e);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(
        `Gemini ${res.status}: ${text.slice(0, 300)}`,
        "gemini",
        res.status,
        text
      );
    }

    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      throw new ProviderError("Gemini returned no text content", "gemini", undefined, data);
    }

    try {
      return JSON.parse(raw) as SkillResponse;
    } catch (e) {
      throw new ProviderError(
        "Gemini returned invalid JSON despite schema",
        "gemini",
        undefined,
        raw
      );
    }
  }
}
```

### `providers/anthropic.ts` (esqueleto, não ativo no default)

```ts
import type { BatchPayload, LLMProvider, SkillResponse } from "./types";
import { ProviderError } from "./types";

const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic" as const;
  constructor(private readonly apiKey: string) {}

  async generateReplies(payload: BatchPayload, systemPrompt: string): Promise<SkillResponse> {
    const body = {
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      system: [{
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" }
      }],
      messages: [{ role: "user", content: JSON.stringify(payload) }]
    };

    let res: Response;
    try {
      res = await fetch(ANTHROPIC_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw new ProviderError("Network error calling Anthropic", "anthropic", undefined, e);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(
        `Anthropic ${res.status}: ${text.slice(0, 300)}`,
        "anthropic",
        res.status,
        text
      );
    }

    const data = await res.json();
    const raw = data?.content?.[0]?.text;
    if (!raw) {
      throw new ProviderError("Anthropic returned no text content", "anthropic", undefined, data);
    }

    // Anthropic não tem responseSchema. Limpar markdown wrapping caso o modelo embrulhe.
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    try {
      return JSON.parse(cleaned) as SkillResponse;
    } catch (e) {
      throw new ProviderError(
        "Anthropic returned invalid JSON",
        "anthropic",
        undefined,
        raw
      );
    }
  }
}
```

### `providers/index.ts` (factory)

```ts
import { GeminiProvider } from "./gemini";
import { AnthropicProvider } from "./anthropic";
import type { LLMProvider } from "./types";

export type ProviderName = "gemini" | "anthropic";

export interface ProviderConfig {
  provider: ProviderName;
  geminiApiKey?: string;
  anthropicApiKey?: string;
}

export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.provider) {
    case "gemini":
      if (!config.geminiApiKey) throw new Error("Gemini API key not configured");
      return new GeminiProvider(config.geminiApiKey);
    case "anthropic":
      if (!config.anthropicApiKey) throw new Error("Anthropic API key not configured");
      return new AnthropicProvider(config.anthropicApiKey);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

export * from "./types";
```

---

## Integração com o flow existente

Identifique no código atual o ponto onde os tweets já estão enriquecidos com ISV/layer/POI. Depois desse ponto, e antes de qualquer render de UI, insira:

```ts
import { createProvider } from "./providers";
import { REPLAI_SYSTEM_PROMPT } from "<o lugar onde o prompt está embarcado>";

// `enrichedTweets` é o array que já vem do flow atual da extensão.
// Cada item deve ter pelo menos: tweet_id, handle, text, isv, inferred_layer, is_poi.
// Ordenar antes de mandar (ISV desc, POI desempata, layer menor desempata) se ainda não estiver ordenado.

const config = await loadConfigFromStorage(); // helper existente ou novo

const provider = createProvider({
  provider: config.llm_provider ?? "gemini",
  geminiApiKey: config.gemini_api_key,
  anthropicApiKey: config.anthropic_api_key
});

try {
  const result = await provider.generateReplies(
    { tweets: enrichedTweets },
    REPLAI_SYSTEM_PROMPT
  );
  // result.results contém só os tweets que passaram, com replies.
  // result.summary tem { received, passed, discarded } pra mostrar contador na UI.
  renderCards(result.results, result.summary);
} catch (e) {
  if (e instanceof ProviderError) {
    showErrorInUI(`${e.provider} error (${e.statusCode}): ${e.message}`);
  } else {
    showErrorInUI("Erro inesperado ao gerar replies. Veja o console.");
    console.error(e);
  }
}
```

**Atenção ao mapping do payload.** A v1 atual pode ter os tweets enriquecidos com nomes de campo diferentes (`influence_score` em vez de `isv`, etc.). Antes de mandar pro provider, normalize pra estrutura exata do `TweetInput`. Se os nomes batem, ótimo. Se não, faça um `.map` curto pra renomear.

---

## UI de settings: o que adicionar

A tela de configurações precisa de campos novos. Se a v1 já tem tela de settings, adicione:

- Radio button "Provider de LLM": `Gemini 2.5 Flash (gratuito)` (default) vs `Claude Sonnet 4.6 (pago)`
- Campo de texto "Chave Gemini API" (com link "obter em https://aistudio.google.com/apikey")
- Campo de texto "Chave Anthropic API" (com link "obter em https://console.anthropic.com")

Os dois campos de chave ficam visíveis sempre. Usuário pode preencher um ou os dois. A factory escolhe qual usar baseado no radio.

Se a v1 não tem tela de settings ainda, crie uma mínima. Não precisa ser bonita: form simples com `<input type="password">` (pra disfarçar a chave) e botão salvar.

**Storage keys a adicionar em `chrome.storage.local`:**

- `llm_provider`: `"gemini"` (default) | `"anthropic"`
- `gemini_api_key`: string
- `anthropic_api_key`: string

Mantenha as chaves existentes que já estão no storage.

---

## Como obter a chave Gemini (escreva isso na UI)

1. Acessar `https://aistudio.google.com/apikey`
2. Login com conta Google
3. Clicar em "Create API key"
4. Copiar e colar no campo da extensão
5. Sem cartão de crédito, sem cobrança

Limites do free tier (suficientes pro POC): 1500 req/dia, 15 RPM, 1M tokens/min.

---

## Critérios de aceite

Trabalho concluído quando:

- [ ] `providers/types.ts`, `providers/gemini.ts`, `providers/anthropic.ts`, `providers/index.ts` e `schema/replai-response.ts` existem (caminhos podem variar)
- [ ] System prompt embarcado bate com a versão atual do SKILL.md (contrato JSON, idioma replica original, categorias snake_case)
- [ ] UI de settings tem campos de chave Gemini, chave Anthropic, e seletor de provider
- [ ] Flow integrado: ao apertar "atualizar", tweets enriquecidos chegam no provider ativo e voltam como JSON estruturado
- [ ] Cada card da UI mostra: handle + métricas (ISV, layer, POI) + texto do tweet + 2-3 replies com categoria visível
- [ ] Contador na UI mostra "N coletados, M passaram, K descartados" (do `result.summary`)
- [ ] Teste manual com 5+ tweets reais da Lista do X retorna replies coerentes em <30s
- [ ] Trocar o radio de "Gemini" pra "Anthropic" na UI faz a próxima chamada usar o outro provider, sem reload
- [ ] Erros HTTP (401, 429, 5xx) aparecem na UI com mensagem clara, sem crash

---

## O que NÃO fazer

- **Não refatore o que já funciona.** TwitterAPI, lookup no node_metrics, parsing de tweets — tudo isso fica como está.
- **Não introduza bibliotecas pesadas.** Não precisa de SDK do Anthropic, nem do `@google/generative-ai`. Fetch direto resolve.
- **Não use computer use, MCP ou Files API.** A chamada é REST direto.
- **Não implemente streaming.** Pra batch de 20 tweets, resposta única em <30s é suficiente.
- **Não esconda erros.** Erros HTTP devem ser visíveis pro usuário (pelo menos via console + alerta básico na UI).
- **Não invente campos do payload.** Use exatamente os nomes que estão em `TweetInput`. Se a v1 tem nomes diferentes nos tweets enriquecidos, faça `.map` no ponto de integração.
- **Não habilite background polling automático.** Polling é manual no POC, via botão "atualizar".

---

## Teste manual sugerido

Depois de implementar, valide assim:

1. Configurar chave Gemini na UI
2. Selecionar "Gemini" como provider
3. Apertar "atualizar"
4. Verificar no console que `provider.name === "gemini"` no momento da chamada
5. Inspecionar a response: deve ter `results[]` e `summary{}` no formato do schema
6. Olhar as replies geradas: ver se a voz não tem travessões, não usa "vale notar", não cai em paralelismo negativo. Se cair muito, vale subir o `temperature` pra 0.9 ou comparar com Anthropic depois.

Se tudo passar, configurar a chave Anthropic, trocar o radio, apertar atualizar de novo, e confirmar que agora usa Anthropic. Comparar a qualidade das replies entre os dois providers em ~10 tweets.

---

## Dúvidas que podem aparecer

**P: O system prompt embarcado tem ~10k tokens. Não vai estourar contexto?**
R: Gemini 2.5 Flash tem 1M de contexto. Anthropic Sonnet 4.6 tem 200k. Folga gigante.

**P: Como evitar que o Gemini gaste tokens com "thinking"?**
R: Adicionar `thinkingConfig: { thinkingBudget: 0 }` no `generationConfig`. Default vem com thinking on. Pra POC vale deixar on (melhora qualidade); pra economia, desligar.

**P: O free tier do Gemini permite uso comercial?**
R: Sim, mas com a ressalva de que Google pode usar inputs/outputs pra treinar modelos. Pro POC interno com tweets públicos, ok. Pra produção com dados sensíveis, migrar pro Anthropic ou tier pago do Gemini.

**P: O que fazer se o Gemini retornar erro 429 (rate limit)?**
R: Esperar 1 minuto e retentar. Pro POC manual, isso raramente acontece. Se acontecer, mostrar mensagem amigável "rate limit excedido, tente novamente em instantes".

**P: Posso usar `gemini-2.5-pro` em vez de Flash?**
R: Pode, mas o free tier do Pro tem apenas 50 req/dia. Pra uma sessão de teste tudo bem; pra uso contínuo, fica Flash.

---

## Resumo do que muda

| Antes | Depois |
|---|---|
| Tweets enriquecidos não viram replies | Tweets enriquecidos passam pelo provider e voltam como `SkillResponse` |
| Sem config de LLM | Settings com escolha entre Gemini (default) e Anthropic |
| Sem chamada de API de modelo | Fetch direto pro endpoint do provider ativo, com JSON schema enforcement no Gemini |
| (sem mudança no resto) | (sem mudança no resto) |
