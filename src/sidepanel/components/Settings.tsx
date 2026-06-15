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
import { extractTextFromFile, MAX_VOICE_CHARS } from "../../lib/voice-loader";

interface Props {
  workspace: Workspace;
  workspaces: WorkspaceMeta[];
  profile: ProfileRow | null;
  onSaveConfig: (config: Config) => void;
  onSaveKeys: (keys: {
    gemini_api_key: string;
    anthropic_api_key: string;
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
}: Props) {
  const [draft, setDraft] = useState<Config>({ ...workspace.config });
  const [workspaceName, setWorkspaceName] = useState(workspace.name);

  // Chaves de API: estado SEPARADO de draft. Source of truth = profile.
  // Quando salva, vai pro profile via onSaveKeys (nao via workspace.config).
  // Garante consistencia: chave aparece igual em TODOS os workspaces.
  const [geminiKeyDraft, setGeminiKeyDraft] = useState(
    profile?.gemini_api_key ?? ""
  );
  const [anthropicKeyDraft, setAnthropicKeyDraft] = useState(
    profile?.anthropic_api_key ?? ""
  );

  // re-sync keys quando profile chega/atualiza (apos pullAll)
  useEffect(() => {
    setGeminiKeyDraft(profile?.gemini_api_key ?? "");
    setAnthropicKeyDraft(profile?.anthropic_api_key ?? "");
  }, [profile?.gemini_api_key, profile?.anthropic_api_key]);

  // estado do upload de grafo (per-workspace)
  const [graphMeta, setGraphMeta] = useState<GraphMeta | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphInfo, setGraphInfo] = useState<string | null>(null);
  const [graphBusy, setGraphBusy] = useState(false);
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

  // upload de voz (.md/.pdf/.txt) - extrai texto e popula a textarea
  const voiceFileInputRef = useRef<HTMLInputElement>(null);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

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

  // Quando o workspace ativo muda (parent troca), reseta tudo do form pra
  // refletir o novo workspace.
  useEffect(() => {
    setDraft({ ...workspace.config });
    setWorkspaceName(workspace.name);
    setGraphError(null);
    setGraphInfo(null);
    setCsvPreview(null);
    setCreatingNew(false);
    setConfirmingDelete(false);
    setNewName("");
    setNewDuplicate(false);
    getGraphMeta(workspace.id)
      .then(setGraphMeta)
      .catch(() => setGraphMeta(null));
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
      anthropicKeyDraft !== (profile?.anthropic_api_key ?? "");
    if (keysChanged) {
      await onSaveKeys({
        gemini_api_key: geminiKeyDraft.trim(),
        anthropic_api_key: anthropicKeyDraft.trim(),
      });
    }
    onSaveConfig({ ...draft, listId: extractListId(draft.listId) });
  }

  async function handleConfirmCreate() {
    const name = newName.trim() || "novo workspace";
    await onCreateWorkspace(name, newDuplicate);
    setCreatingNew(false);
    setNewName("");
    setNewDuplicate(false);
  }

  async function handleConfirmDelete() {
    await onDeleteWorkspace();
    setConfirmingDelete(false);
  }

  const activeHandleCount = graphMeta?.handleCount ?? bundledGraphSize();

  const labelCls = "mb-1 block text-xs font-medium text-zinc-400";
  const inputCls =
    "w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-600";
  const btnGhost =
    "rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50";
  const btnPrimary =
    "rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50";
  const summaryCls =
    "cursor-pointer list-none select-none px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 hover:bg-zinc-800/40 [&::-webkit-details-marker]:hidden";

  return (
    <div class="flex flex-col gap-4 p-3">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-semibold text-zinc-200">Configuracoes</h2>
          {userEmail && (
            <div class="text-[10px] text-zinc-500">{userEmail}</div>
          )}
        </div>
        <div class="flex gap-1.5">
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
            >
              fechar
            </button>
          )}
        </div>
      </div>

      {/* WORKSPACE */}
      <div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
        <div class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          workspace ({workspaces.length} no total)
        </div>

        <label class={labelCls}>Nome do workspace ativo</label>
        <input
          type="text"
          class={inputCls}
          value={workspaceName}
          onInput={(e) =>
            setWorkspaceName((e.target as HTMLInputElement).value)
          }
        />

        <div class="mt-2 flex flex-wrap gap-2">
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
            onClick={() => setConfirmingDelete((v) => !v)}
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
            isso apaga config, grafo uploaded e cache de sessao deste workspace.
            {workspaces.length === 1 &&
              " como e o ultimo, um Default vazio sera criado no lugar."}
            <div class="mt-2 flex gap-2">
              <button
                type="button"
                onClick={handleConfirmDelete}
                class="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-500"
              >
                confirmar exclusao
              </button>
            </div>
          </div>
        )}
      </div>

      <div>
        <label class={labelCls}>ID da Lista do X (ou URL)</label>
        <input
          type="text"
          class={inputCls}
          placeholder="x.com/i/lists/1234567890"
          value={draft.listId}
          onInput={(e) => set("listId", (e.target as HTMLInputElement).value)}
        />
      </div>

      <div>
        <label class={labelCls}>
          @ do perfil X linkado a este workspace (opcional)
        </label>
        <div class="flex items-center gap-1">
          <span class="text-sm text-zinc-500">@</span>
          <input
            type="text"
            class={inputCls}
            placeholder="moicdigital"
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
        <div class="mt-1 text-[10px] text-zinc-500">
          handle da conta que faz as replies neste workspace. permite scraping
          de engagement (likes/RTs) pelo admin posteriormente.
        </div>
      </div>

      <details class="group rounded-lg border border-zinc-800 bg-zinc-900/30 open:bg-zinc-900/50">
        <summary class={summaryCls}>
          <span class="inline-block w-2 transition-transform group-open:rotate-90">
            ›
          </span>{" "}
          social graph (node_metrics){graphMeta ? ` - ${graphMeta.handleCount} handles uploaded` : ` - ${bundledGraphSize()} handles bundled`}
        </summary>
        <div class="px-3 pb-3 pt-1">
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
        </div>
      </details>

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
      </div>

      {/* VOZ DO WORKSPACE - bloco prominente. E o que faz as replies deste
          workspace serem distintas das de outros. Pode colar texto livre OU
          carregar de um arquivo .md/.pdf/.txt (extrai o texto pra textarea). */}
      <div class="rounded-lg border border-violet-500/30 bg-violet-500/5 p-2.5">
        <div class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-violet-300">
          voz do workspace
        </div>
        <div class="mb-2 text-[11px] text-zinc-400">
          texto que define a personalidade deste workspace. e o que diferencia
          as replies daqui das de outros workspaces - sem isso, as replies
          ficam genericas. cole abaixo ou carregue de um arquivo.
        </div>

        <div class="mb-2 flex flex-wrap items-center gap-1.5">
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
        <div class="mt-1 text-[10px] text-zinc-500">
          {draft.voice.length} / {MAX_VOICE_CHARS} chars. quanto mais especifico
          (area, referencias, anti-padroes), menos generico fica.
        </div>

        {voiceError && (
          <div class="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
            {voiceError}
          </div>
        )}
      </div>

      {/* COLAPSAVEL: chaves de API e modelo (default: fechado) */}
      <details class="group rounded-lg border border-zinc-800 bg-zinc-900/30 open:bg-zinc-900/50">
        <summary class={summaryCls}>
          <span class="inline-block w-2 transition-transform group-open:rotate-90">
            ›
          </span>{" "}
          chaves de API e modelo
        </summary>
        <div class="flex flex-col gap-3 px-3 pb-3 pt-1">
          <div class="rounded border border-sky-500/30 bg-sky-500/5 px-2 py-1.5 text-[10px] text-sky-200">
            chaves valem pra TODOS os teus workspaces. nao precisa configurar
            por workspace.
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
      </details>

      {/* Filtros e batch - visivel por padrao (sao usados com frequencia). */}
      <div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
        <div class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          filtros e batch
        </div>
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
          </div>

          <div>
            <label class={labelCls}>Teto de tweets por chamada (batch)</label>
            <input
              type="number"
              min={1}
              max={40}
              class={inputCls}
              value={draft.maxBatch}
              onInput={(e) =>
                set(
                  "maxBatch",
                  Math.max(
                    1,
                    Number((e.target as HTMLInputElement).value) || 25
                  )
                )
              }
            />
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

          <label class="flex items-center gap-2 text-sm text-zinc-200">
            <input
              type="checkbox"
              checked={draft.includeUnmapped}
              onChange={(e) =>
                set("includeUnmapped", (e.target as HTMLInputElement).checked)
              }
            />
            Incluir handles fora do grafo ({activeHandleCount} mapeados)
          </label>

          <label class="flex items-center gap-2 text-sm text-zinc-200">
            <input
              type="checkbox"
              checked={draft.dryRun}
              onChange={(e) =>
                set("dryRun", (e.target as HTMLInputElement).checked)
              }
            />
            Dry-run (so filtra os posts, nao chama o LLM)
          </label>
        </div>
      </div>

      <button
        onClick={handleSave}
        class="rounded bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500"
      >
        salvar
      </button>
    </div>
  );
}
