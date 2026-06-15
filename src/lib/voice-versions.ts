import { getSession } from "./auth";
import { isSupabaseConfigured, supabase } from "./supabase";

// Versionamento da voz por workspace. Cada save dispara saveVoiceVersion que:
//   - calcula hash sha256 do texto (Web Crypto, nao md5 - mais robusto)
//   - upsert na tabela voice_versions (unique por workspace_id + hash)
//   - retorna o id pra anexar em reply_logs.voice_version_id
//
// Resultado: historico imutavel da voz, dedup automatico, A/B testavel.

async function hashText(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface VoiceVersionRef {
  id: string;
  version: number;
}

// Idempotente: se a voz nao mudou (hash igual), retorna o id existente.
// Se mudou, calcula proxima versao (max+1) e insere.
// Retorna null se Supabase nao configurado, nao logado, ou voz vazia.
export async function saveVoiceVersion(
  workspaceId: string,
  voiceText: string,
  voiceSource: string
): Promise<VoiceVersionRef | null> {
  if (!isSupabaseConfigured()) return null;
  const trimmed = (voiceText ?? "").trim();
  if (!trimmed) return null;
  const session = await getSession();
  if (!session?.user) return null;

  const hash = await hashText(trimmed);

  // Tenta achar versao existente com mesmo hash neste workspace
  const { data: existing, error: selErr } = await supabase
    .from("voice_versions")
    .select("id, version")
    .eq("workspace_id", workspaceId)
    .eq("voice_hash", hash)
    .maybeSingle();
  if (selErr) {
    console.warn("[voice-versions] select falhou:", selErr);
    return null;
  }
  if (existing) {
    return { id: existing.id as string, version: existing.version as number };
  }

  // Calcula proxima versao (max + 1) — race condition possivel mas baixa probabilidade
  const { data: latest } = await supabase
    .from("voice_versions")
    .select("version")
    .eq("workspace_id", workspaceId)
    .order("version", { ascending: false })
    .limit(1);
  const nextVersion = ((latest?.[0]?.version as number) ?? 0) + 1;

  const { data: inserted, error: insErr } = await supabase
    .from("voice_versions")
    .insert({
      workspace_id: workspaceId,
      user_id: session.user.id,
      voice_text: trimmed,
      voice_source: voiceSource || "paste",
      voice_hash: hash,
      version: nextVersion,
    })
    .select("id, version")
    .single();
  if (insErr) {
    // se foi race (unique violation), refaz o select
    if (insErr.code === "23505") {
      const retry = await supabase
        .from("voice_versions")
        .select("id, version")
        .eq("workspace_id", workspaceId)
        .eq("voice_hash", hash)
        .single();
      if (retry.data) {
        return {
          id: retry.data.id as string,
          version: retry.data.version as number,
        };
      }
    }
    console.warn("[voice-versions] insert falhou:", insErr);
    return null;
  }
  return {
    id: inserted.id as string,
    version: inserted.version as number,
  };
}

// Lookup por hash (usado quando reply_log e disparado e precisa
// do voice_version_id atual sem re-inserir).
export async function getVoiceVersionIdByText(
  workspaceId: string,
  voiceText: string
): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const trimmed = (voiceText ?? "").trim();
  if (!trimmed) return null;
  const session = await getSession();
  if (!session?.user) return null;

  const hash = await hashText(trimmed);
  const { data } = await supabase
    .from("voice_versions")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("voice_hash", hash)
    .maybeSingle();
  return (data?.id as string) ?? null;
}
