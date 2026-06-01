// Abre o side panel quando o usuario clica no icone da extensao.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("[replai] setPanelBehavior:", err));
