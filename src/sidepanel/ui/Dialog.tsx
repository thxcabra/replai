import { useEffect, useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ComponentChildren;
  // largura max em px (default 480). Mobile sempre full-width.
  maxWidth?: number;
}

// Dialog acessivel: role="dialog", aria-modal, aria-labelledby/describedby,
// Esc fecha, click no backdrop fecha. Focus trap basico (foca primeiro botao
// dentro ao abrir, restaura foco no caller ao fechar).
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  maxWidth = 480,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    lastFocus.current = document.activeElement as HTMLElement | null;
    // foca o primeiro tabbable do dialog
    requestAnimationFrame(() => {
      const first = ref.current?.querySelector<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
      );
      first?.focus();
    });
    return () => {
      lastFocus.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby={description ? "dialog-desc" : undefined}
        class="w-full rounded-t-xl border-t border-zinc-700 bg-zinc-900 shadow-xl sm:rounded-xl sm:border"
        style={{ maxWidth: `${maxWidth}px` }}
      >
        <div class="p-4">
          <h3
            id="dialog-title"
            class="text-sm font-semibold text-zinc-100"
          >
            {title}
          </h3>
          {description && (
            <p id="dialog-desc" class="mt-1 text-[11px] text-zinc-400">
              {description}
            </p>
          )}
          <div class="mt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}
