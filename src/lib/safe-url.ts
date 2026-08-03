// V4.1.14 (CR-05): safeOpenUrl — helper compartilhado pra chrome.tabs.create.
// Antes, varios call sites faziam chrome.tabs.create({ url }) com URL vinda
// de TwitterAPI ou LLM output sem validacao. Se um upstream comprometido
// devolvesse `javascript:` ou `data:`, Chrome MV3 ja recusa, mas o ID/intent
// URL com query params poderia carregar payload malicioso pra o composer do X.
//
// Politica: so http(s), so hosts da allowlist.

const ALLOWED_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  // V5.0.3: canal LinkedIn
  "linkedin.com",
  "www.linkedin.com",
  "mobile.linkedin.com",
]);

export interface OpenUrlOptions {
  /** Se true, abre na aba ativa em vez de nova. Default false (nova aba). */
  active?: boolean;
}

/**
 * Abre uma URL no browser via chrome.tabs.create com validacao de scheme + host.
 * Retorna true se a URL passou na validacao e foi aberta; false se foi rejeitada.
 *
 * Hosts permitidos: x.com (e variantes), twitter.com (e variantes).
 * Schemes permitidos: https (preferido) ou http.
 */
export function safeOpenUrl(url: string, options?: OpenUrlOptions): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.warn("[safe-url] URL invalida, rejeitada:", url.slice(0, 100));
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    console.warn(
      "[safe-url] scheme nao permitido, rejeitado:",
      parsed.protocol
    );
    return false;
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    console.warn(
      "[safe-url] host fora da allowlist, rejeitado:",
      parsed.hostname
    );
    return false;
  }
  chrome.tabs.create({ url: parsed.toString(), active: options?.active });
  return true;
}
