// Ładowanie pdf.js (lokalnie, z katalogu vendor — działa offline)
let lib;
export async function loadPdfjs() {
  if (lib) return lib;
  lib = await import('../../vendor/pdfjs/pdf.min.mjs');
  lib.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  return lib;
}

const base = new URL('../../vendor/pdfjs/', import.meta.url).href;

export async function openPdf(source) {
  const pdfjs = await loadPdfjs();
  const data = source instanceof Uint8Array ? source : new Uint8Array(await source.arrayBuffer());
  const task = pdfjs.getDocument({
    data,
    cMapUrl: base + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: base + 'standard_fonts/',
    wasmUrl: base + 'wasm/',
    fontExtraProperties: true,
    isEvalSupported: false,
    useSystemFonts: false,
  });
  return task.promise;
}
