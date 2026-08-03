// V4.1.7 — Cliente do Watchtower via Edge Function proxy.
//
// O TOKEN NOTION NAO VIVE MAIS NO CLIENT. Ele esta em Supabase secrets,
// acessivel so server-side pela Edge Function `notion-watchtower`. Cliente
// (extensao) chama a function autenticada via Supabase JWT — function valida,
// busca no Notion server-side, devolve so o conteudo parseado.
//
// Beneficios vs V4.1.5/6:
//   - Token Notion nunca aparece no JS bundle, .crx, ou inspecao CWS
//   - Rotacao trivial: `supabase secrets set NOTION_API_TOKEN=novo` (sem
//     rebuild + redistribute da extension)
//   - host_permission api.notion.com removido do manifest (zero permission
//     extra pro reviewer questionar)
//
// Deploy da function: ver supabase/functions/notion-watchtower/index.ts
// no header (instrucoes completas).

import { supabase } from "./supabase";

export class NotionError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "NotionError";
  }
}

export interface WatchtowerDigest {
  pageId: string;
  title: string;
  matched_by: "date" | "fallback_most_recent";
  text: string;
  // V4.1.8: conteudo da subpagina "Viral Posts" dentro do Watchtower do dia
  // (best-effort — undefined se nao houver).
  viralText?: string;
  fetched_at: string;
}

// Chama o proxy Edge Function. Auth via Supabase JWT (handle automatico
// pelo supabase-js client.functions.invoke).
//
// V4.1.14 (CR-02): pageId NAO mais aceito do client — sempre vem do secret
// `WATCHTOWER_PAGE_ID` no Supabase. Antes era brecha de confused-deputy:
// qualquer @moicdigital user podia passar pageId arbitrario e ler conteudo
// de outras paginas que a integration tem acesso (RH, financials, etc).
//
// `date` opcional: YYYY-MM-DD pra pegar Watchtower de dia especifico.
export async function fetchTodayWatchtower(
  _parentPageIdLegacy?: string,
  date?: string
): Promise<WatchtowerDigest | null> {
  try {
    const body: Record<string, string> = {};
    if (date) body.date = date;
    const { data, error } = await supabase.functions.invoke(
      "notion-watchtower",
      { body }
    );
    if (error) {
      const detail =
        (error as { context?: { responseText?: string } }).context
          ?.responseText ?? error.message;
      console.warn("[notion] proxy error:", detail);
      throw new NotionError(`watchtower proxy: ${detail}`);
    }
    if (!data || typeof data !== "object") return null;
    const d = data as Partial<WatchtowerDigest> & { error?: string };
    if (d.error) {
      throw new NotionError(d.error);
    }
    if (!d.text || !d.pageId) return null;
    return {
      pageId: d.pageId,
      title: d.title ?? "(sem titulo)",
      matched_by: d.matched_by ?? "fallback_most_recent",
      text: d.text,
      viralText: d.viralText,
      fetched_at: d.fetched_at ?? new Date().toISOString(),
    };
  } catch (e) {
    if (e instanceof NotionError) throw e;
    throw new NotionError(`falha ao chamar proxy: ${(e as Error).message}`);
  }
}

// Helper opcional pra UI exibir/normalizar IDs colados pelo usuario.
// (Usado em Settings antigos; mantido pra compat — page ID e validado
// no server side de qualquer jeito).
export function extractNotionPageId(input: string): string {
  const trimmed = input.trim();
  const m = trimmed.match(/([a-f0-9]{32})/i);
  if (m) return m[1].toLowerCase();
  const m2 = trimmed.match(/([a-f0-9-]{36})/i);
  if (m2) return m2[1].replace(/-/g, "").toLowerCase();
  return trimmed.toLowerCase();
}
