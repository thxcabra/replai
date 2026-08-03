// V5 — Upload de bundle Groundswell.
//
// UX principios aplicados:
// - Drop-zone com estado hover/dragover claro (visual state changes)
// - Progress por etapa em vez de barra unica (informativo pra ~5s de upload)
// - Erros inline com recovery path (WCAG error-clarity)
// - Focus visible no botao/input (accessibility)
// - Tabular-nums nos counters (typography rule)

import { useRef, useState } from "preact/hooks";
import { parseBundleZip, summarizeBundle } from "../../../lib/groundswell/bundle-parser";
import { uploadBundle } from "../../../lib/groundswell/storage";
import type { GroundswellBundle } from "../../../lib/channels/types";

interface Props {
  workspaceId: string;
  onUploaded?: (bundleId: string) => void;
}

type UploadState =
  | { kind: "idle" }
  | { kind: "parsing"; filename: string }
  | { kind: "parsed"; bundle: GroundswellBundle; filename: string }
  | { kind: "uploading"; step: string; done: number; total: number }
  | { kind: "success"; bundleId: string; summary: ReturnType<typeof summarizeBundle> }
  | { kind: "error"; message: string; recoverable: boolean };

export function BundleUpload({ workspaceId, onUploaded }: Props) {
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);
  // V5.1: nome da "lista" configurado no parsed state antes do confirmar upload.
  // Default: workspace_slug do bundle. User pode editar antes de confirmar.
  const [listName, setListName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    // Validacao rapida antes de tentar parse
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setState({
        kind: "error",
        message: "Arquivo tem que ser um .zip do bundle Groundswell.",
        recoverable: true,
      });
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setState({
        kind: "error",
        message: "Bundle acima de 50MB. Confere se e o zip correto (bundle exemplo ~5MB).",
        recoverable: true,
      });
      return;
    }
    setState({ kind: "parsing", filename: file.name });
    try {
      const bundle = await parseBundleZip(file, "linkedin");
      // V5.1: pre-preenche o nome da lista com o workspace_slug do bundle
      setListName(bundle.workspace_slug?.trim() || "Lista principal");
      setState({ kind: "parsed", bundle, filename: file.name });
    } catch (e) {
      setState({
        kind: "error",
        message: `Nao consegui ler o bundle: ${(e as Error).message}`,
        recoverable: true,
      });
    }
  }

  async function handleConfirm() {
    if (state.kind !== "parsed") return;
    const bundle = state.bundle;
    setState({ kind: "uploading", step: "iniciando", done: 0, total: 6 });
    try {
      const bundleId = await uploadBundle(bundle, {
        workspaceId,
        channel: "linkedin",
        name: listName.trim() || undefined,
        onProgress: (step, done, total) => {
          setState({ kind: "uploading", step, done, total });
        },
      });
      setState({
        kind: "success",
        bundleId,
        summary: summarizeBundle(bundle),
      });
      onUploaded?.(bundleId);
    } catch (e) {
      setState({
        kind: "error",
        message: `Falha ao salvar no cloud: ${(e as Error).message}`,
        recoverable: true,
      });
    }
  }

  function handleReset() {
    setState({ kind: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }

  // ============================================================================
  // Estados: idle / parsing / parsed / uploading / success / error
  // ============================================================================

  if (state.kind === "success") {
    return (
      <div class="rounded border border-emerald-800/60 bg-emerald-950/30 px-3 py-2.5">
        <div class="mb-2 flex items-center gap-2">
          <span
            aria-hidden="true"
            class="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white"
          >
            ✓
          </span>
          <div class="text-xs font-semibold text-emerald-200">
            bundle carregado
          </div>
        </div>
        <div class="mb-2 grid grid-cols-3 gap-2 font-mono text-[10px] tabular-nums">
          <StatCell label="perfis" value={state.summary.n_profiles} />
          <StatCell label="pessoas-alvo" value={state.summary.n_pois} />
          <StatCell label="conexoes" value={state.summary.n_bridges_ready} suffix={`/${state.summary.n_bridges}`} />
          <StatCell label="relacoes" value={state.summary.n_relationships} />
          <StatCell label="interacoes" value={state.summary.n_interactions} />
        </div>
        <button
          onClick={handleReset}
          class="text-[10px] text-emerald-300 underline underline-offset-2 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 focus:ring-offset-emerald-950"
        >
          subir outro bundle
        </button>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div class="rounded border border-red-800/60 bg-red-950/30 px-3 py-2.5">
        <div class="mb-1.5 text-[11px] font-semibold text-red-200">
          erro no upload
        </div>
        <p class="mb-2 text-xs leading-relaxed text-red-100/85">
          {state.message}
        </p>
        {state.recoverable && (
          <button
            onClick={handleReset}
            class="rounded border border-red-700 bg-red-900/40 px-2 py-1 text-[10px] font-medium text-red-100 hover:bg-red-800/60 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-red-950"
          >
            tentar de novo
          </button>
        )}
      </div>
    );
  }

  if (state.kind === "parsed") {
    const s = summarizeBundle(state.bundle);
    return (
      <div class="rounded border border-zinc-700 bg-zinc-900 px-3 py-2.5">
        <div class="mb-2 flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="truncate text-xs font-semibold text-zinc-200">
              {state.bundle.workspace_slug}
            </div>
            <div class="truncate text-[10px] text-zinc-500">
              {state.filename} · gerado {state.bundle.delivery_date}
            </div>
          </div>
        </div>
        <div class="mb-3 grid grid-cols-3 gap-x-3 gap-y-1.5 font-mono text-[10px] tabular-nums">
          <StatCell label="perfis" value={s.n_profiles} />
          <StatCell label="pessoas-alvo" value={s.n_pois} />
          <StatCell
            label="conexoes prontas"
            value={s.n_bridges_ready}
            suffix={`/${s.n_bridges}`}
          />
          <StatCell label="relacoes" value={s.n_relationships} />
          <StatCell label="interacoes" value={s.n_interactions} />
          <StatCell
            label="ultimo engaj."
            value={0}
            display={state.bundle.latest_engagement_date}
          />
        </div>
        {/* V5.1: nome da lista — apresentado no dropdown Header pra alternar. */}
        <div class="mb-3">
          <label class="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            nome da lista
          </label>
          <input
            type="text"
            value={listName}
            onInput={(e) => setListName((e.target as HTMLInputElement).value)}
            placeholder="ex: ICP-Brasil, ICP-LatAm, Q3-cohort"
            maxLength={80}
            class="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-sky-500"
          />
          <p class="mt-1 text-[10px] text-zinc-500">
            aparece no dropdown do Header pra alternar entre listas. default: workspace_slug.
          </p>
        </div>
        <div class="flex gap-1.5">
          <button
            onClick={handleConfirm}
            class="rounded bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-1 focus:ring-offset-zinc-900"
          >
            confirmar upload
          </button>
          <button
            onClick={handleReset}
            class="rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-1 focus:ring-offset-zinc-900"
          >
            cancelar
          </button>
        </div>
      </div>
    );
  }

  if (state.kind === "uploading" || state.kind === "parsing") {
    const isUp = state.kind === "uploading";
    return (
      <div class="rounded border border-sky-800/60 bg-sky-950/20 px-3 py-2.5">
        <div class="mb-2 flex items-center gap-2">
          <span
            aria-hidden="true"
            class="h-3 w-3 animate-spin rounded-full border-2 border-sky-500 border-t-transparent"
          />
          <div class="text-xs font-medium text-sky-200">
            {isUp ? `carregando ${state.step}…` : "lendo arquivo…"}
          </div>
        </div>
        {isUp && (
          <div class="space-y-1">
            <div
              role="progressbar"
              aria-valuenow={state.done}
              aria-valuemin={0}
              aria-valuemax={state.total}
              class="h-1 overflow-hidden rounded-full bg-zinc-800"
            >
              <div
                class="h-full rounded-full bg-sky-500 transition-[width] duration-200"
                style={`width: ${Math.round((state.done / Math.max(state.total, 1)) * 100)}%`}
              />
            </div>
            <div class="flex justify-between font-mono text-[9.5px] tabular-nums text-sky-300/70">
              <span>{state.step}</span>
              <span>
                {state.done.toLocaleString("pt-BR")} de{" "}
                {state.total.toLocaleString("pt-BR")}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // idle
  return (
    <label
      class={`flex cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed px-3 py-4 text-center transition-colors focus-within:ring-2 focus-within:ring-sky-500 focus-within:ring-offset-1 focus-within:ring-offset-zinc-950 ${
        dragOver
          ? "border-sky-500 bg-sky-950/20"
          : "border-zinc-700 bg-zinc-900/40 hover:border-zinc-600 hover:bg-zinc-900/60"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer?.files?.[0];
        if (file) handleFile(file);
      }}
    >
      <span aria-hidden="true" class="mb-1 text-lg text-zinc-500">
        ↑
      </span>
      <div class="text-xs font-medium text-zinc-200">
        arrasta o bundle Groundswell aqui
      </div>
      <div class="mt-0.5 text-[10px] text-zinc-500">
        .zip · ate 50MB · ou{" "}
        <span class="text-sky-400 underline underline-offset-2">
          escolhe arquivo
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        class="sr-only"
        onChange={(e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (file) handleFile(file);
        }}
      />
    </label>
  );
}

function StatCell({
  label,
  value,
  suffix,
  display,
}: {
  label: string;
  value: number;
  suffix?: string;
  display?: string;
}) {
  return (
    <div>
      <div class="text-zinc-500">{label}</div>
      <div class="text-zinc-200">
        {display ?? value.toLocaleString("pt-BR")}
        {suffix && <span class="text-zinc-500">{suffix}</span>}
      </div>
    </div>
  );
}
