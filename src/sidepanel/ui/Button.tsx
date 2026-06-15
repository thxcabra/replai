import type { ComponentChildren, JSX } from "preact";

type Variant = "primary" | "ghost" | "danger" | "subtle" | "success";
type Size = "sm" | "md";

interface Props extends Omit<JSX.HTMLAttributes<HTMLButtonElement>, "size"> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
  children: ComponentChildren;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-sky-600 text-white hover:bg-sky-500 active:bg-sky-700 disabled:bg-sky-900 disabled:text-sky-300",
  ghost:
    "border border-zinc-700 text-zinc-200 hover:bg-zinc-800 active:bg-zinc-700 disabled:opacity-50",
  danger:
    "bg-red-600 text-white hover:bg-red-500 active:bg-red-700 disabled:opacity-50",
  subtle:
    "text-zinc-300 hover:bg-zinc-800 active:bg-zinc-700 disabled:opacity-50",
  success:
    "bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
};

export function Button({
  variant = "ghost",
  size = "md",
  loading = false,
  fullWidth = false,
  disabled,
  children,
  class: cls,
  className,
  ...rest
}: Props) {
  const isDisabled = disabled || loading;
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded font-medium transition-colors disabled:cursor-not-allowed";
  return (
    <button
      type="button"
      disabled={isDisabled}
      class={[
        base,
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        fullWidth ? "w-full" : "",
        cls ?? className ?? "",
      ].join(" ")}
      {...rest}
    >
      {loading ? "..." : children}
    </button>
  );
}
