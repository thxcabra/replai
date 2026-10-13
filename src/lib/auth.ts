import type { Session, User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "./supabase";
import { isEmailDomainAllowed } from "./util";

// API de auth do Replai V4. Roda 100% no side panel UI (extension page tem
// acesso a chrome.identity sem precisar de offscreen document). O background
// service worker so consome a sessao ja persistida em chrome.storage via o
// chromeStorageAdapter.
//
// Padrao OAuth (Google via Supabase):
//   1. chama supabase.auth.signInWithOAuth com skipBrowserRedirect: true
//      pra Supabase gerar a URL de auth (PKCE flow) sem redirecionar
//   2. abre essa URL em chrome.identity.launchWebAuthFlow (popup gerenciado
//      pelo Chrome com redirect URI chromiumapp.org)
//   3. Google autentica, Supabase callback dispara, o popup volta com ?code=...
//   4. supabase.auth.exchangeCodeForSession troca o code por session
//   5. session fica salva em chrome.storage.local via adapter

export class AuthNotConfiguredError extends Error {
  constructor() {
    super("Supabase nao esta configurado (VITE_SUPABASE_URL/ANON_KEY ausentes).");
    this.name = "AuthNotConfiguredError";
  }
}

export class AuthCancelledError extends Error {
  constructor() {
    super("Login cancelado pelo usuario.");
    this.name = "AuthCancelledError";
  }
}

export class DomainNotAllowedError extends Error {
  constructor(email: string) {
    super(
      `Acesso restrito ao dominio @${ALLOWED_EMAIL_DOMAIN}. Email "${email}" nao tem permissao.`
    );
    this.name = "DomainNotAllowedError";
  }
}

// Dominio permitido no login (VITE_ALLOWED_EMAIL_DOMAIN). O default mantem o
// deploy original. Regra em isEmailDomainAllowed (util.ts).
export const ALLOWED_EMAIL_DOMAIN =
  import.meta.env.VITE_ALLOWED_EMAIL_DOMAIN?.trim() || "moicdigital";

// Inicia o flow OAuth com Google. Resolve com a session quando completa.
export async function signIn(): Promise<Session> {
  if (!isSupabaseConfigured()) throw new AuthNotConfiguredError();

  const redirectTo = chrome.identity.getRedirectURL();

  // 1. pede pro Supabase a URL de auth (sem redirecionar)
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  if (!data?.url) throw new Error("Supabase nao devolveu URL de auth.");

  // 2. abre o popup gerenciado pelo Chrome
  console.log("[auth] launching OAuth popup, URL:", data.url);
  console.log("[auth] expected redirect URL:", redirectTo);
  let responseUrl: string | undefined;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({
      url: data.url,
      interactive: true,
    });
  } catch (e) {
    // launchWebAuthFlow lanca em: user closed, OAuth error (redirect URL
    // mismatch, scope denied, etc), timeout, popup blocked. Diferenciamos
    // user-close de outros erros.
    const msg = (e as Error).message ?? String(e);
    console.error("[auth] launchWebAuthFlow rejected:", msg);
    if (
      msg.toLowerCase().includes("user did not approve") ||
      msg.toLowerCase().includes("user closed") ||
      msg.toLowerCase().includes("cancel")
    ) {
      throw new AuthCancelledError();
    }
    throw new Error(`OAuth flow falhou: ${msg}`);
  }
  console.log("[auth] OAuth flow returned URL:", responseUrl);
  if (!responseUrl) throw new AuthCancelledError();

  // 3. extrai o code do redirect final
  const url = new URL(responseUrl);
  const code = url.searchParams.get("code");
  if (!code) {
    const err = url.searchParams.get("error_description") ?? "sem code no callback";
    throw new Error(`OAuth callback invalido: ${err}`);
  }

  // 4. troca code por session (popula storage)
  const { data: exchangeData, error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw exchangeError;
  if (!exchangeData.session) throw new Error("Sem session apos exchange.");

  // 5. valida dominio. Defesa em profundidade: o trigger handle_new_user
  // no Supabase tambem rejeita, mas se por algum motivo a sessao tiver sido
  // criada antes (race ou trigger desligado), aqui pegamos.
  const email = exchangeData.session.user.email ?? "";
  if (!isEmailDomainAllowed(email, ALLOWED_EMAIL_DOMAIN)) {
    // limpa a sessao antes de jogar o erro pra UI
    await supabase.auth.signOut().catch(() => {});
    throw new DomainNotAllowedError(email);
  }

  return exchangeData.session;
}

export async function signOut(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  // V4.1.14 (IN-06): drena fila + reseta queue+timer antes de matar a sessao.
  try {
    const { flushNow, resetMetrics } = await import("./metrics");
    await flushNow();
    resetMetrics();
  } catch {
    /* nao bloqueia signOut */
  }
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  if (!isSupabaseConfigured()) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getUser(): Promise<User | null> {
  if (!isSupabaseConfigured()) return null;
  const { data } = await supabase.auth.getUser();
  return data.user;
}

// Callback recebe (session | null). Retorna funcao pra desinscrever.
export function onAuthChange(
  cb: (session: Session | null) => void
): () => void {
  if (!isSupabaseConfigured()) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session);
  });
  return () => data.subscription.unsubscribe();
}
