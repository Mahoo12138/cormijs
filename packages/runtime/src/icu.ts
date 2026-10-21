/**
 * Small ICU MessageFormat subset: simple arguments, number/date/time, plural/selectordinal and select.
 * Skeletons, currency codes and full apostrophe quoting are intentionally out of scope.
 */
type Values = Readonly<Record<string, string | number>>;

interface Segment { readonly kind: 'text'; readonly text: string }
interface Simple { readonly kind: 'simple'; readonly name: string }
interface Formatted { readonly kind: 'formatted'; readonly name: string; readonly type: 'number' | 'date' | 'time'; readonly style?: string }
interface Choice { readonly kind: 'choice'; readonly name: string; readonly type: 'plural' | 'selectordinal' | 'select'; readonly offset: number; readonly options: Readonly<Record<string, string>> }
type Node = Segment | Simple | Formatted | Choice;

class Parser {
  private index = 0;
  constructor(private readonly input: string) {}
  parse(): readonly Node[] { return this.message(false); }
  private message(nested: boolean): readonly Node[] {
    const nodes: Node[] = []; let text = '';
    const flush = () => { if (text) { nodes.push({ kind: 'text', text }); text = ''; } };
    while (this.index < this.input.length) {
      const char = this.input[this.index]!;
      if (char === "'") {
        const next = this.input[this.index + 1];
        if (next === "'") { text += "'"; this.index += 2; continue; }
        if (next === '{' || next === '}' || next === '#') { text += this.quoted(); continue; }
        text += char; this.index++; continue;
      }
      if (char === '{') { flush(); nodes.push(this.argument()); continue; }
      if (char === '}' && nested) { if (text) nodes.push({ kind: 'text', text }); this.index++; return nodes; }
      text += char; this.index++;
    }
    if (nested) throw new TypeError('LOCALE_INVALID: unterminated ICU argument');
    flush(); return nodes;
  }
  /** Quoted runs are literal: braces stay text and `#` is protected from the plural counter. */
  private quoted(): string {
    this.index++; // opening quote
    let literal = '';
    while (this.index < this.input.length) {
      const char = this.input[this.index]!;
      if (char === "'") {
        if (this.input[this.index + 1] === "'") { literal += "'"; this.index += 2; continue; }
        this.index++; return literal;
      }
      literal += char === '#' ? '\u0000#' : char; this.index++;
    }
    return literal;
  }
  private argument(): Node {
    this.index++; // {
    const start = this.index;
    while (this.index < this.input.length && this.input[this.index] !== ',' && this.input[this.index] !== '}') this.index++;
    const name = this.input.slice(start, this.index).trim();
    if (!name) throw new TypeError('LOCALE_INVALID: ICU argument needs a name');
    if (this.input[this.index] === '}') { this.index++; return { kind: 'simple', name }; }
    this.index++; // ,
    const typeStart = this.index;
    while (this.index < this.input.length && this.input[this.index] !== ',' && this.input[this.index] !== '}') this.index++;
    const type = this.input.slice(typeStart, this.index).trim();
    if (type === 'number' || type === 'date' || type === 'time') {
      let style: string | undefined;
      if (this.input[this.index] === ',') {
        this.index++;
        const styleStart = this.index;
        while (this.index < this.input.length && this.input[this.index] !== '}') this.index++;
        style = this.input.slice(styleStart, this.index).trim() || undefined;
      }
      if (this.input[this.index] !== '}') throw new TypeError('LOCALE_INVALID: malformed ICU format argument');
      this.index++;
      return { kind: 'formatted', name, type, ...(style ? { style } : {}) };
    }
    if (type !== 'plural' && type !== 'select' && type !== 'selectordinal') throw new TypeError(`LOCALE_INVALID: unsupported ICU argument type: ${type}`);
    if (this.input[this.index] === ',') this.index++; // the comma after the argument type
    const options: Record<string, string> = {}; let offset = 0;
    for (;;) {
      this.skipSpace();
      if (this.input[this.index] === '}') { this.index++; break; }
      // Selectors and the `offset:N` directive are whitespace-delimited; `=0` may sit directly before `{`.
      const selectorStart = this.index;
      while (this.index < this.input.length && !/[\s{]/.test(this.input[this.index]!)) this.index++;
      const selector = this.input.slice(selectorStart, this.index);
      if (!selector) throw new TypeError('LOCALE_INVALID: missing ICU selector');
      this.skipSpace();
      if (selector.startsWith('offset:')) {
        const value = Number(selector.slice('offset:'.length));
        if (type === 'select' || !Number.isInteger(value) || value < 0) throw new TypeError('LOCALE_INVALID: invalid plural offset');
        offset = value; continue;
      }
      if (this.input[this.index] !== '{') throw new TypeError('LOCALE_INVALID: malformed ICU choice');
      this.index++; // {
      options[selector] = this.readBody();
    }
    if (!Object.keys(options).length) throw new TypeError('LOCALE_INVALID: ICU choice has no options');
    if (type !== 'plural' && type !== 'selectordinal' && options.other === undefined) throw new TypeError('LOCALE_INVALID: ICU select needs an other option');
    return { kind: 'choice', name, type, offset, options };
  }
  private skipSpace() { while (this.index < this.input.length && /\s/.test(this.input[this.index]!)) this.index++; }
  /** Returns the raw body up to the matching brace so nested choices and `#` stay intact. */
  private readBody(): string {
    const start = this.index; let depth = 1;
    while (this.index < this.input.length) {
      const char = this.input[this.index]!;
      if (char === "'") {
        const next = this.input[this.index + 1];
        if (next === "'") { this.index += 2; continue; }
        if (next === '{' || next === '}' || next === '#') {
          this.index++;
          while (this.index < this.input.length) {
            if (this.input[this.index] !== "'") { this.index++; continue; }
            if (this.input[this.index + 1] === "'") { this.index += 2; continue; }
            this.index++; break;
          }
          continue;
        }
        this.index++; continue;
      }
      if (char === '{') { depth++; this.index++; continue; }
      if (char === '}') { depth--; if (!depth) { const body = this.input.slice(start, this.index); this.index++; return body; } this.index++; continue; }
      this.index++;
    }
    throw new TypeError('LOCALE_INVALID: unterminated ICU choice body');
  }
}
export const parseIcu = (message: string): readonly Node[] => new Parser(message).parse();

const formatters = new Map<string, { numbers: Map<string, Intl.NumberFormat>; dates: Map<string, Intl.DateTimeFormat>; plurals: Map<string, Intl.PluralRules> }>();
function formatter(locale: string) {
  let entry = formatters.get(locale);
  if (!entry) { entry = { numbers: new Map(), dates: new Map(), plurals: new Map() }; formatters.set(locale, entry); }
  return entry;
}

function render(nodes: readonly Node[], values: Values, locale: string, count?: number): string {
  let output = '';
  for (const node of nodes) {
    if (node.kind === 'text') {
      output += count === undefined ? node.text.replace(/\u0000/g, '') : node.text.replace(/\u0000#|#/g, match => (match === '#' ? String(count) : '#'));
      continue;
    }
    if (node.kind === 'simple') { const value = values[node.name]; output += value === undefined ? `{${node.name}}` : String(value); continue; }
    if (node.kind === 'formatted') {
      const value = values[node.name];
      if (value === undefined) throw new TypeError(`LOCALE_INVALID: missing value for ${node.name}`);
      const cache = formatter(locale);
      if (node.type === 'number') {
        const key = node.style ?? '';
        let format = cache.numbers.get(key);
        if (!format) { format = new Intl.NumberFormat(locale, node.style === 'integer' ? { maximumFractionDigits: 0 } : node.style === 'percent' ? { style: 'percent' } : {}); cache.numbers.set(key, format); }
        output += format.format(Number(value));
      } else {
        const options: Intl.DateTimeFormatOptions = node.style === 'short' || node.style === 'medium' || node.style === 'long' || node.style === 'full' ? { [node.type === 'date' ? 'dateStyle' : 'timeStyle']: node.style } : {};
        const key = JSON.stringify(options);
        let format = cache.dates.get(key);
        if (!format) { format = new Intl.DateTimeFormat(locale, options); cache.dates.set(key, format); }
        output += format.format(new Date(value));
      }
      continue;
    }
    const raw = values[node.name];
    if (node.type === 'select') {
      if (typeof raw !== 'string' && typeof raw !== 'number') throw new TypeError(`LOCALE_INVALID: missing value for ${node.name}`);
      const body = node.options[String(raw)] ?? node.options.other;
      if (body === undefined) throw new TypeError(`LOCALE_INVALID: no ICU option for ${node.name}`);
      output += render(new Parser(body).parse(), values, locale, count);
      continue;
    }
    const numeric = Number(raw);
    if (raw === undefined || !Number.isFinite(numeric)) throw new TypeError(`LOCALE_INVALID: missing numeric value for ${node.name}`);
    // Explicit `=N` matches the original value; offset only applies to category selection and `#`.
    const exact = node.options[`=${numeric}`];
    const category = new Intl.PluralRules(locale, { type: node.type === 'selectordinal' ? 'ordinal' : 'cardinal' }).select(numeric - node.offset);
    const body = exact ?? node.options[category] ?? node.options.other;
    if (body === undefined) throw new TypeError(`LOCALE_INVALID: no ICU plural option for ${node.name}`);
    output += render(new Parser(body).parse(), values, locale, node.offset ? numeric - node.offset : numeric);
  }
  return output;
}

/** Formats a message subset: `{name}`, `{n, number|date|time[, style]}`, `{n, plural|selectordinal|select, ...}`. */
export function formatIcu(message: string, values: Values, locale: string): string {
  return render(new Parser(message).parse(), values, locale);
}
