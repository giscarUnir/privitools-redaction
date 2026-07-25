// Carga de pdf.js y tipo de error, extraídos del motor de PriviTools.
// Solo se incluye lo que necesita el redactor: el resto del motor (compresión,
// unión, división…) no interviene en la seguridad del documento.

// Errores con código para que el script los traduzca con widget-i18n.
export class PdfError extends Error {
  code: string;
  detail?: string;
  constructor(code: string, detail?: string) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}


// ——— pdf.js: motor de renderizado (solo PDF→JPG y comprimir) ———
export const loadPdfJs = async () => {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    (globalThis as any).DOMMatrix = class DOMMatrix {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      constructor(init?: number[] | string) {
        if (Array.isArray(init) && init.length >= 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init;
        }
      }
      multiply() { return new (globalThis as any).DOMMatrix(); }
      translate() { return new (globalThis as any).DOMMatrix(); }
      scale() { return new (globalThis as any).DOMMatrix(); }
      rotate() { return new (globalThis as any).DOMMatrix(); }
      transformPoint() { return { x: 0, y: 0 }; }
      inverse() { return new (globalThis as any).DOMMatrix(); }
      static fromMatrix() { return new (globalThis as any).DOMMatrix(); }
      static fromFloat32Array(arr: Float32Array) { return new (globalThis as any).DOMMatrix(Array.from(arr)); }
      static fromFloat64Array(arr: Float64Array) { return new (globalThis as any).DOMMatrix(Array.from(arr)); }
    };
  }
  if (typeof (Promise as any).try !== 'function') {
    (Promise as any).try = function (fn: any) {
      return new Promise((resolve) => resolve(fn()));
    };
  }
  if (typeof window !== 'undefined') {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  }
  // Node (tests): build legacy + importar el worker registra globalThis.pdfjsWorker
  // y pdf.js lo usa como "fake worker" sin necesidad de workerSrc.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '';
  return pdfjs;
};

