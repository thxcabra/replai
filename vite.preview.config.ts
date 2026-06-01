import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";

// Config separada (sem CRXJS) pra rodar so a UI do side panel no browser,
// usando um mock do chrome.*. Uso: npm run preview:ui
// O proxy abaixo encaminha as chamadas da TwitterAPI server-side, contornando
// o CORS que bloqueia o fetch direto numa pagina web comum.
export default defineConfig({
  root: "src/preview",
  // .env fica na raiz do projeto, nao em src/preview
  envDir: "../..",
  plugins: [preact(), tailwindcss()],
  define: {
    "import.meta.env.VITE_TWITTERAPI_BASE": JSON.stringify("/twitterapi-proxy"),
  },
  server: {
    port: 5180,
    strictPort: true,
    open: false,
    proxy: {
      "/twitterapi-proxy": {
        target: "https://api.twitterapi.io",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/twitterapi-proxy/, ""),
      },
    },
  },
});
