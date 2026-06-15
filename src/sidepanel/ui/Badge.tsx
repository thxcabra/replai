import type { ComponentChildren } from "preact";

type Variant =
  | "default"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "special"
  | "muted";

interface Props {
  variant?: Variant;
  children: ComponentChildren;
  title?: string;
  class?: string;
}

const VARIANT: Record<Variant, string> = {
  default: "bg-zinc-700/60 text-zinc-200",
  accent: "bg-sky-500/15 text-sky-300",
  success: "bg-emerald-500/20 text-emerald-300",
  warning: "bg-amber-500/20 text-amber-300",
  danger: "bg-red-500/20 text-red-300",
  special: "bg-violet-500/20 text-violet-300",
  muted: "bg-zinc-600/40 text-zinc-400",
};

export function Badge({
  variant = "default",
  children,
  title,
  class: cls,
}: Props) {
  return (
    <span
      title={title}
      class={[
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        VARIANT[variant],
        cls ?? "",
      ].join(" ")}
    >
      {children}
    </span>
  );
}
