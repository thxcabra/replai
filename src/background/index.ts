import { onAuthChange } from "../lib/auth";
import { runMigrationIfNeeded } from "../lib/migration";
import { clearSyncedState, pullAll } from "../lib/storage";

// Abre o side panel quando o usuario clica no icone da extensao.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("[replai] setPanelBehavior:", err));

// ---- V4: cloud sync polling ----
//
// Service worker hiberna; chrome.alarms acorda ele em intervalos regulares.
// Alarm de 15min faz pullAll() (no-op se nao logado). E a forma sustentavel
// de manter cache local em dia entre devices sem WebSocket (que cairia a
// cada hibernacao da SW).
const SYNC_ALARM = "replai-sync-pull";
const SYNC_PERIOD_MIN = 15;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MIN });
});

chrome.runtime.onStartup.addListener(() => {
  // Garante alarm ao acordar o browser (alarms persistem mas seguro reaplicar).
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MIN });
  // Pull imediato ao reabrir o browser pra cache ja vir fresco quando o side
  // panel abrir.
  pullAll().catch((e) => console.warn("[replai] pullAll on startup:", e));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) {
    pullAll().catch((e) => console.warn("[replai] pullAll on alarm:", e));
  }
});

// Quando o auth state muda, sincroniza imediatamente:
// - SIGNED_IN: puxa profile + workspaces pro cache local
// - SIGNED_OUT: limpa cache de dados sincronizados (mantém session caches locais)
onAuthChange(async (session) => {
  if (session) {
    try {
      await pullAll();
      const result = await runMigrationIfNeeded();
      if (result.ran) {
        console.log("[replai] migracao V3->V4 concluida:", result);
      }
    } catch (e) {
      console.warn("[replai] pos-login sync/migration:", e);
    }
  } else {
    clearSyncedState().catch((e) =>
      console.warn("[replai] clearSyncedState:", e)
    );
  }
});
