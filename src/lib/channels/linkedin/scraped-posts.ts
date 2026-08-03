// V5.1 — Cache persistente dos posts LinkedIn scraped.
//
// Store principal do pipeline LinkedIn. APIFY so entra quando user pede
// "atualizar" — o resto do tempo, triagem le direto do store.
//
// Fluxo:
//   1. Boot LinkedInView: query store → mostra items ja armazenados (sem $)
//   2. User clica atualizar: APIFY → upsert delta → query store → refresh UI
//   3. Post fora da janela (>1 semana): filtrado no query (nao volta na UI)
//   4. Post ja respondido: query ordena por ultimo, UI mostra com cor diferente

import { supabase } from "../../supabase";
import { getSession } from "../../auth";
import type { GroundswellBridge, PoiCandidate, RawPost } from "../types";

/**
 * Upsert de posts scraped no store persistente.
 * Idempotente por (workspace_id, post_urn) — refresh do mesmo post atualiza
 * last_seen_at + engagement, mantem post_created_at original.
 *
 * V5.1: recebe items com bridge JA resolvido pra que `bridge_id` armazenado
 * seja o `groundswell_bridges.bridge_id` do bundle (nao a URL do perfil).
 * Assim query subsequente consegue JOIN natural.
 */
export interface ScrapedPostInput {
  post: RawPost;
  bridgeId: string;
}
export async function upsertScrapedPosts(
  workspaceId: string,
  bundleId: string,
  inputs: ScrapedPostInput[]
): Promise<void> {
  if (inputs.length === 0) return;
  const session = await getSession();
  if (!session?.user) return;

  const rows = inputs.map(({ post: p, bridgeId }) => ({
    workspace_id: workspaceId,
    bundle_id: bundleId,
    post_urn: p.post_ref,
    post_url: p.url,
    bridge_id: bridgeId,
    author_handle: p.author_handle,
    author_display_name: p.author_display_name,
    author_headline: p.author_headline ?? null,
    post_text: p.text,
    post_lang: p.lang ?? null,
    post_type: p.post_type ?? "unknown",
    post_created_at: p.created_at ?? null,
    reactions_count: p.engagement.reactions ?? null,
    comments_count: p.engagement.comments ?? null,
    reshares_count: p.engagement.reshares ?? null,
    raw_data: p.raw_meta ?? {},
    last_seen_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("linkedin_scraped_posts")
    .upsert(rows, {
      onConflict: "workspace_id,post_urn",
      ignoreDuplicates: false,
    });
  if (error) {
    console.warn("[scraped-posts] upsert falhou:", error.message);
  }
}

/**
 * Query do store — retorna posts armazenados dentro da janela `sinceMs`
 * pra este workspace+bundle. Reconstroi RawPost do denormalized.
 * Rapido, $0 (nao chama APIFY).
 */
export interface StoredPost {
  post: RawPost;
  bridgeId: string;
}
export async function getStoredPosts(
  workspaceId: string,
  bundleId: string,
  sinceMs: number
): Promise<StoredPost[]> {
  const sinceIso = new Date(sinceMs).toISOString();
  const { data, error } = await supabase
    .from("linkedin_scraped_posts")
    .select(
      "post_urn, post_url, bridge_id, author_handle, author_display_name, author_headline, post_text, post_lang, post_type, post_created_at, reactions_count, comments_count, reshares_count, raw_data"
    )
    .eq("workspace_id", workspaceId)
    .eq("bundle_id", bundleId)
    .gte("post_created_at", sinceIso)
    .order("post_created_at", { ascending: false });
  if (error) {
    console.warn("[scraped-posts] getStoredPosts falhou:", error.message);
    return [];
  }
  return (data ?? []).map((r) => {
    const row = r as {
      post_urn: string;
      post_url: string | null;
      bridge_id: string;
      author_handle: string | null;
      author_display_name: string | null;
      author_headline: string | null;
      post_text: string | null;
      post_lang: string | null;
      post_type: string | null;
      post_created_at: string | null;
      reactions_count: number | null;
      comments_count: number | null;
      reshares_count: number | null;
      raw_data: Record<string, unknown> | null;
    };
    return {
      bridgeId: row.bridge_id,
      post: {
        channel: "linkedin",
        post_ref: row.post_urn,
        author_handle: row.author_handle ?? "",
        author_display_name: row.author_display_name ?? "",
        author_headline: row.author_headline ?? undefined,
        text: row.post_text ?? "",
        lang: row.post_lang ?? undefined,
        created_at: row.post_created_at ?? new Date().toISOString(),
        url: row.post_url ?? "",
        media: [],
        engagement: {
          reactions: row.reactions_count ?? undefined,
          comments: row.comments_count ?? undefined,
          reshares: row.reshares_count ?? undefined,
        },
        post_type: (row.post_type as RawPost["post_type"]) ?? "unknown",
        raw_meta: row.raw_data ?? undefined,
      },
    };
  });
}

/**
 * Retorna os post_urns que ja tem reply persistida em linkedin_replies pra
 * este workspace. Usado pra ordenar/marcar cards como "respondido".
 */
export async function getRepliedPostUrns(
  workspaceId: string
): Promise<Set<string>> {
  try {
    const { data, error } = await supabase
      .from("linkedin_replies")
      .select("post_urn")
      .eq("workspace_id", workspaceId);
    if (error) return new Set();
    const urns = new Set<string>();
    for (const r of data ?? []) {
      const u = (r as { post_urn: string }).post_urn;
      if (u) urns.add(u);
    }
    return urns;
  } catch {
    return new Set();
  }
}

// Reexport pra uso no orchestrator
export type { GroundswellBridge, PoiCandidate };
