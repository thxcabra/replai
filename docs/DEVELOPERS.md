# Developers — Replai

Notas pra quem contribui codigo. Hoje cobre LLM providers (como adicionar novo). Outras notas tecnicas vivem em [ARCHITECTURE.md](./ARCHITECTURE.md) (diagrama + critical files + schema das tabelas) e [ADMIN.md](./ADMIN.md) (queries pra explorar dados).

## LLM Providers

Como Gemini e Anthropic se integram. Padrao pra adicionar novo provider.

## Estrutura atual

```
src/lib/
├── llm.ts          # dispatch (provider switch)
├── gemini.ts       # callGemini → fetch Google AI
├── anthropic.ts    # callAnthropic → fetch Anthropic
├── skill-prompt.ts # buildSystemPrompt(voice) — gera o prompt unificado
└── parse-skill.ts  # parseSkillOutput(text) — parseia JSON do LLM
```

## Fluxo

[`src/lib/orchestrator.ts`](../src/lib/orchestrator.ts) → `generateReplies(payload, config)` (em [`llm.ts`](../src/lib/llm.ts)):

1. **buildSystemPrompt(voice)** monta o prompt = [`SKILL.md`](../src/assets/SKILL.md) (anti-tropes genericos) + voz do workspace + lembrete de precedencia
2. **Switch por `config.llm_provider`**:
   - `"gemini"` → `callGemini(payload, key, systemPrompt)`
   - `"anthropic"` → `callAnthropic(payload, key, model, systemPrompt)`
3. Cada provider devolve `{ output: SkillOutput, usage: { input_tokens, output_tokens } }`
4. orchestrator pega `output.results` (array de SkillResult) + usa `usage` pra registrar custo em `session_logs`

## Contrato de output

Ambos providers retornam o mesmo formato (definido em [`replai-schema.ts`](../src/lib/replai-schema.ts)):

```ts
interface SkillOutput {
  results: Array<{
    tweet_id: string;
    handle: string;
    isv: number;
    inferred_layer: number;
    is_poi: number;
    pattern: number;          // 0 = dry-run, 1+ = real skill pattern
    pattern_label: string;
    replies: Array<{
      text: string;            // max ~280 chars
      category: ValueCategory; // dado_concreto | experiencia_builder | etc
    }>;
    not_in_graph?: boolean;
  }>;
  summary: { received: number; passed: number; discarded: number };
}
```

## Diferencas Gemini vs Anthropic

| Tema | Gemini 2.5 Flash | Anthropic Claude |
|---|---|---|
| Custo | $0.075 / $0.3 per 1M tokens | $3 / $15 (Sonnet) |
| Structured output | nativo (`responseSchema`) | precisa `responseMimeType` + prefill `{` |
| System prompt | `system_instruction.parts[]` | `system[]` array com cache_control |
| Prompt caching | nao tem | tem (ephemeral, no SKILL.md base) |
| Free tier | ~1500 req/dia | nenhum |
| Default no V4 | **sim** | upgrade opcional |

## Adicionar provider novo (ex: OpenAI)

1. **Cria arquivo** `src/lib/openai.ts` com mesma signature de gemini.ts/anthropic.ts:

```ts
import { ApiError } from "./errors";
import { parseSkillOutput } from "./parse-skill";
import type { SkillOutput, SkillPayload } from "./types";

export interface LLMCallResult {
  output: SkillOutput;
  usage: { input_tokens: number | null; output_tokens: number | null };
}

export async function callOpenAI(
  payload: SkillPayload,
  apiKey: string,
  model: string,
  systemPrompt: string
): Promise<LLMCallResult> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(payload) },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) {
    throw new ApiError("openai", `OpenAI returned ${response.status}`, response.status);
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  return {
    output: parseSkillOutput(text),
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? null,
      output_tokens: data.usage?.completion_tokens ?? null,
    },
  };
}
```

2. **Atualiza `ProviderName`** em [`src/lib/types.ts`](../src/lib/types.ts):

```ts
export type ProviderName = "gemini" | "anthropic" | "openai";
```

3. **Adiciona switch case em `llm.ts`**:

```ts
if (config.llm_provider === "openai") {
  const key = config.openai_api_key.trim() || OPENAI_API_KEY;
  if (!key) throw new ApiError("openai", "Configure a chave do OpenAI...");
  return callOpenAI(payload, key, config.model, systemPrompt);
}
```

4. **Adiciona ao Config + DEFAULT_CONFIG**:
   - `openai_api_key: string` em [`src/lib/types.ts`](../src/lib/types.ts)
   - Default = `""`

5. **Adiciona ao profile** em [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql):
   - `alter table profiles add column openai_api_key text;`

6. **Atualiza UI Settings** ([`src/sidepanel/components/Settings.tsx`](../src/sidepanel/components/Settings.tsx)):
   - Adiciona campo no bloco "chaves de API"
   - Adiciona OpenAI em `PROVIDER_OPTIONS`

7. **Atualiza pricing em** [`src/lib/cost-calc.ts`](../src/lib/cost-calc.ts):

```ts
const PRICING: Record<string, ModelPricing> = {
  // ...existing...
  "gpt-4o": { input_per_1m: 2.5, output_per_1m: 10 },
  "gpt-4o-mini": { input_per_1m: 0.15, output_per_1m: 0.6 },
};
```

## Pricing — manter atualizado

[`cost-calc.ts`](../src/lib/cost-calc.ts) tem precos hardcoded. **Update quando o vendor mexer**:
- Anthropic: https://www.anthropic.com/pricing
- Google AI: https://ai.google.dev/pricing
- OpenAI: https://openai.com/api/pricing

Costuma mexer ~1x ao ano. Sem alarm — review trimestral.

## Onde a voz entra

O `systemPrompt` passado pra todos providers = SKILL.md + voz do workspace + lembrete final. Construido em [`skill-prompt.ts`](../src/lib/skill-prompt.ts) → `buildSystemPrompt(voice)`.

A voz do workspace vem de `workspace.config.voice` que e:
- Sincronizada via Supabase (`workspaces.config` jsonb)
- Versionada em `voice_versions` table (ver [ADMIN.md](./ADMIN.md#voice-versions--ab-test))
- Editavel em Settings (textarea ou upload .md/.pdf/.txt)

Sem voz, o prompt fica generico (so SKILL.md base) — replies tendem a sair genericas. Por isso a UI tem badge "sem voz" no Header se nao configurada.
