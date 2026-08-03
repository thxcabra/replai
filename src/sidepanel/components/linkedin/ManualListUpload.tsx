// V5.2 — Upload de lista MANUAL LinkedIn (CSV padrão ICP).
//
// Coexiste com BundleUpload (bundles Groundswell completos). Mesma UI shell,
// mas parse muito mais simples e chama `uploadManualList` (nao `uploadBundle`).
//
// CSV esperado:
//   empresa,cargo,nome,linkedin

import { useRef, useState } from "preact/hooks";
import {
  MANUAL_LIST_CSV_HEADERS,
  parseManualListCsv,
} from "../../../lib/groundswell/manual-list-csv";
import { uploadManualList, type ManualListRow } from "../../../lib/groundswell/storage";

interface Props {
  workspaceId: string;
  onUploaded?: (bundleId: string) => void;
}

type State =
  | { kind: "idle" }
  | { kind: "parsed"; rows: ManualListRow[]; filename: string }
  | { kind: "uploading" }
  | { kind: "success"; count: number }
  | { kind: "error"; message: string };

export function ManualListUpload({ workspaceId, onUploaded }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [listName, setListName] = useState("");
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setState({ kind: "error", message: "Arquivo tem que ser .csv." });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setState({
        kind: "error",
        message: "CSV acima de 5MB. Muito grande — divide em listas menores.",
      });
      return;
    }
    try {
      const text = await file.text();
      const { rows, errors } = parseManualListCsv(text);
      if (rows.length === 0) {
        setState({
          kind: "error",
          message:
            errors[0] ??
            `Nenhuma linha válida. Use as colunas: ${MANUAL_LIST_CSV_HEADERS.join(", ")}`,
        });
        return;
      }
      setParseErrors(errors);
      setListName(file.name.replace(/\.csv$/i, ""));
      setState({ kind: "parsed", rows, filename: file.name });
    } catch (e) {
      setState({
        kind: "error",
        message: `Falha ao ler arquivo: ${(e as Error).message}`,
      });
    }
  }

  async function handleConfirm() {
    if (state.kind !== "parsed") return;
    setState({ kind: "uploading" });
    try {
      const bundleId = await uploadManualList(state.rows, {
        workspaceId,
        name: listName.trim() || "Lista manual",
      });
      setState({ kind: "success", count: state.rows.length });
      onUploaded?.(bundleId);
    } catch (e) {
      setState({
        kind: "error",
        message: `Falha ao salvar: ${(e as Error).message}`,
      });
    }
  }

  function handleReset() {
    setState({ kind: "idle" });
    setParseErrors([]);
    setListName("");
    if (inputRef.current) inputRef.current.value = "";
  }

  if (state.kind === "success") {
    return (
      <div class="rounded border border-emerald-800/60 bg-emerald-950/30 px-3 py-2.5">
        <div class="mb-1 text-xs font-semibold text-emerald-200">
          ✓ lista manual criada
        </div>
        <p class="text-[10px] text-emerald-300/80">
          {state.count} perfil(is) adicionados. Aparece agora no dropdown do Header.
        </p>
        <button
          onClick={handleReset}
          class="mt-2 text-[10px] text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
        >
          criar outra
        </button>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div class="rounded border border-red-800/60 bg-red-950/30 px-3 py-2.5">
        <div class="mb-1 text-[11px] font-semibold text-red-200">
          erro no upload
        </div>
        <p class="mb-2 text-xs leading-relaxed text-red-100/85">
          {state.message}
        </p>
        <button
          onClick={handleReset}
          class="rounded border border-red-700 bg-red-900/40 px-2 py-1 text-[10px] font-medium text-red-100 hover:bg-red-800/60"
        >
          tentar de novo
        </button>
      </div>
    );
  }

  if (state.kind === "parsed") {
    return (
      <div class="rounded border border-zinc-700 bg-zinc-900 px-3 py-2.5">
        <div class="mb-2 flex items-baseline justify-between gap-2">
          <div class="min-w-0">
            <div class="truncate text-xs font-semibold text-zinc-200">
              {state.filename}
            </div>
            <div class="text-[10px] text-zinc-500">
              {state.rows.length} perfil(is) parseados
              {parseErrors.length > 0
                ? ` — ${parseErrors.length} linhas ignoradas`
                : ""}
            </div>
            <div class="mt-0.5 text-[10px] text-zinc-500">
              {state.rows.length} links → Apify · dados do perfil → LLM
            </div>
          </div>
        </div>
        {parseErrors.length > 0 && (
          <details class="mb-2 rounded border border-amber-900/40 bg-amber-950/20 text-[10px]">
            <summary class="cursor-pointer px-2 py-1 text-amber-300">
              ver linhas ignoradas ({parseErrors.length})
            </summary>
            <ul class="max-h-32 overflow-y-auto border-t border-amber-900/40 px-2 py-1 text-amber-200/80">
              {parseErrors.slice(0, 20).map((e) => (
                <li>{e}</li>
              ))}
              {parseErrors.length > 20 && (
                <li>... e mais {parseErrors.length - 20}</li>
              )}
            </ul>
          </details>
        )}
        <div class="mb-2">
          <label class="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            nome da lista
          </label>
          <input
            type="text"
            value={listName}
            onInput={(e) => setListName((e.target as HTMLInputElement).value)}
            placeholder="ex: Prospects Q1, ICP-Brasil, contas frias"
            maxLength={80}
            class="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-sky-500"
          />
        </div>
        <div class="flex gap-1.5">
          <button
            onClick={handleConfirm}
            class="rounded bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-500"
          >
            criar lista manual
          </button>
          <button
            onClick={handleReset}
            class="rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
          >
            cancelar
          </button>
        </div>
      </div>
    );
  }

  if (state.kind === "uploading") {
    return (
      <div class="rounded border border-sky-800/60 bg-sky-950/20 px-3 py-2.5 text-xs text-sky-200">
        criando lista manual...
      </div>
    );
  }

  // idle
  return (
    <div class="rounded border border-dashed border-zinc-700 bg-zinc-900/40 px-3 py-4">
      <p class="mb-2 text-[11px] leading-snug text-zinc-400">
        CSV padrão com estas colunas, nesta ordem:
      </p>
      <div class="mb-2 rounded border border-zinc-800 bg-zinc-950/50 px-2 py-1.5 text-[10px] leading-relaxed text-zinc-400">
        <div>
          <span class="text-violet-300">LLM:</span> empresa, cargo e nome
        </div>
        <div>
          <span class="text-sky-300">Apify:</span> linkedin
        </div>
      </div>
      <p class="mb-2 break-words font-mono text-[9px] leading-relaxed text-zinc-500">
        {MANUAL_LIST_CSV_HEADERS.join(",")}
      </p>
      <div class="flex items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          class="rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800"
        >
          escolher CSV
        </button>
        <span class="text-[10px] text-zinc-500">max 5MB, ~200 linhas</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        class="hidden"
        onChange={(e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (f) handleFile(f);
          (e.target as HTMLInputElement).value = "";
        }}
      />
    </div>
  );
}
