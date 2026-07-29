# PDF redaction that actually removes the text

A browser-based redaction and PII detection engine. Runs entirely client-side: no server,
no upload.

## The problem

Most "redact PDF" tools draw a black rectangle over the text. The text is still in the
content stream, so anyone can select it, copy it, or run `pdftotext` and get it back.
This has leaked real information in court filings and corporate documents more than once.

## What this does instead

It rasterizes the affected page and rebuilds the PDF, so the text is genuinely gone from
the file rather than covered up.

**The tradeoff is real and worth stating plainly:** the page loses its text layer. It
becomes an image. That means no more text selection and no more search on that page. In
exchange, what you redacted is actually unrecoverable. A production UI should warn about
this and require a visual review before export.

## Verifying the claims

Both claims below are meant to be checked, not believed.

### 1. Fully offline, nothing is uploaded

Load the engine, enable "Offline Mode" in DevTools (or turn off your WiFi) and process a
document. The PDF pipeline runs locally through a cached WebAssembly worker. If it still
works with the network disabled, nothing left the browser.

### 2. Real redaction, not a black box

With a black rectangle you can highlight and copy the text underneath. After
rasterization the text layer is destroyed: `pdftotext` returns nothing and there is
nothing left to select.

## Files

| File | What it does |
|---|---|
| `src/auto-redact.ts` | Rasterization and PDF rebuild. Maps PII matches to coordinates. |
| `src/pii-detect.ts` | Detectors: ID numbers, cards (Luhn), IBAN, emails, phones. |
| `src/pdf-loader.ts` | Minimal pdf.js loading, extracted from the main engine. |

Everything is pure TypeScript and browser-oriented. `matchesToBoxes` and `ocrLineToBoxes`
are pure functions and testable without a DOM.

## Scope

This is the security-relevant part of a larger document-processing project: the code that
determines whether your data is actually safe. Compression, merging, splitting and the UI
are not included. I would rather publish the part that matters for security and say so,
than claim the whole thing is open when it is not.

## Usage

```ts
import { autoRedactPdf, type RedactionBox } from './src/auto-redact';
import { detectPii } from './src/pii-detect';

const matches = detectPii(pageText);           // find personal data
const bytes = await autoRedactPdf(pdfBytes, boxes, (page, total) => {
  console.log(`page ${page}/${total}`);
});
```

Requires `pdfjs-dist` and `pdf-lib` as peer dependencies.

## Contributing

Issues and pull requests welcome, particularly around detector accuracy for national ID
formats outside Spain and Latin America.

## License

MIT, see [LICENSE](LICENSE).
