// V4.1.7 — Edge Function: proxy do Notion API pro Watchtower Daily Digest.
//
// POR QUE EXISTE: pra zerar exposicao do token Notion no client. Antes, o
// token vinha embutido no JS bundle (VITE_NOTION_API_TOKEN) — extraivel
// via DevTools, .crx download, ou inspecao do reviewer CWS. Agora o token
// vive em Supabase secrets, NUNCA toca no client.
//
// FLUXO:
//   1. Client (extensao) chama POST /functions/v1/notion-watchtower
//      com Authorization: Bearer <supabase-jwt>
//   2. Edge Function valida JWT (so usuarios @moicdigital autenticados)
//   3. Edge Function chama Notion API com NOTION_API_TOKEN do secret
//   4. Retorna conteudo parseado pra cliente (sem nunca expor o token)
//
// REQUEST BODY (POST):
//   {
//     pageId?: string,  // se omitido, usa WATCHTOWER_PAGE_ID default
//     date?: string,    // V4.1.8: YYYY-MM-DD pra pegar Watchtower de dia especifico
//                       // (default = hoje, com fallback pro mais recente)
//   }
//
// RESPONSE 200:
//   {
//     pageId: string,
//     title: string,
//     matched_by: "date" | "fallback_most_recent",
//     text: string,
//     viralText?: string,  // V4.1.8: conteudo da subpagina "Viral Posts" se existir
//     fetched_at: string   // ISO
//   }
//
// RESPONSE 401: sem JWT ou JWT invalido
// RESPONSE 403: usuario nao tem dominio @moicdigital
// RESPONSE 502: Notion API falhou (detalhe no body)
//
// DEPLOY:
//   1. `supabase secrets set NOTION_API_TOKEN=ntn_xxx`
//   2. `supabase secrets set WATCHTOWER_PAGE_ID=35f2446e9d68814bb130ce9a1f04947a`
//   3. `supabase functions deploy notion-watchtower --no-verify-jwt`
//      (passamos --no-verify-jwt porque validamos manualmente, com checagem
//       extra de dominio @moicdigital. Sem isso, o JWT verify default
//       deixa entrar QUALQUER usuario auth do Supabase.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// V4.1.14 (CR-01): CORS tightened. Antes era `*`, agora so a extension
// publicada (mesmo ID estavel do CWS) consegue chamar. Defesa adicional
// alem do JWT check manual em authenticateRequest().
//
// O id e o que a CWS gerou: lhoachajfmnfabhcmjkibijjcdbmgjll.
// Pra dev local, a unpacked com `key` no manifest tem o mesmo id (V4.1.7+).
//
// Se algum dia um analista usar build sem `key`, o ID muda e a function
// bloqueia — esperado e correto.
const ALLOWED_ORIGIN = "chrome-extension://lhoachajfmnfabhcmjkibijjcdbmgjll";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Vary": "Origin",
};

const NOTION_VERSION = "2022-06-28";

interface NotionRichText {
  plain_text?: string;
  text?: { content?: string };
}

interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  paragraph?: { rich_text?: NotionRichText[] };
  heading_1?: { rich_text?: NotionRichText[] };
  heading_2?: { rich_text?: NotionRichText[] };
  heading_3?: { rich_text?: NotionRichText[] };
  bulleted_list_item?: { rich_text?: NotionRichText[] };
  numbered_list_item?: { rich_text?: NotionRichText[] };
  quote?: { rich_text?: NotionRichText[] };
  code?: { rich_text?: NotionRichText[]; language?: string };
  to_do?: { rich_text?: NotionRichText[]; checked?: boolean };
  callout?: { rich_text?: NotionRichText[] };
  child_page?: { title?: string };
  divider?: Record<string, never>;
  bookmark?: { url?: string };
  embed?: { url?: string };
}

interface NotionListResponse {
  results: NotionBlock[];
  next_cursor: string | null;
  has_more: boolean;
}

// ---- Helpers ----

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

function richTextToString(rt?: NotionRichText[]): string {
  if (!rt || rt.length === 0) return "";
  return rt.map((t) => t.plain_text ?? t.text?.content ?? "").join("").trim();
}

function blocksToText(blocks: NotionBlock[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "paragraph":
        lines.push(richTextToString(b.paragraph?.rich_text));
        break;
      case "heading_1":
        lines.push(`# ${richTextToString(b.heading_1?.rich_text)}`);
        break;
      case "heading_2":
        lines.push(`## ${richTextToString(b.heading_2?.rich_text)}`);
        break;
      case "heading_3":
        lines.push(`### ${richTextToString(b.heading_3?.rich_text)}`);
        break;
      case "bulleted_list_item":
        lines.push(`- ${richTextToString(b.bulleted_list_item?.rich_text)}`);
        break;
      case "numbered_list_item":
        lines.push(`1. ${richTextToString(b.numbered_list_item?.rich_text)}`);
        break;
      case "quote":
        lines.push(`> ${richTextToString(b.quote?.rich_text)}`);
        break;
      case "code":
        lines.push(
          `\`\`\`${b.code?.language ?? ""}\n${richTextToString(b.code?.rich_text)}\n\`\`\``
        );
        break;
      case "to_do":
        lines.push(
          `${b.to_do?.checked ? "[x]" : "[ ]"} ${richTextToString(b.to_do?.rich_text)}`
        );
        break;
      case "callout":
        lines.push(`> ${richTextToString(b.callout?.rich_text)}`);
        break;
      case "divider":
        lines.push("---");
        break;
      case "bookmark":
        if (b.bookmark?.url) lines.push(b.bookmark.url);
        break;
      case "embed":
        if (b.embed?.url) lines.push(b.embed.url);
        break;
      case "child_page":
        if (b.child_page?.title) lines.push(`[pagina] ${b.child_page.title}`);
        break;
    }
  }
  return lines.filter((l) => l.length > 0).join("\n\n");
}

function normalizeId(id: string): string {
  return id.replace(/-/g, "");
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function makeDateCandidates(d: Date): string[] {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const monthsPt = [
    "janeiro", "fevereiro", "marco", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];
  return [
    `${y}-${pad(m)}-${pad(day)}`,
    `${pad(day)}/${pad(m)}/${y}`,
    `${pad(day)}/${pad(m)}`,
    `${day} de ${monthsPt[m - 1]}`,
    `${day} de ${monthsPt[m - 1].slice(0, 3)}`,
  ];
}

async function notionFetch(token: string, path: string): Promise<unknown> {
  const url = `https://api.notion.com/v1${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j.message ? ` ${j.message}` : "";
    } catch {
      /* ignora */
    }
    throw new Error(`Notion API ${res.status}${detail}`);
  }
  return await res.json();
}

async function listBlockChildren(
  token: string,
  blockId: string
): Promise<NotionBlock[]> {
  const all: NotionBlock[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const path = cursor
      ? `/blocks/${normalizeId(blockId)}/children?page_size=100&start_cursor=${cursor}`
      : `/blocks/${normalizeId(blockId)}/children?page_size=100`;
    const data = (await notionFetch(token, path)) as NotionListResponse;
    all.push(...data.results);
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  return all;
}

// ---- Auth helpers ----

async function authenticateRequest(req: Request): Promise<{
  userId: string;
  email: string;
} | { error: string; status: number }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: "missing authorization", status: 401 };
  }
  const jwt = authHeader.slice(7);

  // Cria client com a chave anon + JWT do user pra resolver auth.getUser()
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return { error: "supabase env missing", status: 500 };
  }
  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    return { error: "invalid jwt", status: 401 };
  }
  const email = data.user.email ?? "";
  // Defesa em profundidade: alem do RLS, valida dominio @moicdigital aqui.
  if (!/@moicdigital\./i.test(email)) {
    return { error: "domain not allowed", status: 403 };
  }
  return { userId: data.user.id, email };
}

// ---- Main handler ----

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method not allowed" }, 405);
  }

  // 1. Auth
  const auth = await authenticateRequest(req);
  if ("error" in auth) {
    return jsonResponse({ error: auth.error }, auth.status);
  }

  // 2. Reads secrets
  const notionToken = Deno.env.get("NOTION_API_TOKEN");
  if (!notionToken) {
    return jsonResponse(
      { error: "NOTION_API_TOKEN nao configurado no Supabase secrets" },
      500
    );
  }
  const defaultPageId = Deno.env.get("WATCHTOWER_PAGE_ID") ?? "";

  // 3. Parse body — V4.1.14 (CR-02): so aceita `date` do client. pageId
  // SEMPRE vem do secret (WATCHTOWER_PAGE_ID) — antes o client podia passar
  // qualquer pageId e enumerar conteudo da integration. Confused-deputy fix.
  let body: { date?: string } = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    /* body opcional */
  }
  const parentPageId = defaultPageId.trim();
  if (!parentPageId) {
    return jsonResponse(
      { error: "WATCHTOWER_PAGE_ID nao configurado nos secrets do Supabase" },
      500
    );
  }
  // V4.1.8: data especifica do Watchtower (YYYY-MM-DD). Se invalida ou
  // omitida, usa hoje.
  const requestedDate = body.date?.trim();
  let targetDate = new Date();
  if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    const [y, m, d] = requestedDate.split("-").map((n) => parseInt(n, 10));
    const parsed = new Date(y, m - 1, d);
    if (!isNaN(parsed.getTime())) targetDate = parsed;
  }

  // 4. Busca child_pages da pagina pai
  let parentChildren: NotionBlock[];
  try {
    parentChildren = await listBlockChildren(notionToken, parentPageId);
  } catch (e) {
    return jsonResponse(
      { error: `notion fetch falhou: ${(e as Error).message}` },
      502
    );
  }
  const childPages = parentChildren.filter(
    (b) => b.type === "child_page" && b.child_page?.title
  );
  if (childPages.length === 0) {
    return jsonResponse(
      { error: "pagina parent sem child_pages (nenhum Watchtower diario encontrado)" },
      404
    );
  }

  // 5. Match por data → fallback pra mais recente
  const candidates = makeDateCandidates(targetDate);
  let matched: { block: NotionBlock; matched_by: "date" | "fallback_most_recent" } | null = null;
  for (const cand of candidates) {
    const found = childPages.find((p) =>
      (p.child_page?.title ?? "").toLowerCase().includes(cand)
    );
    if (found) {
      matched = { block: found, matched_by: "date" };
      break;
    }
  }
  if (!matched) {
    matched = { block: childPages[0], matched_by: "fallback_most_recent" };
  }

  // 6. Busca o conteudo da pagina do dia
  let childBlocks: NotionBlock[];
  try {
    childBlocks = await listBlockChildren(notionToken, matched.block.id);
  } catch (e) {
    return jsonResponse(
      { error: `notion fetch (filho) falhou: ${(e as Error).message}` },
      502
    );
  }
  const text = blocksToText(childBlocks);

  // V4.1.8: procura subpagina "Viral Posts" (ou nome similar) dentro do
  // Watchtower do dia. Se existir, busca conteudo recursivamente e anexa
  // como `viralText`. Match e flexivel: "viral", "virais", "trending".
  let viralText: string | undefined;
  const viralSubpage = childBlocks.find((b) => {
    if (b.type !== "child_page") return false;
    const title = (b.child_page?.title ?? "").toLowerCase();
    return (
      title.includes("viral") ||
      title.includes("trending") ||
      title.includes("popular")
    );
  });
  if (viralSubpage) {
    try {
      const viralBlocks = await listBlockChildren(notionToken, viralSubpage.id);
      viralText = blocksToText(viralBlocks);
    } catch (e) {
      console.warn("[notion-watchtower] viral subpage fetch falhou:", e);
    }
  }

  return jsonResponse({
    pageId: matched.block.id,
    title: matched.block.child_page?.title ?? "(sem titulo)",
    matched_by: matched.matched_by,
    text,
    viralText,
    fetched_at: new Date().toISOString(),
  });
});
