// V6 — Seletor de canal ativo (X | LinkedIn).
//
// Simetria conceitual: ambos canais recebem insumos Groundswell, ambos
// geram replies em posts das Bridges pra impactar POIs. A UI reflete essa
// simetria com chips iguais — trocar de canal muda o contexto (Triage/
// Historico/Analytics passam a mostrar dados do canal selecionado).
//
// Nao renderiza qualquer estado condicional — puramente controlado por prop.
// Callers persistem `channel` em App state (proxima to workspace).

import type { JSX } from "preact";
import type { Channel } from "../../lib/channels/types";
import { ChannelIcon } from "./ChannelIcon";

interface Props {
  value: Channel;
  onChange: (channel: Channel) => void;
  /** Desabilita clique (durante loading de refresh cross-canal, por ex.) */
  disabled?: boolean;
}

const CHIPS: Array<{ id: Channel; label: string; activeCls: string; idleCls: string }> = [
  {
    id: "twitter",
    label: "X",
    activeCls: "border-sky-500 bg-sky-500/15 text-sky-200",
    idleCls: "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    activeCls: "border-[#0a66c2] bg-[#0a66c2]/15 text-[#7fb3ea]",
    idleCls: "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300",
  },
];

export function ChannelSwitcher({
  value,
  onChange,
  disabled = false,
}: Props): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="canal ativo"
      class="inline-flex items-center gap-1"
    >
      {CHIPS.map((c) => {
        const active = c.id === value;
        return (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={c.label}
            disabled={disabled}
            onClick={() => onChange(c.id)}
            class={`inline-flex h-6 items-center gap-1 rounded border px-2 text-[11px] font-semibold uppercase tracking-wide transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-40 ${
              active ? c.activeCls : c.idleCls
            }`}
          >
            {/* V5.2: icone SVG do canal ao lado do label. */}
            <ChannelIcon channel={c.id} size={11} />
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
