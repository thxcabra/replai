// JSON schema da resposta da skill, usado pelo Gemini (responseSchema) pra
// forcar a estrutura de saida. Ajustado pro subset de OpenAPI que o Gemini
// aceita: usa `nullable: true` em vez de `type: [..., "null"]`, e nao usa
// `enum` de inteiro (so de string), que o Gemini nao suporta de forma confiavel.
export const REPLAI_RESPONSE_SCHEMA = {
  type: "object",
  required: ["results", "summary"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        required: [
          "tweet_id",
          "handle",
          "isv",
          "inferred_layer",
          "is_poi",
          "pattern",
          "pattern_label",
          "replies",
        ],
        properties: {
          tweet_id: { type: "string" },
          handle: { type: "string" },
          isv: { type: "number" },
          inferred_layer: { type: "integer", nullable: true },
          is_poi: { type: "integer" },
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
                text: { type: "string" },
                category: {
                  type: "string",
                  enum: [
                    "dado_concreto",
                    "referencia_nominal",
                    "experiencia_builder",
                    "pergunta_especialista",
                    "info_pratica",
                    "nomear_fenomeno",
                    "caso_concreto",
                    "cross_pollination",
                    "update_info",
                  ],
                },
              },
            },
          },
        },
      },
    },
    summary: {
      type: "object",
      required: ["received", "passed", "discarded"],
      properties: {
        received: { type: "integer" },
        passed: { type: "integer" },
        discarded: { type: "integer" },
      },
    },
  },
} as const;
