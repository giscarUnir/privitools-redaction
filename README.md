# PDF redaction that actually removes the text

The redaction and PII detection engine behind [PriviTools](https://privitools.com).
Runs entirely in the browser. No server, no upload.

## The problem

Most "redact PDF" tools draw a black rectangle over the text. The text is still in the
content stream, so anyone can select it, copy it, or run `pdftotext` and get it back.
This has leaked real information in court filings and corporate documents more than once.

## What this does instead

It rasterizes the affected page and rebuilds the PDF, so the text is genuinely gone from
the file rather than covered up.

**The tradeoff is real and worth stating plainly:** the page loses its text layer. It
becomes an image. That means no more text selection and no more search on that page. In
exchange, what you redacted is actually unrecoverable. The production UI warns about this
and requires a visual review before export.

## The Proof

### 1. 100% Offline (No Server Uploads)
Try it yourself: Open the [production tool](https://privitools.com), turn on "Offline Mode" in DevTools (or turn off your WiFi), and process a document. The entire PDF engine runs locally via a cached WebAssembly worker.

![Offline Proof](assets/offline.png) *(Note: Replace with your DevTools offline screenshot)*

### 2. True Redaction vs Fake Black Boxes
In standard tools, the text is just covered. In PriviTools, the page is rasterized. 

**Fake Redaction:** You can highlight and copy the text hidden under the black box.
![Before Redaction](assets/antes.png) *(Note: Replace with your before screenshot)*

**PriviTools Rasterization:** The text layer is destroyed. It is physically impossible to extract the text using `pdftotext` or by highlighting.
![After Redaction](assets/despues.png) *(Note: Replace with your after screenshot)*

## Files

| File | What it does |
|---|---|
| `src/auto-redact.ts` | Rasterization and PDF rebuild. Maps PII matches to coordinates. |
| `src/pii-detect.ts` | Detectors: ID numbers, cards (Luhn), IBAN, emails, phones. |
| `src/pdf-loader.ts` | Minimal pdf.js loading, extracted from the main engine. |

Everything is pure TypeScript and browser-oriented. `matchesToBoxes` and `ocrLineToBoxes`
are pure functions and testable without a DOM.

## Scope

This is not the whole site — it's the part where the code determines whether your data is
safe. Compression, merging, splitting and the UI live in a private repository. I'd rather
publish the security-relevant code and say so, than claim the whole project is open when
it isn't.

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

MIT — see [LICENSE](LICENSE).
