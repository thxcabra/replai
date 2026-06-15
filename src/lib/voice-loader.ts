// Extrator de texto pra voz do workspace. Suporta .md/.markdown/.txt direto
// (FileReader) e .pdf via pdfjs-dist (lazy-import: so carrega no bundle se o
// analista realmente fizer upload de PDF).

// Teto pra evitar payloads abusivos no system prompt do LLM (Anthropic e
// Gemini aceitam mais, mas voz > 50KB sai do uso util e queima tokens).
export const MAX_VOICE_CHARS = 50_000;

export class VoiceLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceLoadError";
  }
}

function extFromName(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

async function readAsText(file: File): Promise<string> {
  // FileReader e mais compativel com encodings que ja vem labeled pelo browser
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r === "string") resolve(r);
      else reject(new VoiceLoadError("arquivo nao e texto"));
    };
    reader.onerror = () =>
      reject(new VoiceLoadError(`falha lendo arquivo: ${reader.error?.message}`));
    reader.readAsText(file, "utf-8");
  });
}

async function readPdfText(file: File): Promise<string> {
  // Lazy-import: pdfjs-dist sai ~300KB. So carrega quando precisar.
  const pdfjsLib = await import("pdfjs-dist");
  // MV3 service worker / extension page: usa worker fake (sync) pra evitar
  // CSP de worker-src. Tradeoff: extracao bloqueia thread por uns segundos
  // em PDFs grandes, mas e o pattern mais simples e nao precisa configurar
  // worker URL absoluta.
  // ts-ignore: pdfjs nao expõe o tipo em todos targets
  (pdfjsLib.GlobalWorkerOptions as { workerSrc: string }).workerSrc = "";

  const buf = await file.arrayBuffer();
  // disableWorker: forca processamento inline (sem spawn de Worker) - critico
  // pra extensao Chrome que tem CSP de worker-src restritivo
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buf),
    // @ts-expect-error - opcao reconhecida mas nem sempre nos tipos
    disableWorker: true,
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;

  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = content.items as { str?: string }[];
    const pageText = items.map((it) => it.str ?? "").join(" ");
    parts.push(pageText);
    page.cleanup();
  }
  await doc.cleanup();
  return parts.join("\n\n");
}

export async function extractTextFromFile(file: File): Promise<string> {
  // limite: 10MB pra evitar travar a UI mesmo antes de ler
  if (file.size > 10 * 1024 * 1024) {
    throw new VoiceLoadError("arquivo > 10MB. resuma o conteudo antes.");
  }

  const ext = extFromName(file.name);
  const mime = file.type;

  if (ext === "pdf" || mime === "application/pdf") {
    return readPdfText(file);
  }
  if (
    ext === "md" ||
    ext === "markdown" ||
    ext === "txt" ||
    mime.startsWith("text/")
  ) {
    return readAsText(file);
  }

  throw new VoiceLoadError(
    `formato nao suportado (${ext || mime || "?"}). use .md, .pdf ou .txt.`
  );
}
