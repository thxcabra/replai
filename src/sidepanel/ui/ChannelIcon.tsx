// V5.2 — Icones SVG dos canais X e LinkedIn.
//
// Substitui texto "X" / "LINKEDIN" nos chips do ChannelSwitcher e serve como
// marcador periferico no Header (ao lado do workspace select).
//
// Uso: <ChannelIcon channel="x" size={14} />

interface Props {
  channel: "twitter" | "linkedin";
  size?: number;
  className?: string;
  title?: string;
}

export function ChannelIcon({ channel, size = 14, className = "", title }: Props) {
  const s = size;
  if (channel === "linkedin") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={s}
        height={s}
        class={className}
        aria-label={title ?? "LinkedIn"}
        role="img"
      >
        <path
          fill="currentColor"
          d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2ZM8.5 18.5h-3v-9h3v9Zm-1.5-10.3a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4Zm12 10.3h-3v-4.5c0-1.1 0-2.5-1.5-2.5s-1.75 1.2-1.75 2.4v4.6h-3v-9h2.9v1.2h.05c.4-.75 1.4-1.55 2.85-1.55 3.05 0 3.6 2 3.6 4.6v4.75Z"
        />
      </svg>
    );
  }
  // X (twitter)
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={s}
      height={s}
      class={className}
      aria-label={title ?? "X"}
      role="img"
    >
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117Z"
      />
    </svg>
  );
}
