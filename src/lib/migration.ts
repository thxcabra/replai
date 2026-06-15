import { getSession } from "./auth";
import {
  ANTHROPIC_API_KEY,
  GEMINI_API_KEY,
  TWITTERAPI_KEY,
} from "./keys";
import {
  getProfileCache,
  pullAll,
} from "./storage";
import { isSupabaseConfigured } from "./supabase";
import { pushProfile, pushWorkspace, upsertReplied } from "./sync";
import type { Config, Workspace } from "./types";

// V3 -> V4 one-shot migration.
//
// Quando rodar:
//   - usuario acaba de logar pela primeira vez (profile.setup_complete = false)
//   - existe estado V3 local em chrome.storage.local (workspaces + replied)
//   - cloud ainda nao tem workspaces desse user
//
// Quando NAO rodar:
//   - profile.setup_complete = true (ja migrou em algum device antes)
//   - sem sessao
//   - flag local `v4_migration_done` ja setado nesse device
//
// E idempotente: se rodar 2x num mesmo device, o flag impede; se por algum
// motivo o flag sumir, os upserts (workspace_id, persona name) ja existentes
// fariam update em vez de duplicar (e o setup_complete ja seria true).

const MIGRATION_FLAG_KEY = "v4_migration_done";

interface LegacyWorkspaceMap {
  [id: string]: Workspace;
}

async function readLegacyState(): Promise<{
  workspaces: Workspace[];
  activeId: string | null;
  setupSeen: boolean;
  repliedByWs: Record<string, string[]>;
}> {
  const stored = await chrome.storage.local.get(null);
  const workspaces = Object.values(
    (stored.workspaces as LegacyWorkspaceMap) ?? {}
  );
  const activeId = (stored.active_workspace_id as string | undefined) ?? null;
  const setupSeen = stored.setup_seen === true;

  const repliedByWs: Record<string, string[]> = {};
  for (const ws of workspaces) {
    const ids = stored[`replied_${ws.id}`] as string[] | undefined;
    if (ids?.length) repliedByWs[ws.id] = ids;
  }
  return { workspaces, activeId, setupSeen, repliedByWs };
}

// Escolhe a melhor versao das chaves: primeiro tenta a config do workspace,
// fallback pro .env do build atual. Single-set-of-keys-per-user: pega do
// primeiro workspace que tiver chave nao-vazia.
function pickKeys(workspaces: Workspace[]): {
  twitterapi_key: string;
  gemini_api_key: string;
  anthropic_api_key: string;
} {
  const pick = (
    field: "twitterapi_key" | "gemini_api_key" | "anthropic_api_key",
    fallback: string
  ): string => {
    for (const ws of workspaces) {
      const v = ws.config[field];
      if (v && v.trim()) return v;
    }
    return fallback;
  };
  return {
    twitterapi_key: pick("twitterapi_key", TWITTERAPI_KEY),
    gemini_api_key: pick("gemini_api_key", GEMINI_API_KEY),
    anthropic_api_key: pick("anthropic_api_key", ANTHROPIC_API_KEY),
  };
}

// V3 legacy preserva custom_prompt como nome; mapeamos pra voice na hora de
// subir pra cloud. Read-side equivalente esta no storage.ts (cloudConfigToConfig).
function configToCloudConfig(config: Config) {
  const legacyVoice =
    (config as unknown as { custom_prompt?: string }).custom_prompt ?? "";
  return {
    listId: config.listId,
    llm_provider: config.llm_provider,
    timeWindowHours: config.timeWindowHours,
    includeUnmapped: config.includeUnmapped,
    model: config.model,
    langs: config.langs,
    maxBatch: config.maxBatch,
    dryRun: config.dryRun,
    voice: config.voice || legacyVoice,
    voice_source: config.voice_source || "",
  };
}

export interface MigrationResult {
  ran: boolean;
  reason?: string;
  workspacesMigrated?: number;
  repliedMigrated?: number;
  keysUploaded?: { twitterapi: boolean; gemini: boolean; anthropic: boolean };
}

export async function runMigrationIfNeeded(): Promise<MigrationResult> {
  if (!isSupabaseConfigured()) {
    return { ran: false, reason: "supabase nao configurado" };
  }
  const session = await getSession();
  if (!session) return { ran: false, reason: "sem sessao" };

  const flagCheck = await chrome.storage.local.get(MIGRATION_FLAG_KEY);
  if (flagCheck[MIGRATION_FLAG_KEY] === true) {
    return { ran: false, reason: "flag local ja setado" };
  }

  // Profile no cache deve estar populado pelo pullAll() que roda no
  // onAuthChange (background). Se nao tiver ainda, pulla agora.
  let profile = await getProfileCache();
  if (!profile) {
    await pullAll();
    profile = await getProfileCache();
  }
  if (profile?.setup_complete) {
    // Outro device ja migrou. So marca o flag local pra nao reavaliar a cada
    // sessao - cloud e fonte da verdade dessa conta.
    await chrome.storage.local.set({ [MIGRATION_FLAG_KEY]: true });
    return { ran: false, reason: "outro device ja migrou (setup_complete=true)" };
  }

  const legacy = await readLegacyState();
  if (legacy.workspaces.length === 0) {
    // Conta nova, sem nada local. Tambem marca flag (SetupWizard cuida do
    // onboarding fresh).
    await chrome.storage.local.set({ [MIGRATION_FLAG_KEY]: true });
    return { ran: false, reason: "sem workspaces locais" };
  }

  // ---- Sobe keys + setup_complete pro profile ----
  const keys = pickKeys(legacy.workspaces);
  const profileUpdate: Record<string, unknown> = {
    setup_complete: true,
  };
  if (keys.twitterapi_key) profileUpdate.twitterapi_key = keys.twitterapi_key;
  if (keys.gemini_api_key) profileUpdate.gemini_api_key = keys.gemini_api_key;
  if (keys.anthropic_api_key) profileUpdate.anthropic_api_key = keys.anthropic_api_key;
  if (legacy.activeId) profileUpdate.active_workspace_id = legacy.activeId;
  await pushProfile(profileUpdate);

  // ---- Sobe workspaces ----
  // A voz por workspace (custom_prompt legacy ou voice V4) entra no jsonb.
  for (const ws of legacy.workspaces) {
    await pushWorkspace({
      id: ws.id,
      name: ws.name,
      config: configToCloudConfig(ws.config),
    });
  }

  // ---- Sobe replied ids (batch por workspace) ----
  // Como a migracao roda 1x e os arrays podem ter centenas de items,
  // usamos upserts seriais (mais simples; pra otimizar daria pra agrupar
  // num insert plural depois).
  let repliedMigrated = 0;
  for (const [wsId, ids] of Object.entries(legacy.repliedByWs)) {
    for (const tweetId of ids) {
      await upsertReplied({
        workspace_id: wsId,
        tweet_id: tweetId,
        // metadata rica nao existe na V3 storage - so o id. Fica vazio.
      });
      repliedMigrated++;
    }
  }

  // ---- Marca o flag local + limpa chaves do storage local ----
  // Apos migrar, profile e fonte da verdade. As chaves nos workspaces locais
  // ficam stale e podem ser confusas. O proximo pullAll() vai reconstruir
  // ws.config preenchendo as chaves a partir do profile.
  await chrome.storage.local.set({ [MIGRATION_FLAG_KEY]: true });

  // Pulla imediato pra reconciliar local com cloud.
  await pullAll();

  return {
    ran: true,
    workspacesMigrated: legacy.workspaces.length,
    repliedMigrated,
    keysUploaded: {
      twitterapi: Boolean(keys.twitterapi_key),
      gemini: Boolean(keys.gemini_api_key),
      anthropic: Boolean(keys.anthropic_api_key),
    },
  };
}

// Util pro SetupWizard / debug. Limpa o flag local pra forcar nova tentativa.
export async function resetMigrationFlag(): Promise<void> {
  await chrome.storage.local.remove(MIGRATION_FLAG_KEY);
}
