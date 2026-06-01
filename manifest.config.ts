import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json";

export default defineManifest({
  manifest_version: 3,
  name: "Replai",
  version: pkg.version,
  description: pkg.description,
  minimum_chrome_version: "114",
  icons: {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png",
  },
  action: {
    default_title: "Abrir Replai",
    default_icon: {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png",
    },
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  permissions: ["storage", "sidePanel", "tabs", "clipboardWrite"],
  host_permissions: [
    "https://api.twitterapi.io/*",
    "https://api.anthropic.com/*",
    "https://generativelanguage.googleapis.com/*",
  ],
});
