import type { JSX } from "preact";

// Preact's JSX.HTMLAttributes doesn't expose value/type pra extends. Pegamos
// direto de IntrinsicElements pra cobrir todos atributos HTML nativos.
type RawInput = JSX.IntrinsicElements["input"];
type RawTextarea = JSX.IntrinsicElements["textarea"];
type RawSelect = JSX.IntrinsicElements["select"];

interface InputProps extends RawInput {
  label?: string;
  error?: string;
  hint?: string;
}

const BASE =
  "w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 outline-none transition-colors hover:border-zinc-600 focus:border-sky-500 disabled:opacity-50";

export function Input(props: InputProps) {
  const { label, error, hint, class: cls, className, ...rest } = props;
  return (
    <div class="flex flex-col gap-1">
      {label && (
        <label class="text-xs font-medium text-zinc-400">{label}</label>
      )}
      <input
        class={[BASE, error ? "border-red-500" : "", cls ?? className ?? ""].join(
          " "
        )}
        {...rest}
      />
      {error && <span class="text-[11px] text-red-400">{error}</span>}
      {hint && !error && <span class="text-[10px] text-zinc-500">{hint}</span>}
    </div>
  );
}

interface TextareaProps extends RawTextarea {
  label?: string;
  error?: string;
  hint?: string;
}

export function Textarea(props: TextareaProps) {
  const { label, error, hint, class: cls, className, ...rest } = props;
  return (
    <div class="flex flex-col gap-1">
      {label && (
        <label class="text-xs font-medium text-zinc-400">{label}</label>
      )}
      <textarea
        class={[
          BASE,
          "resize-y leading-snug",
          error ? "border-red-500" : "",
          cls ?? className ?? "",
        ].join(" ")}
        {...rest}
      />
      {error && <span class="text-[11px] text-red-400">{error}</span>}
      {hint && !error && <span class="text-[10px] text-zinc-500">{hint}</span>}
    </div>
  );
}

interface SelectProps extends RawSelect {
  label?: string;
  error?: string;
}

export function Select(props: SelectProps) {
  const { label, error, class: cls, className, children, ...rest } = props;
  return (
    <div class="flex flex-col gap-1">
      {label && (
        <label class="text-xs font-medium text-zinc-400">{label}</label>
      )}
      <select
        class={[BASE, error ? "border-red-500" : "", cls ?? className ?? ""].join(
          " "
        )}
        {...rest}
      >
        {children}
      </select>
      {error && <span class="text-[11px] text-red-400">{error}</span>}
    </div>
  );
}
