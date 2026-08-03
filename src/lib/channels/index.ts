// V5 — Channel registry.
//
// Import unico: `import { getChannel } from "@/lib/channels"`.
// Orchestrator + UI escolhem channel via `config.activeChannel` e chamam
// getChannel(channel).fetchPosts(...) sem saber qual provider ta rodando.

import { linkedinAdapter } from "./linkedin";
import { twitterAdapter } from "./twitter";
import type { Channel, ChannelAdapter } from "./types";

const registry: Record<Channel, ChannelAdapter> = {
  twitter: twitterAdapter,
  linkedin: linkedinAdapter,
};

export function getChannel(c: Channel): ChannelAdapter {
  const adapter = registry[c];
  if (!adapter) throw new Error(`Channel adapter nao registrado: ${c}`);
  return adapter;
}

export function listChannels(): Channel[] {
  return Object.keys(registry) as Channel[];
}

export * from "./types";
