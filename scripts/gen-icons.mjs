import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

// Gera PNGs do icone do Replai (16/48/128/1024) sem dependencias externas.
// Renderiza pixel-a-pixel: fundo dark com cantos arredondados + balao de fala
// com gradient sky->violet + letra "R" branca centralizada.
//
// SVG source equivalente em public/icons/icon.svg. Atualizar ambos se mudar.

// ---------- PNG writer (low-level, sem libs) ----------

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function bufferToPng(size, pixels) {
  // pixels: Uint8ClampedArray RGBA, size*size*4
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA

  const rowLen = size * 4 + 1;
  const raw = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    const offRaw = y * rowLen;
    raw[offRaw] = 0; // filter "none"
    const offPx = y * size * 4;
    for (let i = 0; i < size * 4; i++) {
      raw[offRaw + 1 + i] = pixels[offPx + i];
    }
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- Drawing primitives ----------

const BG = [15, 17, 21, 255];        // dark zinc-950
const WHITE = [255, 255, 255, 255];

// gradient sky-500 (#0EA5E9) -> violet-600 (#7C3AED)
function gradientColor(t) {
  const r = Math.round(14 + (124 - 14) * t);
  const g = Math.round(165 + (58 - 165) * t);
  const b = Math.round(233 + (237 - 233) * t);
  return [r, g, b, 255];
}

function inRoundRect(x, y, w, h, radius, px, py) {
  if (px < x || px >= x + w || py < y || py >= y + h) return false;
  // corners
  const corners = [
    [x + radius, y + radius],            // top-left
    [x + w - radius - 1, y + radius],    // top-right
    [x + radius, y + h - radius - 1],    // bottom-left
    [x + w - radius - 1, y + h - radius - 1], // bottom-right
  ];
  const inXBand = px >= x + radius && px < x + w - radius;
  const inYBand = py >= y + radius && py < y + h - radius;
  if (inXBand || inYBand) return true;
  // verifica se esta em algum dos cantos arredondados
  for (const [cx, cy] of corners) {
    if (
      (px <= cx && py <= cy && px >= x && py >= y) ||
      (px > cx && py <= cy && px < x + w && py >= y) ||
      (px <= cx && py > cy && px >= x && py < y + h) ||
      (px > cx && py > cy && px < x + w && py < y + h)
    ) {
      const dx = px - cx;
      const dy = py - cy;
      return dx * dx + dy * dy <= radius * radius;
    }
  }
  return true;
}

// Speech bubble shape (caminho do SVG, normalizado em 128x128)
function inSpeechBubble(px, py, size) {
  const s = size / 128;
  // coords normalizadas (em 128)
  const x = px / s;
  const y = py / s;
  // box principal: rect (24,28)-(104,88) com cantos 8
  const inMainBody =
    x >= 24 && x < 104 && y >= 28 && y < 88 &&
    inRoundRect(24, 28, 80, 60, 8, x, y);
  if (inMainBody) return true;
  // tail (triangulo apontando p/ baixo-esquerda): de (40,88)-(56,88)-(40,102)
  // approximate: aresta esquerda x=40, hipotenusa do (56,88) ao (40,102)
  if (y >= 88 && y <= 102 && x >= 40) {
    const dy = y - 88;     // 0..14
    const maxX = 56 - (16 / 14) * dy; // de 56 (em y=88) ate 40 (em y=102)
    if (x <= maxX) return true;
  }
  return false;
}

// Render "R" como bitmap escalado. Usa shape primitivo (3 partes: barra
// vertical esquerda, semicirculo superior, perna diagonal).
function inLetterR(px, py, size) {
  // letra ocupa ~50% do icon centrada em (64, 58) em coords 128
  const s = size / 128;
  const x = px / s - 50;   // offset pra letter box left
  const y = py / s - 38;   // offset pra letter box top
  // bounding box: 28w x 40h
  if (x < 0 || y < 0 || x >= 28 || y >= 40) return false;

  const stroke = 6;          // espessura

  // 1. Barra vertical esquerda (0..stroke, full height)
  if (x < stroke) return true;

  // 2. Arco/box superior: rect (stroke..28, 0..18) com curva
  if (x >= stroke && x < 26 && y >= 0 && y < 18) {
    // borda externa: aprox ellipse cx=14 cy=9 rx=14 ry=9
    // borda interna: ellipse cx=14 cy=9 rx=8 ry=4 (stroke 6 internal)
    const dx = x - 14;
    const dy = y - 9;
    const outer = (dx * dx) / (14 * 14) + (dy * dy) / (9 * 9);
    const inner = (dx * dx) / (8 * 8) + (dy * dy) / (4 * 4);
    return outer <= 1 && inner >= 1;
  }

  // Linha horizontal de transicao (entre arco e perna) em y=18..22
  if (y >= 18 && y < 22 && x >= 0 && x < 22) return true;

  // 3. Perna diagonal: do canto (8,22) ate (28,40), espessura 6
  if (y >= 22 && y <= 40) {
    const t = (y - 22) / 18;       // 0..1
    const baseX = 8 + 18 * t;      // posicao central da perna
    if (Math.abs(x - baseX) < stroke / 2 + 1) return true;
  }
  return false;
}

// ---------- Render ----------

function renderIcon(size) {
  const pixels = new Uint8ClampedArray(size * size * 4);

  // raio cantos = ~21% do size (28 em 128)
  const bgRadius = Math.round(size * 28 / 128);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const off = (y * size + x) * 4;
      let color;

      const insideBg = inRoundRect(0, 0, size, size, bgRadius, x, y);
      if (!insideBg) {
        // fora dos cantos: transparente
        pixels[off + 3] = 0;
        continue;
      }

      // background dark
      color = BG;

      // speech bubble (gradient diagonal)
      if (inSpeechBubble(x, y, size)) {
        const t = (x + y) / (size * 2); // diagonal gradient
        color = gradientColor(t);
      }

      // letra R em cima do bubble, branca
      if (inLetterR(x, y, size)) {
        color = WHITE;
      }

      pixels[off] = color[0];
      pixels[off + 1] = color[1];
      pixels[off + 2] = color[2];
      pixels[off + 3] = color[3];
    }
  }
  return pixels;
}

// ---------- Main ----------

mkdirSync("public/icons", { recursive: true });
// 1024 e pra Web Store ("large promo tile" / icon de listagem)
for (const size of [16, 48, 128, 1024]) {
  const pixels = renderIcon(size);
  const png = bufferToPng(size, pixels);
  writeFileSync(`public/icons/icon${size}.png`, png);
  console.log(`public/icons/icon${size}.png (${png.length} bytes)`);
}
