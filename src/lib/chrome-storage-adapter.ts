// Adapter que casa a interface esperada pelo Supabase Auth (getItem/setItem/
// removeItem) com chrome.storage.local. Necessario porque service workers em
// MV3 nao tem localStorage e o Supabase default tenta usar localStorage.
//
// Usa chrome.storage.local (per-device, 10MB) em vez de chrome.storage.sync
// (cross-device, 100KB total) porque a sessao do Supabase e per-device por
// natureza: o analista loga em cada device uma vez (OAuth flow), e o que
// sincroniza entre devices sao os dados (profile, workspaces, replied, etc),
// nao a sessao em si. Local tambem evita conflitos de quota.

export const chromeStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const result = await chrome.storage.local.get(key);
    const value = result[key];
    return typeof value === "string" ? value : null;
  },

  async setItem(key: string, value: string): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },

  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  },
};
