// V6 — Shell reutilizavel de view.
//
// Padroniza sticky-header + body-scroll que MyReplies/Historico/Posts/LinkedInView
// duplicavam com pequenas variacoes. Preserva o padrao de layout mas centraliza:
//
//   - Header sticky top-0 com backdrop-blur
//   - Botao "voltar" (icone) — nao aparece se onBack ausente
//   - Titulo + subtitulo opcional
//   - ChannelBadge (opcional) mostrando escopo
//   - Slot rightSlot pra actions custom
//   - Body com padding lateral consistente + scroll interno
//
// UX principios (skill /ui-ux-pro-max):
// - navigation-affordance: back sempre visivel se disponivel
// - content-hierarchy: title h1, subtitulo caption
// - focus-order: back → titulo → actions → body (natural)

import type { ComponentChildren, JSX } from "preact";
import type { Channel } from "../../lib/channels/types";

interface Props {
  title: string;
  subtitle?: string;
  channel?: Channel;
  onBack?: () => void;
  rightSlot?: ComponentChildren;
  children: ComponentChildren;
}

const CHANNEL_LABEL: Record<Channel, string> = {
  twitter: "X",
  linkedin: "LinkedIn",
};

const CHANNEL_CHIP: Record<Channel, string> = {
  twitter: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  linkedin: "bg-[#0a66c2]/15 text-[#5c9de3] border-[#0a66c2]/30",
};

export function ViewShell({
  title,
  subtitle,
  channel,
  onBack,
  rightSlot,
  children,
}: Props): JSX.Element {
  return (
    <div class="flex h-full min-h-0 flex-col">
      <header class="sticky top-0 z-10 flex items-center gap-2 border-b border-zinc-800/70 bg-zinc-950/85 px-3 py-2 backdrop-blur">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="voltar"
            class="rounded p-1 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M13 15l-5-5 5-5"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        )}
        <div class="min-w-0 flex-1">
          <h1 class="truncate text-sm font-semibold text-zinc-100">{title}</h1>
          {subtitle && (
            <p class="truncate text-[10px] leading-tight text-zinc-500">
              {subtitle}
            </p>
          )}
        </div>
        {channel && (
          <span
            class={`inline-flex items-center rounded border px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide ${CHANNEL_CHIP[channel]}`}
          >
            {CHANNEL_LABEL[channel]}
          </span>
        )}
        {rightSlot && <div class="flex items-center gap-1">{rightSlot}</div>}
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
