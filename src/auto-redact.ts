// Auto-Redactor PII: detecta datos sensibles con coordenadas y produce un PDF
// RASTERIZADO con cajas negras. Importante: no basta con dibujar un rectángulo encima —
// el texto seguiría en el stream binario y sería extraíble. Al rasterizar, el texto
// subyacente desaparece de verdad (el PDF resultante pierde la capa de texto: precio
// de una redacción legalmente segura, por lo que la UI exige revisión visual).

import { loadPdfJs, PdfError, opcionesDeDocumento } from './pdf';
import { detectPii, type PiiKind, type PiiMatch } from './pii-detect';

export interface RedactionBox {
  id: number;
  page: number; // 1-based
  kind: PiiKind;
  value: string;
  x: number; y: number; width: number; height: number; // unidades PDF (origen abajo-izquierda)
}

interface TextItemLike { str: string; transform: number[]; width: number; height: number; }
interface OcrWordLike { text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; }
interface OcrLineLike { words: OcrWordLike[]; }

/**
 * Mapea coincidencias PII dentro de un item de texto a cajas en coordenadas PDF
 * (puro, testeable).
 *
 * La posición se estima repartiendo el ancho del fragmento entre sus caracteres, pero
 * las fuentes de los PDF son de ancho variable: una "i" ocupa mucho menos que una "W".
 * Con un margen ajustado, la caja empezaba tarde y dejaba a la vista el primer carácter
 * del dato — el "4" de una Visa o la "X" de un NIE, que ya revelan de qué se trata.
 *
 * Por eso el margen es de un carácter completo a cada lado en lugar de un par de
 * puntos: en una herramienta de censura, cubrir de más es un defecto estético y cubrir
 * de menos es una filtración.
 */
export const matchesToBoxes = (
  item: TextItemLike,
  matches: PiiMatch[],
  page: number,
  startId: number
): RedactionBox[] => {
  const [, , , , x, y] = [...item.transform];
  const fontH = item.height || Math.abs(item.transform[3]) || 10;
  // Ancho aproximado de un carácter en fuentes proporcionales (~0,55 del cuerpo).
  const margen = Math.max(fontH * 0.55, 3);
  return matches.map((m, i) => {
    const ratioStart = item.str.length > 0 ? m.index / item.str.length : 0;
    const ratioLen = item.str.length > 0 ? m.length / item.str.length : 1;
    const inicio = x + item.width * ratioStart - margen;
    return {
      id: startId + i,
      page,
      kind: m.kind,
      value: m.value,
      // Nunca se sale por la izquierda del fragmento original.
      x: Math.max(x - margen, inicio),
      y: y - fontH * 0.3,
      width: item.width * ratioLen + margen * 2,
      height: fontH * 1.4
    };
  });
};

/** Convierte una línea OCR y sus bounding boxes de píxeles en cajas PDF revisables. */
export const ocrLineToBoxes = (
  line: OcrLineLike,
  page: number,
  startId: number,
  scale: number,
  pageHeight: number,
  kinds?: PiiKind[]
): RedactionBox[] => {
  const words = line.words.filter((word) => word.text.trim());
  const normalized = words.map((word) => word.text.trim()).join(' ');
  const matches = detectPii(normalized, kinds);
  const spans: Array<{ start: number; end: number; word: OcrWordLike }> = [];
  let cursor = 0;
  for (const word of words) {
    const text = word.text.trim();
    spans.push({ start: cursor, end: cursor + text.length, word });
    cursor += text.length + 1;
  }
  return matches.flatMap((match, index) => {
    const end = match.index + match.length;
    const touched = spans.filter((span) => span.end > match.index && span.start < end);
    if (touched.length === 0) return [];
    const x0 = Math.min(...touched.map((span) => span.word.bbox.x0));
    const y0 = Math.min(...touched.map((span) => span.word.bbox.y0));
    const x1 = Math.max(...touched.map((span) => span.word.bbox.x1));
    const y1 = Math.max(...touched.map((span) => span.word.bbox.y1));
    return [{
      id: startId + index,
      page,
      kind: match.kind,
      value: match.value,
      x: x0 / scale - 2,
      y: pageHeight - y1 / scale - 2,
      width: (x1 - x0) / scale + 4,
      height: (y1 - y0) / scale + 4
    }];
  });
};

/** Escanea el PDF y devuelve las cajas de PII detectadas, listas para revisión manual. */
export const scanPdfForPii = async (
  bytes: ArrayBuffer,
  kinds?: PiiKind[],
  onProgress?: (page: number, total: number) => void
): Promise<{ boxes: RedactionBox[]; pageCount: number; source: 'text' | 'ocr' | 'mixed' }> => {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: bytes, ...opcionesDeDocumento() }).promise.catch(() => { throw new PdfError('unreadable'); });
  const boxes: RedactionBox[] = [];
  let id = 1;
  let textPages = 0;
  let ocrPages = 0;
  let ocrWorker: Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>> | null = null;
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      onProgress?.(p, doc.numPages);
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let extractedCharacters = 0;
      for (const raw of content.items as any[]) {
        if (typeof raw?.str !== 'string' || raw.str.length < 5) continue;
        extractedCharacters += raw.str.trim().length;
        const found = detectPii(raw.str, kinds);
        if (found.length > 0) {
          const mapped = matchesToBoxes(raw, found, p, id);
          boxes.push(...mapped);
          id += mapped.length;
        }
      }
      if (extractedCharacters >= 12) {
        textPages++;
        continue;
      }

      ocrPages++;
      const scale = 2;
      const viewport = page.getViewport({ scale });
      // Debe usar el helper: esta función se ejecuta dentro del worker de redacción,
      // donde `document` no existe y `document.createElement` aborta la operación.
      const canvas = createRenderCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      if (!context) throw new PdfError('render-failed');
      await page.render({ canvas, canvasContext: context, viewport } as any).promise;
      if (!ocrWorker) {
        const { createWorker } = await import('tesseract.js');
        ocrWorker = await createWorker(['spa', 'eng'], 1, {
          workerPath: '/tesseract/worker.min.js',
          corePath: '/tesseract/tesseract-core.wasm.js',
          langPath: '/tesseract/lang-data',
        });
      }
      // Se le pasa un Blob y no el lienzo: tesseract.js acepta Blob en cualquier
      // contexto, mientras que OffscreenCanvas no siempre lo admite dentro del worker.
      const result = await ocrWorker.recognize(await canvasToJpeg(canvas), {}, { text: true, blocks: true });
      const lines = (result.data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines));
      const pageHeight = viewport.height / scale;
      for (const line of lines) {
        const mapped = ocrLineToBoxes(line, p, id, scale, pageHeight, kinds);
        boxes.push(...mapped);
        id += mapped.length;
      }
    }
    return {
      boxes,
      pageCount: doc.numPages,
      source: ocrPages === 0 ? 'text' : textPages === 0 ? 'ocr' : 'mixed'
    };
  } finally {
    await ocrWorker?.terminate().catch(() => undefined);
    await (doc as { destroy?: () => Promise<void> }).destroy?.();
  }
};

type RenderCanvas = HTMLCanvasElement | OffscreenCanvas;

const createRenderCanvas = (width: number, height: number): RenderCanvas => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const canvasToJpeg = async (canvas: RenderCanvas): Promise<Blob> => {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  }
  const htmlCanvas = canvas as HTMLCanvasElement;
  return new Promise<Blob>((resolve, reject) =>
    htmlCanvas.toBlob((blob: Blob | null) => (blob ? resolve(blob) : reject(new PdfError('render-failed'))), 'image/jpeg', 0.92));
};

/** Genera el PDF redactado: cada página se rasteriza con las cajas seleccionadas en negro. */
export const autoRedactPdf = async (
  bytes: ArrayBuffer,
  boxes: RedactionBox[],
  onProgress?: (page: number, total: number) => void
): Promise<Uint8Array> => {
  const pdfjs = await loadPdfJs();
  const { PDFDocument } = await import('pdf-lib');
  const source = await pdfjs.getDocument({ data: bytes, ...opcionesDeDocumento() }).promise.catch(() => { throw new PdfError('unreadable'); });
  const target = await PDFDocument.create();
  const scale = 1.7;
  const byPage = new Map<number, RedactionBox[]>();
  for (const b of boxes) {
    if (!byPage.has(b.page)) byPage.set(b.page, []);
    byPage.get(b.page)!.push(b);
  }

  for (let p = 1; p <= source.numPages; p++) {
    onProgress?.(p, source.numPages);
    const page = await source.getPage(p);
    const viewport = page.getViewport({ scale });
    const canvas = createRenderCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    if (!context) throw new PdfError('render-failed');
    await page.render({ canvas, canvasContext: context, viewport } as any).promise;

    const pageHeight = viewport.height / scale;
    context.fillStyle = '#000';
    for (const box of byPage.get(p) ?? []) {
      context.fillRect(box.x * scale, (pageHeight - box.y - box.height) * scale, box.width * scale, box.height * scale);
    }

    const blob = await canvasToJpeg(canvas);
    const image = await target.embedJpg(await blob.arrayBuffer());
    const pdfPage = target.addPage([viewport.width / scale, viewport.height / scale]);
    pdfPage.drawImage(image, { x: 0, y: 0, width: viewport.width / scale, height: viewport.height / scale });
  }
  await (source as { destroy?: () => Promise<void> }).destroy?.();
  return target.save();
};
