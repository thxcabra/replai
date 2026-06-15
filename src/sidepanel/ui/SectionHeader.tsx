import type { ComponentChildren } from "preact";

interface Props {
  children: ComponentChildren;
  hint?: string;
  action?: ComponentChildren;
}

// Cabecalho de secao reusavel. Substitui ~12 ocorrencias de
// "text-[10px] font-semibold uppercase tracking-wide text-zinc-500".
export function SectionHeader({ children, hint, action }: Props) {
  return (
    <div class="mb-2 flex items-center justify-between gap-2">
      <div class="flex flex-col">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          {children}
        </div>
        {hint && <div class="mt-0.5 text-[11px] text-zinc-400">{hint}</div>}
      </div>
      {action}
    </div>
  );
}
