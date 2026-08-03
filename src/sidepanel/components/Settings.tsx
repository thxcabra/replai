import { useEffect, useRef, useState } from "preact/hooks";
import type { ProfileRow } from "../../lib/supabase-types";
import {
  MODEL_OPTIONS,
  PROVIDER_OPTIONS,
  type Config,
  type Graph,
  type GraphMeta,
  type Workspace,
  type WorkspaceMeta,
} from "../../lib/types";
import {
  bundledGraphSize,
  clearUploadedGraph,
  getGraphMeta,
  saveUploadedGraph,
} from "../../lib/graph";
import { CsvFatalError, parseGraphCsv } from "../../lib/csv-parser";
import { SKILL_REPLAI_SYSTEM_PROMPT } from "../../lib/skill-prompt";
import { extractTextFromFile, MAX_VOICE_CHARS } from "../../lib/voice-loader";
import { getActiveBundle } from "../../lib/groundswell/storage";
import type { GroundswellBundleSummary } from "../../lib/channels/types";
import { LinkedInSettings } from "./linkedin/LinkedInSettings";
import { VoiceCreator } from "./VoiceCreator";
// V5.0.4: primitivos shared pra secoes de Settings
import { SettingSection, SettingsModeContext, type SettingsMode } from "./settings/SettingSection";
import { Tabs } from "../ui/Tabs";

interface Props {
  workspace: Workspace;
  workspaces: WorkspaceMeta[];
  profile: ProfileRow | null;
  onSaveConfig: (config: Config) => void | Promise<void>;
  onSaveKeys: (keys: {
    gemini_api_key: string;
    anthropic_api_key: string;
    notion_api_token?: string;
    apify_api_key?: string;
  }) => Promise<void>;
  onCreateWorkspace: (name: string, duplicate: boolean) => Promise<void>;
  onRenameWorkspace: (name: string) => Promise<void>;
  onDeleteWorkspace: () => Promise<void>;
  onExportWorkspace: () => Promise<void>;
  onImportWorkspace: (file: File) => Promise<void>;
  onOpenDashboard: () => void;
  userEmail: string | null;
  onSignOut: () => Promise<void>;
  onClose: (() => void) | null;
  /** V6: abre GlossaryView com termo focado. Wire vem de App.tsx. */
  onOpenGlossary?: (term: string) => void;
  /** V5.2: tab inicial — reflete o canal ativo (X → "x", LinkedIn → "linkedin"). */
  initialTab?: "general" | "x" | "linkedin";
}

// Aceita ID puro ou URL tipo x.com/i/lists/12345 e extrai o ID.
function extractListId(input: string): string {
  const trimmed = input.trim();
  const m = trimmed.match(/lists\/(\d+)/);
  return m ? m[1] : trimmed;
}

export function Settings({
  workspace,
  workspaces,
  profile,
  onSaveConfig,
  onSaveKeys,
  onCreateWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  onExportWorkspace,
  onImportWorkspace,
  onOpenDashboard,
  userEmail,
  onSignOut,
  onClose,
  onOpenGlossary,
  initialTab,
}: Props) {
  const [draft, setDraft] = useState<Config>({ ...workspace.config });
  const [workspaceName, setWorkspaceName] = useState(workspace.name);
  // V5.1: tab ativa em Settings — Geral | X | LinkedIn.
  // V5.2: initialTab vem do canal ativo — clicar "config" no canal X abre
  // ja na tab X; no canal LinkedIn abre na tab LinkedIn. Setup inicial (sem
  // canal contextual) volta pra "general".
  type SettingsTab = "general" | "x" | "linkedin";
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(
    initialTab ?? "general"
  );
  const hideIfNotTab = (t: SettingsTab): string =>
    settingsTab === t ? "" : "hidden";

  // V5.2: modo Simples/Avancado — persistido em chrome.storage.local.
  // Simples esconde blocos SettingSection marcados advanced=true.
  const [settingsMode, setSettingsMode] = useState<SettingsMode>("simple");
  useEffect(() => {
    chrome.storage?.local?.get?.(["replai_settings_mode"], (r) => {
      const v = r?.replai_settings_mode;
      if (v === "advanced" || v === "simple") setSettingsMode(v);
    });
  }, []);
  useEffect(() => {
    chrome.storage?.local?.set?.({ replai_settings_mode: settingsMode });
  }, [settingsMode]);

  // Chaves de API: estado SEPARADO de draft. Source of truth = profile.
  // Quando salva, vai pro profile via onSaveKeys (nao via workspace.config).
  // Garante consistencia: chave aparece igual em TODOS os workspaces.
  const [geminiKeyDraft, setGeminiKeyDraft] = useState(
    profile?.gemini_api_key ?? ""
  );
  const [anthropicKeyDraft, setAnthropicKeyDraft] = useState(
    profile?.anthropic_api_key ?? ""
  );
  // V4.1.1: token Notion (per-profile, igual outras keys)
  const [notionTokenDraft, setNotionTokenDraft] = useState(
    profile?.notion_api_token ?? ""
  );
  // V5.3: APIFY key opcional (override do secret server-side). Vazia = usa
  // secret padrao do time. Preenchida = edge function usa esta.
  const [apifyKeyDraft, setApifyKeyDraft] = useState(
    profile?.apify_api_key ?? ""
  );

  // re-sync keys quando profile chega/atualiza (apos pullAll)
  useEffect(() => {
    setGeminiKeyDraft(profile?.gemini_api_key ?? "");
    setAnthropicKeyDraft(profile?.anthropic_api_key ?? "");
    setNotionTokenDraft(profile?.notion_api_token ?? "");
    setApifyKeyDraft(profile?.apify_api_key ?? "");
  }, [
    profile?.gemini_api_key,
    profile?.anthropic_api_key,
    profile?.notion_api_token,
    profile?.apify_api_key,
  ]);

  // estado do upload de grafo (per-workspace)
  const [graphMeta, setGraphMeta] = useState<GraphMeta | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphInfo, setGraphInfo] = useState<string | null>(null);
  const [graphBusy, setGraphBusy] = useState(false);

  // V5: bundle Groundswell ativo pra este workspace+canal LinkedIn
  const [linkedInBundle, setLinkedInBundle] =
    useState<GroundswellBundleSummary | null>(null);
  const [bundleReloadTick, setBundleReloadTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getActiveBundle(workspace.id, "linkedin")
      .then((b) => {
        if (!cancelled) setLinkedInBundle(b);
      })
      .catch(() => {
        if (!cancelled) setLinkedInBundle(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace.id, bundleReloadTick]);
  // preview do CSV antes de commitar - mostra as 5 primeiras linhas pra
  // confirmar que o parsing pegou o formato certo.
  const [csvPreview, setCsvPreview] = useState<{
    data: Graph;
    fileName: string;
    rowCount: number;
    errors: string[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  // estado dos controles de workspace
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDuplicate, setNewDuplicate] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // V4.1.x: typed-confirmation — analista precisa digitar o nome do workspace
  // pra liberar o botao vermelho. Reset quando abre/fecha o estado.
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");

  // upload de voz (.md/.pdf/.txt) - extrai texto e popula a textarea
  const voiceFileInputRef = useRef<HTMLInputElement>(null);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  // V5.2: Voice Creator (LLM-gerado) — modal overlay compartilhado por X e LinkedIn.
  const [voiceCreatorOpen, setVoiceCreatorOpen] = useState(false);

  async function handleVoiceUpload(file: File) {
    setVoiceError(null);
    setVoiceLoading(true);
    try {
      const text = await extractTextFromFile(file);
      const truncated = text.slice(0, MAX_VOICE_CHARS);
      setDraft((d) => ({
        ...d,
        voice: truncated,
        voice_source: `upload: ${file.name}`,
      }));
      if (text.length > MAX_VOICE_CHARS) {
        setVoiceError(
          `arquivo tinha ${text.length} chars, truncado pra ${MAX_VOICE_CHARS}.`
        );
      }
    } catch (e) {
      setVoiceError(`erro lendo arquivo: ${(e as Error).message ?? e}`);
    } finally {
      setVoiceLoading(false);
    }
  }

  function handleVoiceClear() {
    setVoiceError(null);
    setDraft((d) => ({ ...d, voice: "", voice_source: "" }));
  }

  // V4.1: basePrompt editavel por workspace (cor amber pra diferenciar do
  // bloco violeta da voz). Limite ~20k chars — base prompt e tecnico, nao
  // narrativo.
  const MAX_BASE_PROMPT_CHARS = 20_000;
  const basePromptFileInputRef = useRef<HTMLInputElement>(null);
  const [basePromptLoading, setBasePromptLoading] = useState(false);
  const [basePromptError, setBasePromptError] = useState<string | null>(null);

  async function handleBasePromptUpload(file: File) {
    setBasePromptError(null);
    setBasePromptLoading(true);
    try {
      const text = await extractTextFromFile(file);
      const truncated = text.slice(0, MAX_BASE_PROMPT_CHARS);
      setDraft((d) => ({
        ...d,
        basePrompt: truncated,
        basePrompt_source: `upload: ${file.name}`,
      }));
      if (text.length > MAX_BASE_PROMPT_CHARS) {
        setBasePromptError(
          `arquivo tinha ${text.length} chars, truncado pra ${MAX_BASE_PROMPT_CHARS}.`
        );
      }
    } catch (e) {
      setBasePromptError(`erro lendo arquivo: ${(e as Error).message ?? e}`);
    } finally {
      setBasePromptLoading(false);
    }
  }

  function handleBasePromptReset() {
    setBasePromptError(null);
    setDraft((d) => ({ ...d, basePrompt: "", basePrompt_source: "" }));
  }

  // V4.1.4: exporta o SKILL.md default do app pro analista poder ver o que
  // existe antes de criar um override. Download direto.
  function handleExportDefaultSkill() {
    const blob = new Blob([SKILL_REPLAI_SYSTEM_PROMPT], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "replai-SKILL-default.md";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // V4.1.4: preview do SKILL.md default dentro da extensao sem download.
  // Controla via state local (toggle).
  const [showDefaultSkill, setShowDefaultSkill] = useState(false);

  // V5.0.4: split em 2 useEffects.
  // A: re-hidrata draft + workspaceName sempre que a PROP muda por qualquer
  //    razao (switch de workspace OU pullAll de background alarm). Antes o
  //    dep era so `workspace.id`, entao pullAll mid-sessao deixava state
  //    local stale — user salvava e revertia name/config no cloud.
  useEffect(() => {
    setDraft({ ...workspace.config });
    setWorkspaceName(workspace.name);
  }, [workspace.id, workspace.name, workspace.config]);

  // B: side-effects transitorios que so precisam rodar em switch de workspace
  //    (nao em cada pull). Ex: fechar dialogs, carregar graph meta.
  useEffect(() => {
    setGraphError(null);
    setGraphInfo(null);
    setCsvPreview(null);
    setCreatingNew(false);
    setConfirmingDelete(false);
    setNewName("");
    setNewDuplicate(false);
    let cancelled = false;
    getGraphMeta(workspace.id)
      .then((m) => {
        if (!cancelled) setGraphMeta(m);
      })
      .catch(() => {
        if (!cancelled) setGraphMeta(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace.id]);

  function set<K extends keyof Config>(key: K, value: Config[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function toggleLang(lang: string) {
    setDraft((d) => ({
      ...d,
      langs: d.langs.includes(lang)
        ? d.langs.filter((l) => l !== lang)
        : [...d.langs, lang],
    }));
  }

  // Primeira fase: parseia e mostra preview, NAO salva. Usuario confirma na UI.
  async function handleCsvUpload(file: File) {
    setGraphError(null);
    setGraphInfo(null);
    setCsvPreview(null);
    setGraphBusy(true);
    try {
      const text = await file.text();
      const { data, rowCount, errors } = parseGraphCsv(text);
      setCsvPreview({ data, fileName: file.name, rowCount, errors });
    } catch (e) {
      setGraphError(
        e instanceof CsvFatalError
          ? e.message
          : `Erro lendo o CSV: ${(e as Error).message ?? e}`
      );
    } finally {
      setGraphBusy(false);
    }
  }

  // Segunda fase: commit do CSV previamente parseado.
  async function handleConfirmCsv() {
    if (!csvPreview) return;
    setGraphBusy(true);
    try {
      const meta = await saveUploadedGraph(
        workspace.id,
        csvPreview.data,
        csvPreview.fileName
      );
      setGraphMeta(meta);
      const summary = `${meta.handleCount} handles, ${meta.poiCount} POIs carregados de ${csvPreview.fileName}.`;
      setGraphInfo(
        csvPreview.errors.length
          ? `${summary} ${csvPreview.errors.length} linha(s) puladas de ${csvPreview.rowCount}.`
          : summary
      );
      setCsvPreview(null);
    } finally {
      setGraphBusy(false);
    }
  }

  function handleDiscardCsv() {
    setCsvPreview(null);
    setGraphError(null);
    setGraphInfo(null);
  }

  async function handleClearGraph() {
    setGraphError(null);
    setGraphBusy(true);
    try {
      await clearUploadedGraph(workspace.id);
      setGraphMeta(null);
      setGraphInfo(`Voltou pro grafo bundled (${bundledGraphSize()} handles).`);
    } finally {
      setGraphBusy(false);
    }
  }

  async function handleSave() {
    if (workspaceName.trim() && workspaceName !== workspace.name) {
      await onRenameWorkspace(workspaceName.trim());
    }
    // Chaves: salva ANTES da config (assim profile cache ja atualiza, e
    // cloudConfigToConfig vai injetar nos workspaces no proximo pullAll).
    const keysChanged =
      geminiKeyDraft !== (profile?.gemini_api_key ?? "") ||
      anthropicKeyDraft !== (profile?.anthropic_api_key ?? "") ||
      notionTokenDraft !== (profile?.notion_api_token ?? "") ||
      apifyKeyDraft !== (profile?.apify_api_key ?? "");
    if (keysChanged) {
      await onSaveKeys({
        gemini_api_key: geminiKeyDraft.trim(),
        anthropic_api_key: anthropicKeyDraft.trim(),
        notion_api_token: notionTokenDraft.trim(),
        apify_api_key: apifyKeyDraft.trim(),
      });
    }
    // V5.0.4: await pra garantir que config termina antes de qualquer
    // side-effect subsequente (fecha modal, muda view). Antes era
    // fire-and-forget, gerando race com renders.
    await onSaveConfig({ ...draft, listId: extractListId(draft.listId) });
  }

  async function handleConfirmCreate() {
    const name = newName.trim() || "novo workspace";
    await onCreateWorkspace(name, newDuplicate);
    setCreatingNew(false);
    setNewName("");
    setNewDuplicate(false);
  }

  // V4.1.14 (WR-12): bloqueia duplo-click + so limpa input apos sucesso
  const [deletingBusy, setDeletingBusy] = useState(false);
  async function handleConfirmDelete() {
    if (deletingBusy) return;
    if (deleteConfirmInput.trim() !== workspace.name) return;
    setDeletingBusy(true);
    try {
      await onDeleteWorkspace();
      setDeleteConfirmInput("");
      setConfirmingDelete(false);
    } finally {
      setDeletingBusy(false);
    }
  }

  const activeHandleCount = graphMeta?.handleCount ?? bundledGraphSize();

  const labelCls = "mb-1 block text-xs font-medium text-zinc-400";
  const inputCls =
    "w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-600";
  const btnGhost =
    "rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50";
  const btnPrimary =
    "rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50";
  // V5.1: summaryCls removido — todos os blocos migrados pra SettingSection.

  return (
    <SettingsModeContext.Provider value={settingsMode}>
    <div class="flex flex-col gap-4">
      {/* V4.1.4: header sticky com botao salvar destacado no topo. Fica
          visivel durante scroll, evita ter que rolar ate o fim toda vez. */}
      <div class="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-zinc-800 bg-[color:var(--color-bg-base)]/95 px-3 py-2.5 backdrop-blur">
        <div class="min-w-0">
          <h2 class="text-sm font-semibold text-zinc-200">configuracoes</h2>
          {userEmail && (
            <div class="truncate text-[10px] text-zinc-500">{userEmail}</div>
          )}
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          {/* V5.2: toggle Simples/Avancado — 2 pills, persistido em storage. */}
          <div class="mr-1 flex items-center rounded border border-zinc-700 bg-zinc-900 p-0.5" role="group" aria-label="Modo de settings">
            <button
              type="button"
              onClick={() => setSettingsMode("simple")}
              aria-pressed={settingsMode === "simple"}
              class={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                settingsMode === "simple"
                  ? "bg-sky-500/20 text-sky-200"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              simples
            </button>
            <button
              type="button"
              onClick={() => setSettingsMode("advanced")}
              aria-pressed={settingsMode === "advanced"}
              class={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                settingsMode === "advanced"
                  ? "bg-sky-500/20 text-sky-200"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              avancado
            </button>
          </div>
          <button
            onClick={handleSave}
            class="rounded bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
            title="salvar config + chaves + nome do workspace"
          >
            salvar
          </button>
          <button
            onClick={onOpenDashboard}
            class="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            atividade
          </button>
          {userEmail && (
            <button
              onClick={onSignOut}
              class="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              sair
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              class="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
              title="fechar sem salvar (volta pro main)"
            >
              fechar
            </button>
          )}
        </div>
      </div>

      {/* V5.1: Tabs pra separar cross-canal (Geral) de X e LinkedIn.
          Aba do canal so aparece quando o canal esta habilitado. */}
      <div class="px-3">
        <Tabs
          tabs={[
            { id: "general", label: "Geral" },
            { id: "x", label: "X" },
            { id: "linkedin", label: "LinkedIn" },
          ]}
          active={settingsTab}
          onChange={(id) => setSettingsTab(id as SettingsTab)}
        >
          <></>
        </Tabs>
      </div>

      {/* corpo */}
      <div class="flex flex-col gap-4 px-3 pb-3">
      {/* V5.1: SetupChecklist + bloco "Canais ativos" removidos por pedido do
          user — poluicao visual. Tabs X e LinkedIn sempre visiveis; canal fica
          "usado" implicitamente quando voz+bundle/lista estao preenchidos. */}


      {/* V5.1: LinkedIn — 5 SettingSections separados, renderizados pelo
          proprio LinkedInSettings. Wrapper div carrega o hideIfNotTab. */}
      <div
        id="settings-linkedin"
        class={`contents ${hideIfNotTab("linkedin")}`}
      >
        <LinkedInSettings
          workspaceId={workspace.id}
          config={draft}
          onChange={(patch) => setDraft(patch as Config)}
          activeBundle={linkedInBundle}
          onBundleReload={() => setBundleReloadTick((t) => t + 1)}
          onOpenGlossary={onOpenGlossary}
          onOpenVoiceCreator={() => setVoiceCreatorOpen(true)}
        />
      </div>

      {/* V5.3: Nome do workspace — bloco basico, visivel em modo Simples.
          Extraido do "Workspace admin" (que continua advanced pra create/
          delete/export/import). Feedback visual: border amarela quando dirty,
          botoes salvar/desfazer contextuais inline. */}
      <SettingSection
        title="Nome do workspace"
        channel="meta"
        tone="zinc"
        order={2}
        help="Renomear so este workspace. Nao mexe em nada mais."
        extraClass={hideIfNotTab("general")}
      >
        {(() => {
          const dirty = workspaceName.trim() !== workspace.name && workspaceName.trim().length > 0;
          const empty = workspaceName.trim().length === 0;
          return (
            <>
              <div class="flex gap-1.5">
                <input
                  type="text"
                  aria-label="nome do workspace"
                  class={`flex-1 rounded border bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-zinc-950 ${
                    dirty
                      ? "border-amber-500/60 focus:border-amber-500 focus:ring-amber-500"
                      : empty
                        ? "border-red-800/60 focus:border-red-500 focus:ring-red-500"
                        : "border-zinc-700 focus:border-sky-600 focus:ring-sky-500"
                  }`}
                  value={workspaceName}
                  onInput={(e) =>
                    setWorkspaceName((e.target as HTMLInputElement).value)
                  }
                />
                {dirty && (
                  <>
                    <button
                      type="button"
                      onClick={async () => {
                        await onRenameWorkspace(workspaceName.trim());
                      }}
                      title="salvar so o novo nome (nao mexe no resto)"
                      class="rounded bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-1 focus:ring-offset-zinc-950"
                    >
                      renomear
                    </button>
                    <button
                      type="button"
                      onClick={() => setWorkspaceName(workspace.name)}
                      title="desfazer alteracao"
                      class="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
                    >
                      desfazer
                    </button>
                  </>
                )}
              </div>
              <p class={`mt-1 text-[10px] leading-snug ${
                dirty ? "text-amber-300" : empty ? "text-red-300" : "text-zinc-500"
              }`}>
                {dirty
                  ? "nome alterado — clique 'renomear' pra confirmar ou 'salvar' no header pra confirmar tudo junto."
                  : empty
                    ? "nome nao pode ficar vazio."
                    : `atualmente: ${workspace.name}`}
              </p>
            </>
          );
        })()}
      </SettingSection>

      {/* V5.1: Workspace admin — SettingSection zinc (order 3 general).
          V5.3: nome extraido pro bloco separado acima. Aqui ficam so as
          acoes destrutivas/estruturais (novo, duplicar, exportar, importar,
          excluir) — advanced-only. */}
      <SettingSection
        advanced
        title={`Workspace admin (${workspaces.length} no total)`}
        channel="meta"
        tone="zinc"
        order={3}
        help="Criar novo, duplicar, exportar/importar, excluir. Raramente editado."
        extraClass={hideIfNotTab("general")}
      >
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCreatingNew((v) => !v)}
            class={btnGhost}
          >
            {creatingNew ? "cancelar" : "+ novo workspace"}
          </button>
          <button
            type="button"
            onClick={onExportWorkspace}
            title="baixa um JSON com config e grafo deste workspace (inclui chaves de API)"
            class={btnGhost}
          >
            exportar
          </button>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            title="cria um novo workspace a partir de um JSON exportado"
            class={btnGhost}
          >
            importar
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmingDelete((v) => !v);
              setDeleteConfirmInput("");
            }}
            class={`${btnGhost} text-red-300 hover:bg-red-500/10`}
          >
            {confirmingDelete ? "cancelar" : "excluir este workspace"}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            class="hidden"
            onChange={(e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) onImportWorkspace(f);
              (e.target as HTMLInputElement).value = "";
            }}
          />
        </div>

        {creatingNew && (
          <div class="mt-2 flex flex-col gap-2 rounded border border-zinc-700 bg-zinc-900/60 p-2">
            <input
              type="text"
              class={inputCls}
              placeholder="nome do novo workspace"
              value={newName}
              onInput={(e) =>
                setNewName((e.target as HTMLInputElement).value)
              }
            />
            <label class="flex items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={newDuplicate}
                onChange={(e) =>
                  setNewDuplicate((e.target as HTMLInputElement).checked)
                }
              />
              copiar config e grafo deste workspace
            </label>
            <button
              type="button"
              onClick={handleConfirmCreate}
              class={btnPrimary}
            >
              criar
            </button>
          </div>
        )}

        {confirmingDelete && (
          <div class="mt-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">
            <p>
              isso apaga config, grafo uploaded e cache de sessao deste
              workspace.
              {workspaces.length === 1 &&
                " como e o ultimo, um Default vazio sera criado no lugar."}
            </p>
            <p class="mt-2">
              pra confirmar, digite o nome do workspace:{" "}
              <strong class="font-mono text-red-100">{workspace.name}</strong>
            </p>
            <input
              type="text"
              class="mt-1 w-full rounded border border-red-500/60 bg-red-950/40 px-2 py-1 text-xs text-red-100 placeholder-red-300/40 outline-none focus:border-red-400"
              placeholder={workspace.name}
              value={deleteConfirmInput}
              onInput={(e) =>
                setDeleteConfirmInput((e.target as HTMLInputElement).value)
              }
              aria-label="digite o nome do workspace pra confirmar exclusao"
            />
            <div class="mt-2 flex gap-2">
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={
                  deleteConfirmInput.trim() !== workspace.name || deletingBusy
                }
                class="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                title={
                  deleteConfirmInput.trim() === workspace.name
                    ? "exclui agora"
                    : `digite "${workspace.name}" pra habilitar`
                }
              >
                {deletingBusy ? "excluindo…" : "confirmar exclusao"}
              </button>
            </div>
          </div>
        )}
      </SettingSection>

      {/* V5.1: Fontes X — SettingSection sky (order 3) */}
      <SettingSection
        title="Listas do X e seu @"
        channel="x"
        tone="sky"
        order={3}
        id="settings-sources-x"
        defaultOpen
        help="De onde o Replai puxa os tweets. Cadastre 1+ Listas do X. O seu @ serve pro admin acompanhar seu engajamento."
        extraClass={hideIfNotTab("x")}
      >

        {/* --- Listas do X --- */}
        <div class="mb-3">
          <div class="mb-1.5 flex items-center justify-between gap-2">
            <label class="text-[11px] font-medium text-zinc-300">
              🐦 listas do X
            </label>
            <span class="text-[10px] text-zinc-500">
              {(draft.lists ?? []).length} cadastrada
              {(draft.lists ?? []).length === 1 ? "" : "s"}
            </span>
          </div>
          <p class="mb-1.5 text-[10px] leading-snug text-zinc-500">
            cole o link da Lista (ex: <code class="text-zinc-400">x.com/i/lists/123...</code>)
            ou so o ID. o radio marca qual e a ativa agora.
          </p>
          <div class="flex flex-col gap-1.5">
            {(draft.lists ?? []).map((l) => (
              <div
                key={l.id}
                class="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
              >
                <input
                  type="radio"
                  name="active-list"
                  checked={draft.activeListId === l.id}
                  onChange={() =>
                    setDraft((d) => ({
                      ...d,
                      activeListId: l.id,
                      listId: l.listId,
                    }))
                  }
                  title="ativar essa lista"
                />
                <input
                  type="text"
                  class="min-w-0 flex-1 rounded border border-transparent bg-transparent text-zinc-200 outline-none focus:border-zinc-600"
                  placeholder="nome (ex: Lista IA)"
                  value={l.name}
                  onInput={(e) => {
                    const v = (e.target as HTMLInputElement).value;
                    setDraft((d) => ({
                      ...d,
                      lists: (d.lists ?? []).map((x) =>
                        x.id === l.id ? { ...x, name: v } : x
                      ),
                    }));
                  }}
                />
                <input
                  type="text"
                  class="w-32 min-w-0 truncate rounded border border-transparent bg-transparent text-right text-[10px] text-zinc-500 outline-none focus:border-zinc-600"
                  placeholder="link ou ID"
                  value={l.listId}
                  onInput={(e) => {
                    const v = extractListId(
                      (e.target as HTMLInputElement).value
                    );
                    setDraft((d) => {
                      const newLists = (d.lists ?? []).map((x) =>
                        x.id === l.id ? { ...x, listId: v } : x
                      );
                      // V4.1.16: se essa lista e a ativa OU se nao ha ativa
                      // definida ainda, sincroniza top-level listId.
                      // Sem isso, isConfigComplete (que olha listId top-level)
                      // ficava false e atualizar voltava pra Settings.
                      const shouldSyncTop =
                        l.id === d.activeListId || !d.activeListId;
                      return {
                        ...d,
                        lists: newLists,
                        listId: shouldSyncTop ? v : d.listId,
                        ...(shouldSyncTop && !d.activeListId
                          ? { activeListId: l.id }
                          : {}),
                      };
                    });
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if ((draft.lists ?? []).length <= 1) return;
                    setDraft((d) => {
                      const newLists = (d.lists ?? []).filter(
                        (x) => x.id !== l.id
                      );
                      const newActive =
                        d.activeListId === l.id
                          ? newLists[0]?.id
                          : d.activeListId;
                      return {
                        ...d,
                        lists: newLists,
                        activeListId: newActive,
                        listId:
                          newActive && newLists.find((x) => x.id === newActive)
                            ? newLists.find((x) => x.id === newActive)!.listId
                            : d.listId,
                      };
                    });
                  }}
                  class="rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-500/10 disabled:opacity-30"
                  disabled={(draft.lists ?? []).length <= 1}
                  title={
                    (draft.lists ?? []).length <= 1
                      ? "precisa ter pelo menos 1 lista"
                      : "remover lista"
                  }
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              const newId = `wsl_${Math.random().toString(36).slice(2, 10)}`;
              setDraft((d) => {
                const existing = d.lists ?? [];
                // V4.1.16: se for a PRIMEIRA lista, marca como ativa
                // automaticamente. Antes o user precisava lembrar de clicar
                // no radio button — varios esqueciam e o save "nao salvava"
                // (na verdade salvava, mas isConfigComplete batia em
                // listId top-level vazio e voltava pra settings).
                const isFirst = existing.length === 0;
                return {
                  ...d,
                  lists: [
                    ...existing,
                    {
                      id: newId,
                      name: `Lista ${existing.length + 1}`,
                      listId: "",
                    },
                  ],
                  ...(isFirst ? { activeListId: newId } : {}),
                };
              });
            }}
            class={`${btnGhost} mt-1.5`}
          >
            + adicionar lista
          </button>
        </div>

        {/* --- Conta @ linkada --- */}
        <div class="mb-3">
          <label class="mb-1.5 block text-[11px] font-medium text-zinc-300">
            👤 sua conta do X <span class="text-zinc-500">(opcional)</span>
          </label>
          <div class="flex items-center gap-1">
            <span class="text-sm text-zinc-500">@</span>
            <input
              type="text"
              class={inputCls}
              placeholder="seu_handle"
              value={draft.twitter_handle ?? ""}
              onInput={(e) =>
                set(
                  "twitter_handle",
                  (e.target as HTMLInputElement).value
                    .trim()
                    .replace(/^@/, "")
                    .toLowerCase()
                )
              }
            />
          </div>
          <p class="mt-1 text-[10px] leading-snug text-zinc-500">
            handle da conta que voce usa pra postar neste workspace. ajuda o
            admin a trackear teu engagement depois.
          </p>
        </div>

        {/* V4.1.4: Watchtower REMOVIDO da UI. Sempre usa o default do
            time (env VITE_WATCHTOWER_PAGE_ID). Override pessoal via SQL
            no Supabase workspaces.config se algum dia precisar. */}
      </SettingSection>

      {/* V5.1: Social graph X — SettingSection amber (order 6) */}
      <SettingSection
        advanced
        title={`Social graph (node_metrics)${graphMeta ? ` — ${graphMeta.handleCount} uploaded` : ` — ${bundledGraphSize()} bundled`}`}
        channel="x"
        tone="amber"
        order={6}
        help="Grafo social de handles X (isv, layer, is_poi) — driva prefilter + intelligence layer. Bundled default do time. Upload CSV pra sobrescrever com grafo proprio."
        extraClass={hideIfNotTab("x")}
      >
        <div class="rounded border border-zinc-700 bg-zinc-900/50 p-2.5 text-xs">
          {graphMeta ? (
            <div class="text-zinc-200">
              <div class="font-medium">{graphMeta.filename}</div>
              <div class="text-zinc-400">
                {graphMeta.handleCount} handles, {graphMeta.poiCount} POIs ·{" "}
                {new Date(graphMeta.uploadedAt).toLocaleString("pt-BR")}
              </div>
            </div>
          ) : (
            <div class="text-zinc-400">
              Usando o grafo bundled ({bundledGraphSize()} handles).
            </div>
          )}

          <div class="mt-2 flex gap-2">
            <button
              type="button"
              disabled={graphBusy}
              onClick={() => fileInputRef.current?.click()}
              class={btnGhost}
            >
              {graphBusy ? "..." : graphMeta ? "trocar CSV" : "carregar CSV"}
            </button>
            {graphMeta && (
              <button
                type="button"
                disabled={graphBusy}
                onClick={handleClearGraph}
                class={btnGhost}
              >
                voltar pro bundled
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              class="hidden"
              onChange={(e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (f) handleCsvUpload(f);
                (e.target as HTMLInputElement).value = "";
              }}
            />
          </div>

          <div class="mt-1.5 text-[10px] text-zinc-500">
            CSV com cabecalho: handle, isv, inferred_layer, is_poi
          </div>

          {graphError && (
            <div class="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-300">
              {graphError}
            </div>
          )}
          {graphInfo && !graphError && (
            <div class="mt-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300">
              {graphInfo}
            </div>
          )}

          {csvPreview && (
            <div class="mt-2 rounded border border-sky-500/40 bg-sky-500/5 p-2 text-[11px]">
              <div class="mb-1 font-semibold text-sky-300">
                preview: {csvPreview.fileName}
              </div>
              <div class="mb-1.5 text-zinc-400">
                {Object.keys(csvPreview.data).length} handles validos de{" "}
                {csvPreview.rowCount} linhas
                {csvPreview.errors.length > 0 &&
                  `, ${csvPreview.errors.length} puladas`}
              </div>
              <div class="overflow-hidden rounded border border-zinc-700 bg-zinc-900/70">
                <div class="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 border-b border-zinc-700 px-2 py-1 text-[10px] font-semibold uppercase text-zinc-500">
                  <span>handle</span>
                  <span>isv</span>
                  <span>layer</span>
                  <span>poi</span>
                </div>
                {Object.entries(csvPreview.data)
                  .slice(0, 5)
                  .map(([handle, entry]) => (
                    <div
                      key={handle}
                      class="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 border-b border-zinc-800 px-2 py-1 text-zinc-200 last:border-0"
                    >
                      <span class="truncate">@{handle}</span>
                      <span class="tabular-nums">{entry.isv}</span>
                      <span class="tabular-nums">{entry.inferred_layer}</span>
                      <span class="tabular-nums">{entry.is_poi}</span>
                    </div>
                  ))}
              </div>
              {Object.keys(csvPreview.data).length > 5 && (
                <div class="mt-1 text-[10px] text-zinc-500">
                  + {Object.keys(csvPreview.data).length - 5} outros
                </div>
              )}
              {csvPreview.errors.length > 0 && (
                <details class="mt-1.5">
                  <summary class="cursor-pointer text-[10px] text-amber-400">
                    ver {csvPreview.errors.length} linha(s) puladas
                  </summary>
                  <div class="mt-1 max-h-24 overflow-y-auto text-[10px] text-amber-200">
                    {csvPreview.errors.slice(0, 20).map((err, i) => (
                      <div key={i}>{err}</div>
                    ))}
                  </div>
                </details>
              )}
              <div class="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={graphBusy}
                  onClick={handleConfirmCsv}
                  class={btnPrimary}
                >
                  salvar grafo
                </button>
                <button
                  type="button"
                  disabled={graphBusy}
                  onClick={handleDiscardCsv}
                  class={btnGhost}
                >
                  descartar
                </button>
              </div>
            </div>
          )}
        </div>
      </SettingSection>

      {/* V5.0.4: Provider LLM movido pra dentro do bloco de Chaves.
          Antes ficava orfao em order-0 (topo), sem contexto. */}

      {/* VOZ X — SettingSection violet (personalidade). Fechavel. */}
      <SettingSection
        title="Voz do canal X"
        channel="x"
        tone="violet"
        order={1}
        id="settings-voice"
        defaultOpen
        help="Texto que define como suas replies no X sao escritas — tom, referencias, anti-padroes. Sem isso, replies ficam genericas. Cole abaixo ou carregue arquivo (.md/.pdf/.txt)."
        extraClass={hideIfNotTab("x")}
      >
        <div class="flex flex-wrap items-center gap-1.5">
          {/* V5.2: Voice Creator (LLM). Substitui friccao de escrever do zero. */}
          <button
            type="button"
            onClick={() => setVoiceCreatorOpen(true)}
            class="rounded border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-[11px] font-medium text-violet-200 hover:bg-violet-500/20"
          >
            criar voz automatica
          </button>
          <button
            type="button"
            onClick={() => voiceFileInputRef.current?.click()}
            disabled={voiceLoading}
            class={btnGhost}
          >
            {voiceLoading
              ? "lendo..."
              : draft.voice
                ? "trocar arquivo (.md/.pdf/.txt)"
                : "carregar arquivo (.md/.pdf/.txt)"}
          </button>
          {draft.voice && (
            <button type="button" onClick={handleVoiceClear} class={btnGhost}>
              limpar
            </button>
          )}
          {draft.voice_source && (
            <span class="text-[10px] text-violet-300/80">
              {draft.voice_source}
            </span>
          )}
          <input
            ref={voiceFileInputRef}
            type="file"
            accept=".md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf"
            class="hidden"
            onChange={(e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) handleVoiceUpload(f);
              (e.target as HTMLInputElement).value = "";
            }}
          />
        </div>

        <textarea
          class={`${inputCls} min-h-[100px] max-h-[40vh] resize-y font-mono text-[12px] leading-snug`}
          placeholder="ex: sou PM de fintech B2B focado em risco. priorize replies que tragam casos de risk modeling, referencias a praticantes da area (varo, nubank, etc) e perguntas tecnicas sobre fraud detection. evite jargao corporativo."
          value={draft.voice}
          onInput={(e) => {
            const v = (e.target as HTMLTextAreaElement).value;
            // se usuario editou manualmente apos upload, marca como "editado"
            setDraft((d) => ({
              ...d,
              voice: v,
              voice_source:
                d.voice_source && v !== d.voice
                  ? `${d.voice_source.split(" (editado)")[0]} (editado)`
                  : d.voice_source,
            }));
          }}
        />
        <div class="text-[10px] text-zinc-500">
          {draft.voice.length} / {MAX_VOICE_CHARS} chars. quanto mais especifico
          (area, referencias, anti-padroes), menos generico fica.
        </div>

        {voiceError && (
          <div class="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
            {voiceError}
          </div>
        )}
      </SettingSection>

      {/* V5.2: Persona X removida da UI — user feedback: overload informacional.
          A voz do canal ja carrega o publico natural do analista. Campo
          persona_public_target permanece no schema; consumidores (reply-generator,
          posts-suggestion) tratam array vazio como "sem segmentacao". */}

      {/* V5.1: Prompt base — SettingSection amber (order 2 general) */}
      <SettingSection
        advanced
        title="Prompt base override (avancado)"
        subtitle={draft.basePrompt?.trim() ? "custom" : undefined}
        channel="meta"
        tone="amber"
        order={2}
        help="Substitui o SKILL.md padrao. So use se souber o que ta fazendo — quebra facil o comportamento do LLM. Vazio = usa default."
        extraClass={hideIfNotTab("general")}
      >
        <div class="text-[11px] text-zinc-400">
          o prompt base contem regras tecnicas (anti-padroes, categorias de
          valor, restricoes). edite SO se voce quer um sandbox diferente do
          default. a voz acima dita o tom — este prompt dita o que NAO fazer.
          vazio = usa o default do app.
        </div>

        {/* V4.1.4: ver/exportar o SKILL.md default antes de criar override */}
          <div class="mb-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowDefaultSkill((v) => !v)}
              class={btnGhost}
            >
              {showDefaultSkill ? "esconder default" : "👁 ver default do app"}
            </button>
            <button
              type="button"
              onClick={handleExportDefaultSkill}
              class={btnGhost}
            >
              ⬇ baixar SKILL.md
            </button>
          </div>
          {showDefaultSkill && (
            <details open class="mb-2 rounded border border-zinc-700 bg-zinc-950">
              <summary class="cursor-pointer px-2 py-1 text-[10px] text-zinc-400">
                SKILL.md default ({SKILL_REPLAI_SYSTEM_PROMPT.length} chars)
              </summary>
              <pre class="max-h-64 overflow-y-auto whitespace-pre-wrap p-2 font-mono text-[10.5px] leading-snug text-zinc-300">
                {SKILL_REPLAI_SYSTEM_PROMPT}
              </pre>
            </details>
          )}

          <div class="mb-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => basePromptFileInputRef.current?.click()}
              disabled={basePromptLoading}
              class={btnGhost}
            >
              {basePromptLoading
                ? "lendo..."
                : draft.basePrompt
                  ? "trocar arquivo (.md/.pdf/.txt)"
                  : "carregar arquivo (.md/.pdf/.txt)"}
            </button>
            {draft.basePrompt && (
              <button
                type="button"
                onClick={handleBasePromptReset}
                class={btnGhost}
              >
                voltar pro default
              </button>
            )}
            {draft.basePrompt_source && (
              <span class="text-[10px] text-amber-300/80">
                {draft.basePrompt_source}
              </span>
            )}
            <input
              ref={basePromptFileInputRef}
              type="file"
              accept=".md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf"
              class="hidden"
              onChange={(e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (f) handleBasePromptUpload(f);
                (e.target as HTMLInputElement).value = "";
              }}
            />
          </div>

          <textarea
            class={`${inputCls} min-h-[120px] max-h-[40vh] resize-y font-mono text-[12px] leading-snug`}
            placeholder="(vazio = usa o SKILL.md default do app)"
            value={draft.basePrompt ?? ""}
            onInput={(e) => {
              const v = (e.target as HTMLTextAreaElement).value;
              setDraft((d) => ({
                ...d,
                basePrompt: v,
                basePrompt_source:
                  d.basePrompt_source && v !== d.basePrompt
                    ? `${d.basePrompt_source.split(" (editado)")[0]} (editado)`
                    : d.basePrompt_source,
              }));
            }}
          />
          <div class="mt-1 text-[10px] text-zinc-500">
            {(draft.basePrompt ?? "").length} / {MAX_BASE_PROMPT_CHARS} chars.
            atencao: prompt base mal feito pode quebrar a geracao. teste em
            workspace separado antes.
          </div>

          {basePromptError && (
            <div class="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-300">
              {basePromptError}
            </div>
          )}
      </SettingSection>

      {/* V5.1: Chaves API + provider + modelo — SettingSection zinc (order 1 geral) */}
      <SettingSection
        title="Chaves de API + provider + modelo LLM"
        channel="meta"
        tone="zinc"
        order={1}
        id="settings-keys"
        defaultOpen
        help="Chaves valem pra TODOS os teus workspaces (guardadas no teu perfil, nao no workspace). Provider define qual LLM vai gerar as replies."
        extraClass={hideIfNotTab("general")}
      >
        <div class="flex flex-col gap-3">
          {/* V5.0.4: Provider LLM primeiro (define qual chave e relevante) */}
          <div>
            <label class={labelCls}>Provider de LLM</label>
            <div class="flex flex-col gap-1.5 text-sm text-zinc-200">
              {PROVIDER_OPTIONS.map((p) => (
                <label key={p.id} class="flex items-center gap-2">
                  <input
                    type="radio"
                    name="llm_provider"
                    checked={draft.llm_provider === p.id}
                    onChange={() => set("llm_provider", p.id)}
                  />
                  {p.label}
                </label>
              ))}
            </div>
            <p class="mt-1 text-[10px] text-zinc-500">
              Define qual chave abaixo e usada. Gemini e gratuito ate um limite generoso; Anthropic Claude e pago mas produz replies mais autoralias.
            </p>
          </div>
          <div>
            <label class={labelCls}>
              Chave Gemini API{" "}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                class="text-sky-400 hover:underline"
              >
                (obter aqui)
              </a>
            </label>
            <input
              type="password"
              class={inputCls}
              value={geminiKeyDraft}
              onInput={(e) =>
                setGeminiKeyDraft((e.target as HTMLInputElement).value)
              }
            />
          </div>

          <div>
            <label class={labelCls}>
              Chave Anthropic API{" "}
              <a
                href="https://console.anthropic.com"
                target="_blank"
                rel="noreferrer"
                class="text-sky-400 hover:underline"
              >
                (obter aqui)
              </a>
            </label>
            <input
              type="password"
              class={inputCls}
              value={anthropicKeyDraft}
              onInput={(e) =>
                setAnthropicKeyDraft((e.target as HTMLInputElement).value)
              }
            />
          </div>

          {/* V4.1.3 — token Notion REMOVIDO da UI. Token e padrao do time
              (VITE_NOTION_API_TOKEN no build). Override pessoal pode ser
              setado direto no Supabase profile.notion_api_token via SQL
              Editor caso precise (raro: dev local, pagina externa). */}

          {/* V5.3 — Chave APIFY editavel (opcional). Se preenchida, edge
              function apify-fetch usa esta em vez do secret server-side.
              Vazia = fallback pro secret padrao do time. Input type=password
              pra nao aparecer em screenshots. */}
          <div>
            <label class={labelCls}>
              Chave APIFY (opcional){" "}
              <a
                href="https://console.apify.com/settings/integrations"
                target="_blank"
                rel="noreferrer"
                class="text-sky-400 hover:underline"
              >
                (obter aqui)
              </a>
            </label>
            <input
              type="password"
              autocomplete="new-password"
              class={inputCls}
              placeholder={
                profile?.apify_api_key
                  ? "chave configurada — cole nova pra trocar"
                  : "usando chave padrao do time (deixe vazio) — ou cole a sua"
              }
              value={apifyKeyDraft}
              onInput={(e) =>
                setApifyKeyDraft((e.target as HTMLInputElement).value)
              }
            />
            <p class="mt-1 text-[10px] leading-snug text-zinc-500">
              {apifyKeyDraft.trim()
                ? "sua chave sera usada nas coletas LinkedIn deste profile."
                : "vazio = coletas usam a chave padrao do time. Cole a sua pra sobrepor."}
            </p>
          </div>

          {draft.llm_provider === "anthropic" && (
            <div>
              <label class={labelCls}>Modelo Anthropic</label>
              <select
                class={inputCls}
                value={draft.model}
                onChange={(e) =>
                  set("model", (e.target as HTMLSelectElement).value)
                }
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </SettingSection>

      {/* V5.2: Filtros X simplificados — bloco visivel no modo simples.
          Basico: janela + batch + idiomas (3 knobs que qualquer user mexe).
          Power knobs (paginas, merge listas, handles fora, dry-run) ficam
          num <details> interno pra nao poluir. Social Graph e Pre-filtro
          seguem em SettingSections separadas com advanced=true. */}
      <SettingSection
        title="Filtros de coleta"
        channel="x"
        tone="indigo"
        order={4}
        help="Janela de tempo, quantos tweets vao pro LLM, idiomas aceitos."
        extraClass={hideIfNotTab("x")}
      >
        <div class="flex flex-col gap-3">
          <div>
            <label class={labelCls}>Janela de tempo (horas)</label>
            <input
              type="number"
              min={1}
              max={168}
              class={inputCls}
              value={draft.timeWindowHours}
              onInput={(e) =>
                set(
                  "timeWindowHours",
                  Math.max(
                    1,
                    Number((e.target as HTMLInputElement).value) || 10
                  )
                )
              }
            />
            <p class="mt-1 text-[10px] leading-snug text-zinc-500">
              Quantas horas atras o refresh olha na Lista. Menor = triagem mais focada em novidade.
            </p>
          </div>

          <div>
            <label class={labelCls}>Tweets analisados por vez (ate 200)</label>
            <input
              type="number"
              min={1}
              max={200}
              class={inputCls}
              value={draft.maxBatch}
              onInput={(e) =>
                set(
                  "maxBatch",
                  Math.max(
                    1,
                    Math.min(
                      200,
                      Number((e.target as HTMLInputElement).value) || 50
                    )
                  )
                )
              }
            />
            <p class="mt-1 text-[10px] leading-snug text-zinc-500">
              Todos vao numa unica chamada. Mais = menos cliques; menos = resposta mais rapida.
            </p>
          </div>

          <div>
            <label class={labelCls}>Idiomas aceitos</label>
            <div class="flex gap-3 text-sm text-zinc-200">
              {[
                { id: "en", label: "ingles" },
                { id: "pt", label: "portugues" },
                { id: "", label: "indefinido" },
              ].map((l) => (
                <label key={l.id} class="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={draft.langs.includes(l.id)}
                    onChange={() => toggleLang(l.id)}
                  />
                  {l.label}
                </label>
              ))}
            </div>
          </div>

          {/* Power knobs — raramente tocados. Ficam colapsados. */}
          <details class="group rounded border border-zinc-800 bg-zinc-950/40">
            <summary class="cursor-pointer list-none px-2 py-1.5 text-[10px] uppercase tracking-wide text-zinc-500 hover:text-zinc-300 [&::-webkit-details-marker]:hidden">
              <span
                class="mr-1 inline-block w-2 transition-transform group-open:rotate-90"
                aria-hidden="true"
              >
                ›
              </span>
              opcoes avancadas de coleta
            </summary>
            <div class="flex flex-col gap-3 border-t border-zinc-800 px-2 py-2">
              <div>
                <label class={labelCls}>Paginas TwitterAPI por refresh (1-20)</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  class={inputCls}
                  value={draft.maxPages ?? 4}
                  onInput={(e) =>
                    set(
                      "maxPages",
                      Math.min(
                        20,
                        Math.max(
                          1,
                          Number((e.target as HTMLInputElement).value) || 4
                        )
                      )
                    )
                  }
                />
                <p class="mt-1 text-[10px] leading-snug text-zinc-500">
                  ~20-50 tweets por pagina, 1 chamada paga. Mais = mais tweets unicos ao custo proporcional.
                </p>
              </div>

              {draft.lists && draft.lists.length >= 2 && (
                <label class="flex items-start gap-2 text-sm text-zinc-200">
                  <input
                    type="checkbox"
                    class="mt-0.5"
                    checked={draft.fetchAllLists ?? false}
                    onChange={(e) =>
                      set("fetchAllLists", (e.target as HTMLInputElement).checked)
                    }
                  />
                  <span>
                    Fetch de TODAS as listas em UMA (merge)
                    <span class="block text-[10px] text-zinc-500">
                      busca de N listas configuradas e funde. N× custo TwitterAPI.
                    </span>
                  </span>
                </label>
              )}

              <label class="flex items-start gap-2 text-sm text-zinc-200">
                <input
                  type="checkbox"
                  class="mt-0.5"
                  checked={draft.includeUnmapped}
                  onChange={(e) =>
                    set("includeUnmapped", (e.target as HTMLInputElement).checked)
                  }
                />
                <span>
                  Incluir handles fora do grafo ({activeHandleCount} mapeados)
                  <span class="block text-[10px] text-zinc-500">
                    On = qualquer autor passa. Off = so autores do grafo social.
                  </span>
                </span>
              </label>

              <label class="flex items-start gap-2 text-sm text-zinc-200">
                <input
                  type="checkbox"
                  class="mt-0.5"
                  checked={draft.dryRun}
                  onChange={(e) =>
                    set("dryRun", (e.target as HTMLInputElement).checked)
                  }
                />
                <span>
                  Dry-run (so filtra, nao chama LLM)
                  <span class="block text-[10px] text-zinc-500">
                    Modo teste sem gastar tokens. Util pra calibrar filtros.
                  </span>
                </span>
              </label>
            </div>
          </details>
        </div>
      </SettingSection>

      {/* V5.1: Filtro de selecao — SettingSection indigo (order 5 x) */}
      <SettingSection
        advanced
        title="Pre-filtro de selecao (persona x engajamento)"
        channel="x"
        tone="indigo"
        order={5}
        help="Apos prefilter, Gemini Flash ranqueia tweets por relevancia da voz + likelihood do autor engajar de volta. Top-15 visiveis, resto oculto expansivel. Custo ~$0.001/refresh."
        extraClass={hideIfNotTab("x")}
      >
        <div class="flex flex-col gap-2.5">
          <label class="flex items-center gap-2 text-sm text-zinc-200">
            <input
              type="checkbox"
              checked={draft.selectionFilter?.enabled ?? true}
              onChange={(e) => {
                const enabled = (e.target as HTMLInputElement).checked;
                set("selectionFilter", {
                  enabled,
                  topN: draft.selectionFilter?.topN ?? 15,
                  threshold: draft.selectionFilter?.threshold,
                  engagementWeight:
                    draft.selectionFilter?.engagementWeight ?? 0.6,
                });
              }}
            />
            ativar filtro semantico (requer voz configurada + chave Gemini)
          </label>
          <div>
            <label class={labelCls}>Quantos tweets mostrar (top-N)</label>
            <input
              type="number"
              min={5}
              max={50}
              class={inputCls}
              value={draft.selectionFilter?.topN ?? 15}
              onInput={(e) =>
                set("selectionFilter", {
                  enabled: draft.selectionFilter?.enabled ?? true,
                  topN: Math.max(
                    5,
                    Math.min(
                      50,
                      Number((e.target as HTMLInputElement).value) || 15
                    )
                  ),
                  threshold: draft.selectionFilter?.threshold,
                  engagementWeight:
                    draft.selectionFilter?.engagementWeight ?? 0.6,
                })
              }
            />
          </div>
          <div>
            <label class={labelCls}>
              Peso engajamento vs relevancia ({" "}
              {Math.round(
                ((draft.selectionFilter?.engagementWeight ?? 0.6) * 100)
              )}
              % engajamento )
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(
                (draft.selectionFilter?.engagementWeight ?? 0.6) * 100
              )}
              onInput={(e) =>
                set("selectionFilter", {
                  enabled: draft.selectionFilter?.enabled ?? true,
                  topN: draft.selectionFilter?.topN ?? 15,
                  threshold: draft.selectionFilter?.threshold,
                  engagementWeight:
                    Number((e.target as HTMLInputElement).value) / 100,
                })
              }
              class="w-full"
            />
            <div class="flex justify-between text-[10px] text-zinc-500">
              <span>so relevancia</span>
              <span>so engajamento</span>
            </div>
          </div>
        </div>
      </SettingSection>

      {/* V5.0.4: botao Salvar redundante removido. Sticky header no topo
          e o unico ponto de acao — evita ambiguidade de "qual salvar clico?". */}

      </div>  {/* close body */}

      {/* V5.2: Voice Creator overlay. Compartilhado por Voz X e Voz LinkedIn. */}
      {voiceCreatorOpen && (
        <VoiceCreator
          config={{ gemini_api_key: draft.gemini_api_key }}
          onApply={({ voice_x, voice_linkedin }) => {
            setDraft((d) => ({
              ...d,
              voice: voice_x ?? d.voice,
              voice_source: voice_x ? "Voice Creator (LLM)" : d.voice_source,
              linkedin_voice: voice_linkedin ?? d.linkedin_voice,
            }));
            setVoiceCreatorOpen(false);
          }}
          onClose={() => setVoiceCreatorOpen(false)}
        />
      )}
    </div>
    </SettingsModeContext.Provider>
  );
}
