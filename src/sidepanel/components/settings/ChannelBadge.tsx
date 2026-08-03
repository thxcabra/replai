// V5.0.4 — Badge de canal em cada bloco de Settings.
//
// Sinaliza escopo do bloco pra evitar confusao "isso vale pro LinkedIn?":
// - "x": X-only (ex: Listas, filtros de triagem, social graph)
// - "li": LinkedIn-only (ex: Bundle Groundswell, voz LI, rate limits)
// - "both": vale pra ambos canais (ex: Voz workspace, chaves API)
// - "meta": nao e canal (ex: workspace admin)

import type { JSX } from "preact";

export type ChannelBadgeKind = "x" | "li" | "both" | "meta";

interface Props {
  channel: ChannelBadgeKind;
  /** Force text uppercase — default true; false pra usar dentro de summary sem transform */
  uppercase?: boolean;
}

const LABEL: Record<ChannelBadgeKind, string> = {
  x: "X",
  li: "LinkedIn",
  both: "ambos",
  meta: "workspace",
};

const CLASSES: Record<ChannelBadgeKind, string> = {
  x: "border-sky-500/40 bg-sky-500/10 text-sky-200",
  li: "border-indigo-500/40 bg-indigo-500/10 text-indigo-200",
  both: "border-violet-500/40 bg-violet-500/10 text-violet-200",
  meta: "border-zinc-600 bg-zinc-800/60 text-zinc-300",
};

export function ChannelBadge({
  channel,
  uppercase = true,
}: Props): JSX.Element {
  return (
    <span
      class={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium tracking-wide ${
        uppercase ? "uppercase" : ""
      } ${CLASSES[channel]}`}
      aria-label={`Bloco aplicavel a: ${LABEL[channel]}`}
    >
      {LABEL[channel]}
    </span>
  );
}
