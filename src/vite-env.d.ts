/// <reference types="vite/client" />

interface ImportMetaEnv {
  // base da TwitterAPI; no preview aponta pro proxy do Vite (evita CORS).
  readonly VITE_TWITTERAPI_BASE?: string;
  // chaves de API (.env, fora do git). Ver keys.ts.
  readonly VITE_TWITTERAPI_KEY?: string;
  readonly VITE_GEMINI_API_KEY?: string;
  readonly VITE_ANTHROPIC_API_KEY?: string;
  // Supabase (V4): URL do projeto + anon key publica. Setup em env/.env.example.
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
