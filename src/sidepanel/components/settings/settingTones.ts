// V5.0.4 — Design tokens dos blocos de Settings.
//
// Cada bloco tem um "tone" semantico:
// - violet: voz do workspace (personalidade primaria)
// - emerald: essenciais (chaves API + provider) — precisam estar OK pra rodar
// - sky: canal X
// - indigo: canal LinkedIn (Groundswell)
// - amber: avancado / alerta (prompt base custom)
// - zinc: neutro / meta (admin do workspace)
//
// Classes Tailwind pre-compostas pra evitar concat dinamica que a build
// nao consegue tree-shake. Cada valor e uma string literal completa.

export type Tone =
  | "violet"
  | "emerald"
  | "sky"
  | "indigo"
  | "amber"
  | "zinc";

export interface ToneClasses {
  /** Card border + fundo base */
  container: string;
  /** Fundo quando expandido (`open:` no details) */
  containerOpen: string;
  /** Cor do titulo do bloco */
  headerText: string;
  /** Cor do help text no bloco */
  helpText: string;
  /** Cor do border-b entre header e body */
  divider: string;
}

export const TONES: Record<Tone, ToneClasses> = {
  violet: {
    container: "border-violet-500/30 bg-violet-500/5",
    containerOpen: "open:bg-violet-500/10",
    headerText: "text-violet-300",
    helpText: "text-violet-200/80",
    divider: "border-violet-500/20",
  },
  emerald: {
    container: "border-emerald-500/30 bg-emerald-500/5",
    containerOpen: "open:bg-emerald-500/10",
    headerText: "text-emerald-300",
    helpText: "text-emerald-200/80",
    divider: "border-emerald-500/20",
  },
  sky: {
    container: "border-sky-500/30 bg-sky-500/5",
    containerOpen: "open:bg-sky-500/10",
    headerText: "text-sky-300",
    helpText: "text-sky-200/80",
    divider: "border-sky-500/20",
  },
  indigo: {
    container: "border-indigo-500/30 bg-indigo-500/5",
    containerOpen: "open:bg-indigo-500/10",
    headerText: "text-indigo-300",
    helpText: "text-indigo-200/80",
    divider: "border-indigo-500/20",
  },
  amber: {
    container: "border-amber-500/30 bg-amber-500/5",
    containerOpen: "open:bg-amber-500/10",
    headerText: "text-amber-300",
    helpText: "text-amber-200/80",
    divider: "border-amber-500/20",
  },
  zinc: {
    container: "border-zinc-700/60 bg-zinc-900/30",
    containerOpen: "open:bg-zinc-900/50",
    headerText: "text-zinc-300",
    helpText: "text-zinc-400",
    divider: "border-zinc-700/60",
  },
};
