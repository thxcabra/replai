import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromeStorageAdapter } from "./chrome-storage-adapter";

// URL + anon vem do .env (ver env/.env.example). Em builds sem essas envs
// (ex: dev sem supabase configurado) o cliente eh criado com strings vazias
// e qualquer chamada vai falhar gracefully - a app deve checar
// isSupabaseConfigured() antes de tentar usar.
//
// NOTA sobre tipagem: o cliente nao usa `createClient<Database>` porque os Row
// types literais nao extendem `Record<string, unknown>` em strict mode, o que
// faz o supabase-js v2 resolver Schema pra `never` e quebrar inference. As
// chamadas em sync.ts ja tipam o retorno explicitamente via PostgrestSingleResponse<Row>,
// o que da o mesmo nivel de type-safety sem o atrito da Database global.
const URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export const supabase: SupabaseClient = createClient(
  URL || "https://placeholder.supabase.co",
  ANON_KEY || "placeholder-anon-key",
  {
    auth: {
      storage: chromeStorageAdapter,
      persistSession: true,
      autoRefreshToken: true,
      // extensao nao usa URL pra carregar session (nao tem location.hash);
      // tudo passa pelo storage adapter
      detectSessionInUrl: false,
      // PKCE pra OAuth funcionar com chrome.identity.launchWebAuthFlow
      flowType: "pkce",
    },
  }
);

// Indica se o Supabase ta realmente configurado neste build. App deve checar
// antes de tentar login ou sync, pra cair em fallback local-only se nao tiver.
export function isSupabaseConfigured(): boolean {
  return Boolean(URL && ANON_KEY);
}
