// Detección de información personal identificable (PII) en texto plano.
// Motor puro sin dependencias: usable en navegador, Web Worker y tests de Node.

export type PiiKind = 'email' | 'phone' | 'card' | 'iban' | 'dni' | 'nie' | 'ssn-us';

export interface PiiMatch {
  kind: PiiKind;
  value: string;
  index: number;
  length: number;
}

/** Algoritmo de Luhn: descarta números de 13-19 dígitos que no son tarjetas reales. */
export const luhnCheck = (digits: string): boolean => {
  const clean = digits.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(clean)) return false;
  let sum = 0;
  let double = false;
  for (let i = clean.length - 1; i >= 0; i--) {
    let d = Number(clean[i]);
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
};

/** Validación IBAN mod-97 (ISO 13616): evita falsos positivos de cadenas alfanuméricas. */
export const ibanCheck = (iban: string): boolean => {
  const clean = iban.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(clean)) return false;
  const rearranged = clean.slice(4) + clean.slice(0, 4);
  const expanded = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (let i = 0; i < expanded.length; i += 7) {
    remainder = Number(String(remainder) + expanded.slice(i, i + 7)) % 97;
  }
  return remainder === 1;
};

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

/** DNI español: 8 dígitos + letra de control válida. */
export const dniCheck = (value: string): boolean => {
  const m = value.toUpperCase().match(/^(\d{8})([A-Z])$/);
  if (!m) return false;
  return DNI_LETTERS[Number(m[1]) % 23] === m[2];
};

/** NIE español: X/Y/Z + 7 dígitos + letra de control. */
export const nieCheck = (value: string): boolean => {
  const m = value.toUpperCase().match(/^([XYZ])(\d{7})([A-Z])$/);
  if (!m) return false;
  const prefix = { X: '0', Y: '1', Z: '2' }[m[1] as 'X' | 'Y' | 'Z'];
  return DNI_LETTERS[Number(prefix + m[2]) % 23] === m[3];
};

interface Detector { kind: PiiKind; regex: RegExp; validate?: (v: string) => boolean; }

const DETECTORS: Detector[] = [
  { kind: 'email', regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: 'iban', regex: /\b[A-Z]{2}\d{2}[ ]?(?:[A-Z0-9][ ]?){10,30}\b/g, validate: ibanCheck },
  { kind: 'card', regex: /\b(?:\d[ -]?){13,19}\b/g, validate: luhnCheck },
  { kind: 'dni', regex: /\b\d{8}[A-Za-z]\b/g, validate: dniCheck },
  { kind: 'nie', regex: /\b[XYZxyz]\d{7}[A-Za-z]\b/g, validate: nieCheck },
  { kind: 'ssn-us', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  // Teléfonos: internacional (+xx...) o nacional con separadores; mínimo 9 dígitos reales.
  { kind: 'phone', regex: /(?:\+\d{1,3}[ .-]?)?(?:\(?\d{2,4}\)?[ .-]?)\d{2,4}[ .-]?\d{2,4}(?:[ .-]?\d{2,4})?/g, validate: (v) => { const d = v.replace(/\D/g, ''); return d.length >= 9 && d.length <= 15; } }
];

/**
 * Escanea un texto y devuelve las coincidencias PII validadas, sin solapamientos
 * (una tarjeta detectada no vuelve a reportarse como teléfono).
 */
/**
 * Recorta una coincidencia demasiado larga hasta dar con la parte que sí valida.
 *
 * Los patrones de IBAN y tarjeta son necesariamente amplios (el formato cambia según
 * el país y la separación en grupos es libre), así que son voraces y engullen lo que
 * viene detrás. En "IBAN: ES91 2100 0418 4502 0005 1332 DNI: 12345678Z" el regex
 * capturaba hasta el "DNI", mod-97 fallaba y el IBAN se perdía entero: en un documento
 * real —donde siempre hay texto alrededor— no se detectaba ninguno.
 */
const recortarHastaValido = (valor: string, validar: (v: string) => boolean): string | null => {
  if (validar(valor)) return valor;
  const grupos = valor.split(/\s+/);
  for (let n = grupos.length - 1; n >= 1; n--) {
    const candidato = grupos.slice(0, n).join(' ');
    if (validar(candidato)) return candidato;
  }
  return null;
};

export const detectPii = (text: string, kinds?: PiiKind[]): PiiMatch[] => {
  const active = kinds ? DETECTORS.filter((d) => kinds.includes(d.kind)) : DETECTORS;
  const matches: PiiMatch[] = [];
  const taken: [number, number][] = [];
  const overlaps = (start: number, end: number) => taken.some(([s, e]) => start < e && end > s);

  for (const detector of active) {
    detector.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = detector.regex.exec(text)) !== null) {
      let value = m[0].trim();
      // Se valida ANTES de mirar solapamientos: el recorte cambia dónde termina la
      // coincidencia, y con el valor sin ajustar se reservaba de más.
      if (detector.validate) {
        const ajustado = recortarHastaValido(value, detector.validate);
        if (!ajustado) continue;
        value = ajustado;
      }
      const start = m.index;
      const end = start + value.length;
      if (overlaps(start, end)) continue;
      matches.push({ kind: detector.kind, value, index: start, length: value.length });
      taken.push([start, end]);
    }
  }
  return matches.sort((a, b) => a.index - b.index);
};
