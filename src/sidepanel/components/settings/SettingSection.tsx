// V5.0.4 — Wrapper de bloco em Settings.
//
// Substitui os 2 padroes coexistentes que existiam antes:
//   - <div class="rounded-lg border-{color}/30 bg-{color}/5"> (voz, fontes)
//   - <details><summary class={summaryCls}> (chaves, filtros, prompt, etc)
//
// Padrao unico: <details> semantico + acessivel, com header uniforme,
// tone semantico (violet/emerald/sky/indigo/amber/zinc), badge de canal
// e slot pra help text acima do body.
//
// UX principios (skill /ui-ux-pro-max):
// - Accessibility CRITICAL: <summary> nativo (Tab+Enter funciona),
//   focus ring visivel via focus-visible:ring
// - Progressive disclosure: defaultOpen controlado por prop
// - Whitespace-balance: gap-3 fixo entre header/help/body
// - Style consistency: 1 componente por bloco, sem inline styling

import type { JSX, ComponentChildren } from "preact";
import { createContext } from "preact";
import { useContext } from "preact/hooks";
import { ChannelBadge, type ChannelBadgeKind } from "./ChannelBadge";
import { TONES, type Tone } from "./settingTones";

// V5.2: modo global do Settings — simple esconde blocos advanced=true.
export type SettingsMode = "simple" | "advanced";
export const SettingsModeContext = createContext<SettingsMode>("simple");

interface Props {
  /** Titulo curto do bloco (ex: "Voz do workspace") */
  title: string;
  /** Subtitulo opcional pra distinguir de blocos similares */
  subtitle?: string;
  /** Escopo do bloco — sempre presente pra evitar confusao entre canais */
  channel: ChannelBadgeKind;
  /** Tone semantico visual */
  tone: Tone;
  /** Estado inicial. Bloco essencial expandido, avancado colapsado */
  defaultOpen?: boolean;
  /** Ajuda contextual visivel acima do body — 1-2 frases explicando pra que serve */
  help?: string;
  /** ID pra scroll-to-section (SetupChecklist links) */
  id?: string;
  /** Ordem CSS opcional — mantida enquanto Settings ainda usa flex + order-N */
  order?: number;
  /** Callback opcional quando o details abre/fecha (analytics/telemetria futura) */
  onToggle?: (open: boolean) => void;
  /** V5.1: classes extras (ex: "hidden" quando bloco nao pertence a tab ativa) */
  extraClass?: string;
  /** V5.2: bloco so aparece em modo "avancado" (toggle top-level em Settings). */
  advanced?: boolean;
  children: ComponentChildren;
}

export function SettingSection({
  title,
  subtitle,
  channel,
  tone,
  defaultOpen = false,
  help,
  id,
  order,
  onToggle,
  extraClass,
  advanced,
  children,
}: Props): JSX.Element {
  const t = TONES[tone];
  const orderCls = order !== undefined ? `order-${order}` : "";
  // V5.2: bloco advanced fica hidden em modo simple.
  const mode = useContext(SettingsModeContext);
  const advancedHidden = advanced && mode === "simple" ? "hidden" : "";

  return (
    <details
      id={id}
      open={defaultOpen}
      onToggle={
        onToggle
          ? (e) => onToggle((e.currentTarget as HTMLDetailsElement).open)
          : undefined
      }
      class={`group rounded-lg border ${t.container} ${t.containerOpen} ${orderCls} ${extraClass ?? ""} ${advancedHidden}`}
    >
      <summary
        class="cursor-pointer list-none select-none px-3 py-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-950 focus-visible:ring-sky-500 [&::-webkit-details-marker]:hidden"
      >
        <div class="flex items-center gap-2">
          <span
            class="inline-block w-2 shrink-0 text-zinc-400 transition-transform group-open:rotate-90"
            aria-hidden="true"
          >
            ›
          </span>
          <span class={`text-[11px] font-semibold uppercase tracking-wide ${t.headerText}`}>
            {title}
          </span>
          <ChannelBadge channel={channel} />
          {subtitle && (
            <span class="ml-auto truncate text-[10px] text-zinc-500">
              {subtitle}
            </span>
          )}
        </div>
      </summary>

      <div class={`border-t ${t.divider} px-3 pb-3 pt-2`}>
        {help && (
          <p class={`mb-2.5 text-[11px] leading-snug ${t.helpText}`}>
            {help}
          </p>
        )}
        <div class="flex flex-col gap-3">{children}</div>
      </div>
    </details>
  );
}
