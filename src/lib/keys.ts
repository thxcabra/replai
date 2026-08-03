// Chaves lidas de variaveis de ambiente Vite (.env, fora do git).
// AVISO: VITE_* sao embutidas no bundle em build time, entao continuam
// extraiveis via DevTools no dist/. O .env mantem o segredo fora do controle de
// versao, nao o esconde do cliente. Pra producao: mover pra um backend proxy.
//
// As chaves de LLM aqui sao apenas FALLBACK: se o usuario preencher a chave na
// tela de configuracoes (chrome.storage.local), aquela tem prioridade (ver llm.ts).

export const TWITTERAPI_KEY = import.meta.env.VITE_TWITTERAPI_KEY ?? "";
export const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY ?? "";
export const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY ?? "";

// V4.1.7: Notion token + Watchtower page ID MIGRADOS pro Supabase secrets.
// Token nunca mais aparece no client; Edge Function `notion-watchtower` faz
// o proxy autenticado. Pra atualizar:
//   supabase secrets set NOTION_API_TOKEN=ntn_xxx
//   supabase secrets set WATCHTOWER_PAGE_ID=<32-hex>
// (sem rebuild da extension)
//
// V4.1.6: Unsplash removida. Image gen agora usa Gemini API (mesma chave
// acima) via endpoint :generateContent com responseModalities=IMAGE.
