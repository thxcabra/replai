import type { ComponentChildren } from "preact";

type Type = "info" | "success" | "warning" | "error";

interface Props {
  type?: Type;
  children: ComponentChildren;
  // aria-live "polite" (default) ou "assertive" (errors criticos)
  live?: "polite" | "assertive" | "off";
}

const TYPE_CLASSES: Record<Type, string> = {
  info: "border-zinc-700 bg-zinc-800/50 text-zinc-300",
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  error: "border-red-500/40 bg-red-500/10 text-red-300",
};

export function Alert({ type = "info", children, live = "polite" }: Props) {
  return (
    <div
      role={type === "error" ? "alert" : "status"}
      aria-live={live}
      class={[
        "rounded-md border px-3 py-2 text-sm",
        TYPE_CLASSES[type],
      ].join(" ")}
    >
      {children}
    </div>
  );
}
