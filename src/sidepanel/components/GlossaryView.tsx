// V6 — Tela dedicada com todos os termos tecnicos do Replai.
//
// Aberta via botao (?) do Header ou via link "Ver mais no glossario" nos
// popovers InfoPopover espalhados pela app.
//
// Estrutura:
//   - Header ViewShell com back + titulo
//   - Busca fuzzy (contains case-insensitive) sobre termos + short
//   - Lista de entries, cada uma expandivel via <details> nativo
//   - Termos relacionados (`related`) viram chips clicaveis que fazem scroll
//     ate o entry correspondente
//
// Nao usa router — tudo controlado por App state (view === "glossary").

import { useMemo, useState } from "preact/hooks";
import type { JSX } from "preact";
import { GLOSSARY } from "../../lib/glossary";
import { ViewShell } from "../ui/ViewShell";

interface Props {
  onBack: () => void;
  /** Termo pra abrir expandido no boot (via ?term=X do popover) */
  focusTerm?: string;
}

export function GlossaryView({ onBack, focusTerm }: Props): JSX.Element {
  const [query, setQuery] = useState("");

  const entries = useMemo(() => Object.entries(GLOSSARY), []);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(([term, e]) => {
      return (
        term.toLowerCase().includes(q) ||
        e.short.toLowerCase().includes(q) ||
        e.long.toLowerCase().includes(q)
      );
    });
  }, [entries, query]);

  function jumpTo(term: string) {
    const el = document.getElementById(`glossary-${term}`);
    if (!el) return;
    if (el instanceof HTMLDetailsElement && !el.open) el.open = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <ViewShell title="Glossario" onBack={onBack} subtitle={`${entries.length} termos`}>
      <div class="flex flex-col gap-2 p-3">
        <input
          type="search"
          placeholder="buscar termo, ex: POI, Bridge, ISV..."
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          class="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none"
        />
        {filtered.length === 0 && (
          <div class="rounded border border-zinc-800 bg-zinc-900/40 p-3 text-center text-xs text-zinc-500">
            nenhum termo bate com "{query}"
          </div>
        )}
        <ul class="flex flex-col gap-1.5">
          {filtered.map(([term, entry]) => (
            <li key={term}>
              <details
                id={`glossary-${term}`}
                open={focusTerm === term}
                class="group rounded border border-zinc-800 bg-zinc-900/40 open:bg-zinc-900/60"
              >
                <summary class="cursor-pointer list-none px-2.5 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 [&::-webkit-details-marker]:hidden">
                  <div class="flex items-baseline gap-2">
                    <span
                      aria-hidden="true"
                      class="text-[10px] text-zinc-500 transition-transform group-open:rotate-90"
                    >
                      ›
                    </span>
                    <span class="text-xs font-semibold text-zinc-100">
                      {term}
                    </span>
                    <span class="min-w-0 flex-1 truncate text-[10px] text-zinc-500">
                      {entry.short}
                    </span>
                  </div>
                </summary>
                <div class="border-t border-zinc-800 px-2.5 py-2 text-[11px] leading-relaxed text-zinc-300">
                  {entry.long.split("\n\n").map((para, i) => (
                    <p key={i} class="mb-2 whitespace-pre-line last:mb-0">
                      {para}
                    </p>
                  ))}
                  {entry.related && entry.related.length > 0 && (
                    <div class="mt-2 flex flex-wrap items-center gap-1.5 border-t border-zinc-800 pt-2">
                      <span class="text-[9px] uppercase tracking-wide text-zinc-500">
                        Ver tambem:
                      </span>
                      {entry.related.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => jumpTo(r)}
                          class="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-[1px] text-[10px] text-sky-400 hover:border-sky-500 hover:bg-sky-500/10 hover:text-sky-300"
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </ViewShell>
  );
}
