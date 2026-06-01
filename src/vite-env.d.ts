/// <reference types="vite/client" />

interface ImportMetaEnv {
  // base da TwitterAPI; no preview aponta pro proxy do Vite (evita CORS).
  readonly VITE_TWITTERAPI_BASE?: string;
  // chaves de API (.env, fora do git). Ver keys.ts.
  readonly VITE_TWITTERAPI_KEY?: string;
  readonly VITE_GEMINI_API_KEY?: string;
  readonly VITE_ANTHROPIC_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
