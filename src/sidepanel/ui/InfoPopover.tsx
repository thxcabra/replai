// V6 — Chip (?) inline pra explicacoes contextuais.
//
// Uso:
//   <InfoPopover short="Bridge = ponte pra chegar no POI." term="Bridge" />
//   {" "} um texto normal
//
// Renderiza um pequeno badge circular (?) ao lado de qualquer termo tecnico.
// Click abre popover flutuante com texto curto + link "Ver mais no Glossario"
// (se `onOpenGlossary` for passado). Popover fecha em clique fora ou Escape.
//
// Design intencional:
// - Nao usa <details>/<summary> — nao permite popover flutuante posicionado.
// - Nao usa Tooltip hover-only — em mobile/touch nao ha hover; e o Sidepanel
//   pode ser usado com trackpad em Chrome, entao click e mais confiavel.
// - z-index alto (50) pra ficar sobre o Header e cards. Body scroll continua.
//
// UX principios (skill /ui-ux-pro-max):
// - discoverability: chip visivel mas nao rui — muted zinc-400
// - a11y: aria-label + Escape close + focus-trap opcional (aqui simples)
// - progressive-disclosure: click reveal, nao empurra ninguem pra fora da tela

import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";

interface Props {
  /** Texto curto (1-2 linhas) mostrado no popover */
  short: string;
  /** Nome do termo — usado no aria-label e pra passar pro handler de "Ver mais" */
  term: string;
  /** Callback opcional pra abrir o Glossario (implementado no Commit 8) */
  onOpenGlossary?: (term: string) => void;
}

export function InfoPopover({
  short,
  term,
  onOpenGlossary,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(t) &&
        triggerRef.current &&
        !triggerRef.current.contains(t)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [open]);

  return (
    <span class="relative inline-flex align-baseline">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Explicar ${term}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        class={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-zinc-700 text-[9px] font-bold leading-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
          open
            ? "border-sky-500 bg-sky-500/20 text-sky-300"
            : "text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
        }`}
      >
        ?
      </button>
      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={`Sobre ${term}`}
          class="absolute left-0 top-5 z-50 w-64 rounded-md border border-zinc-700 bg-zinc-900 p-2.5 text-[11px] leading-snug text-zinc-200 shadow-lg"
        >
          <div class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            {term}
          </div>
          <div class="text-zinc-200">{short}</div>
          {onOpenGlossary && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenGlossary(term);
              }}
              class="mt-1.5 text-[10px] font-medium text-sky-400 hover:text-sky-300"
            >
              Ver mais no glossario →
            </button>
          )}
        </div>
      )}
    </span>
  );
}
