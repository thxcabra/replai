import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";

interface Props {
  children: ComponentChildren;
  onLike: () => void;
  onSkip: () => void;
  // teclado: setas funcionam globalmente quando o card esta visivel
  enableKeyboard?: boolean;
}

const SWIPE_THRESHOLD = 80; // px de drag pra disparar like/skip
const EXIT_DISTANCE = 600;  // distancia pra animacao de saida

// Card swipe estilo Tinder. Suporta pointer events (mouse + touch via Pointer
// Events API) e atalhos de teclado (setas). Animacao com CSS transform.
export function SwipeCard({ children, onLike, onSkip, enableKeyboard = true }: Props) {
  const [x, setX] = useState(0);
  const [rot, setRot] = useState(0);
  const [exiting, setExiting] = useState<null | "left" | "right">(null);
  const dragging = useRef(false);
  const startX = useRef(0);
  const ref = useRef<HTMLDivElement | null>(null);

  function commitLike() {
    if (exiting) return;
    setExiting("right");
    setX(EXIT_DISTANCE);
    setRot(20);
    setTimeout(() => onLike(), 250);
  }

  function commitSkip() {
    if (exiting) return;
    setExiting("left");
    setX(-EXIT_DISTANCE);
    setRot(-20);
    setTimeout(() => onSkip(), 250);
  }

  function onPointerDown(e: PointerEvent) {
    if (exiting) return;
    dragging.current = true;
    startX.current = e.clientX;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging.current || exiting) return;
    const dx = e.clientX - startX.current;
    setX(dx);
    setRot(dx / 25);
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (x > SWIPE_THRESHOLD) {
      commitLike();
    } else if (x < -SWIPE_THRESHOLD) {
      commitSkip();
    } else {
      // snap back
      setX(0);
      setRot(0);
    }
  }

  // teclado global: setas pra navegar
  useEffect(() => {
    if (!enableKeyboard) return;
    function onKey(e: KeyboardEvent) {
      // ignora se foco esta em input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        commitLike();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        commitSkip();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableKeyboard, exiting]);

  const transition =
    dragging.current && !exiting
      ? "none"
      : "transform 0.25s cubic-bezier(.2,.8,.2,1), opacity 0.25s";

  const opacity = exiting ? 0 : Math.max(0.3, 1 - Math.abs(x) / 700);

  // intensidade da camada de like/skip que aparece sobre o card durante drag
  const likeOpacity = Math.max(0, Math.min(1, x / SWIPE_THRESHOLD));
  const skipOpacity = Math.max(0, Math.min(1, -x / SWIPE_THRESHOLD));

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      class="relative select-none touch-pan-y"
      style={{
        transform: `translateX(${x}px) rotate(${rot}deg)`,
        opacity,
        transition,
        cursor: dragging.current ? "grabbing" : "grab",
      }}
    >
      {children}

      {/* overlay LIKE (verde) sobre o card quando draga pra direita */}
      <div
        class="pointer-events-none absolute left-4 top-4 rotate-[-15deg] rounded border-4 border-emerald-400 bg-emerald-500/10 px-2 py-1 text-base font-extrabold uppercase tracking-wider text-emerald-300"
        style={{ opacity: likeOpacity }}
      >
        like
      </div>

      {/* overlay SKIP (vermelho) sobre o card quando draga pra esquerda */}
      <div
        class="pointer-events-none absolute right-4 top-4 rotate-[15deg] rounded border-4 border-red-400 bg-red-500/10 px-2 py-1 text-base font-extrabold uppercase tracking-wider text-red-300"
        style={{ opacity: skipOpacity }}
      >
        skip
      </div>
    </div>
  );
}
