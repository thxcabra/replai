import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json";

// Pin do extension ID local pro ID publicado no CWS:
// lhoachajfmnfabhcmjkibijjcdbmgjll
//
// Sem `key`, load unpacked gera um ID arbitrario diferente do publicado, e
// os redirect URIs ja cadastrados no Supabase (chrome-extension://lhoach.../...)
// nao funcionam. Com a key publica abaixo, a unpacked sempre tem o mesmo ID
// da versao do CWS, herdando todos os redirects/permissoes ja autorizados.
//
// E SEGURO commitar essa key: a public key e justamente o que vai dentro do
// CRX e qualquer um que baixe a extension publicada pode extrair. Ela NAO
// permite publicar atualizacoes da extension (isso exige login do dev no CWS).
//
// Como obter (uma vez so, pra paste aqui):
//   CWS Developer Dashboard → Replai → Pacote → "Public key"
//   ou via crx-viewer.com baixando o .crx publicado
const EXTENSION_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA8mpzUPSYrY4dWzZjBm3xjexo0QZ3V4V9St1em0h3rrG63BboMeagz2F7qOUQZHecDaixyxCsU7fmBJgEq/PiiiM3XEGZTZJhcNszlSaQuWOL2Ae3rxWtsynYqrwKuMTaSbuP0rZkl3QuQKH/MMYEoIrI1IUfzs7uXx6rK/LutenmT42XTvMJJZfsrpGR0LAUYqWxFmVlWkYa3zmlLF+KYDYiLd+iD2SY6w5ttktvLaktuOE9Ax/OsRsQJmD7BvlodQ+STlwGUexo3bL6HIVMKI1ViULyG4Y7SZxDkxddhreQMJP/6dxXXj3dS3yIwEYqTsxaoRTOE017nTfpjOUZrQIDAQAB";

// CWS rejeita pacote com campo `key` (Google assina com a propria chave).
// Pra evitar erro de upload, OMITE a key quando estiver buildando pra
// distribuicao do CWS — basta setar REPLAI_CWS_BUILD=1 antes do build:
//   Bash:        REPLAI_CWS_BUILD=1 npm run build
//   PowerShell:  $env:REPLAI_CWS_BUILD=1; npm run build
//   CMD:         set REPLAI_CWS_BUILD=1 && npm run build
// Default (sem essa env) = build local pra unpacked, com key embutida pra
// pinar o ID em lhoachajfmnfabhcmjkibijjcdbmgjll.
const IS_CWS_BUILD =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.REPLAI_CWS_BUILD === "1";

export default defineManifest({
  manifest_version: 3,
  name: "Replai",
  ...(IS_CWS_BUILD ? {} : { key: EXTENSION_KEY }),
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
  permissions: [
    "storage",
    "sidePanel",
    "identity",
    "alarms",
  ],
  host_permissions: [
    "https://api.twitterapi.io/*",
    "https://api.anthropic.com/*",
    "https://generativelanguage.googleapis.com/*",
    // Supabase: pinnar subdomain especifico do projeto (Web Store rejeita
    // wildcards sem justificativa forte). Se trocar de projeto, atualiza aqui.
    "https://lkkwtqekusqsbksncbdg.supabase.co/*",
    // Google OAuth (token endpoint + userinfo durante o flow do Supabase).
    "https://accounts.google.com/*",
    // V4.1.7: api.notion.com REMOVIDO. Watchtower agora via Edge Function
    // proxy (chamada via supabase URL ja autorizada acima).
  ],
});
