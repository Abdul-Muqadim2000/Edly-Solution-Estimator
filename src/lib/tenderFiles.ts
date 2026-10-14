import { readWorkbook, unzip, type Workbook } from '@/lib/xlsx';

/**
 * Getting a tender file ready to send.
 *
 * A PDF goes to Claude as it is, so tables and scanned pages survive. Word, Excel, web pages and
 * text files are turned into text here, in the browser, with the zip reader the catalog already
 * uses, then cut into parts marked `[[Part N]]`. Text has no pages, and a requirement still needs a
 * place a person can find it again.
 */

/** Vercel refuses a function request body over 4.5 MB, so one file has to fit under it. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** A Word, Excel or HTML file is converted before upload, so only its text has to fit. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES = 5;
/** Characters per part of converted text: about a printed page. */
export const PART_CHARS = 4000;
/**
 * Rows per part of a converted spreadsheet. A requirements matrix has a requirement on nearly
 * every row, so a part of rows is much denser than a page of prose.
 */
export const SHEET_ROWS = 20;
/**
 * Parts of a spreadsheet one extraction call reads: 40 rows, about 8,000 tokens of answer. The
 * usual 20 parts would be 400 rows, which no call finishes inside the function's time limit, so
 * the call is thrown away (and billed) before the range is split and read again. It was 60 rows
 * until each requirement came with a title, a self-contained description and where else the tender
 * asks for it, which made each answer about 60% longer; a call costs only a cache read of the tender.
 */
export const SHEET_SPAN = 2;

export type TenderFileKind = 'pdf' | 'docx' | 'xlsx' | 'csv' | 'html' | 'text';

export function tenderFileKind(name: string): TenderFileKind | null {
  const extension = name.toLowerCase().split('.').pop() ?? '';
  if (extension === 'pdf') return 'pdf';
  if (extension === 'docx') return 'docx';
  if (extension === 'xlsx') return 'xlsx';
  if (extension === 'csv') return 'csv';
  if (extension === 'html' || extension === 'htm') return 'html';
  if (extension === 'txt' || extension === 'md') return 'text';
  return null;
}

/** What the file picker offers, and what a refusal says can be chosen instead. */
export const TENDER_FILE_TYPES = '.pdf,.docx,.xlsx,.csv,.html,.htm,.txt,.md';
const KINDS_IN_WORDS = 'a PDF, Word (.docx), Excel (.xlsx), web page (.html) or text file';

const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Why a set of chosen files cannot be sent, or null when it can. Checked before anything uploads. */
export function checkTenderFiles(files: readonly { name: string; size: number }[]): string | null {
  if (files.length === 0) return 'Choose at least one file.';
  if (files.length > MAX_FILES) return `At most ${MAX_FILES} files per tender.`;
  for (const file of files) {
    const kind = tenderFileKind(file.name);
    if (!kind) return `${file.name} is not ${KINDS_IN_WORDS}.`;
    if (kind === 'pdf' && file.size > MAX_UPLOAD_BYTES) {
      return `${file.name} is ${megabytes(file.size)}. PDFs can be at most ${megabytes(MAX_UPLOAD_BYTES)} for now.`;
    }
    if (file.size > MAX_SOURCE_BYTES) return `${file.name} is ${megabytes(file.size)}, over the ${megabytes(MAX_SOURCE_BYTES)} limit.`;
  }
  return null;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/**
 * A Word document's body as text: a line per paragraph, a line per table row with its cells
 * joined by " | ". Tenders put most requirements in tables, so rows must stay together.
 *
 * The tag patterns need the character after the name: `<w:p` alone would also match `<w:pPr>`.
 */
export function docxXmlToText(xml: string): string {
  const lines: string[] = [];
  let paragraph = '';
  let row: string[] | null = null;
  let cell: string[] | null = null;
  const token = /<w:tr[\s>]|<\/w:tr>|<w:tc[\s>]|<\/w:tc>|<w:p\/>|<w:p[\s>]|<\/w:p>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g;
  for (let found = token.exec(xml); found !== null; found = token.exec(xml)) {
    const tag = found[0];
    if (tag.startsWith('<w:tr')) row = [];
    else if (tag === '</w:tr>') {
      if (row && row.some(Boolean)) lines.push(row.join(' | '));
      row = null;
    } else if (tag.startsWith('<w:tc')) cell = [];
    else if (tag === '</w:tc>') {
      if (row && cell) row.push(cell.join(' ').trim());
      cell = null;
    } else if (tag === '<w:p/>') continue;
    else if (tag.startsWith('<w:p')) paragraph = '';
    else if (tag === '</w:p>') {
      const text = paragraph.replace(/\s+/g, ' ').trim();
      if (cell) cell.push(text);
      else if (text) lines.push(text);
      paragraph = '';
    } else if (found[1] !== undefined) paragraph += decodeXml(found[1]);
    else paragraph += ' ';
  }
  return lines.join('\n');
}

/* --------------------------------------------------------------- web pages */

/*
 * The named entities a web page uses that XML does not define, as code points: the Latin-1 letters
 * and signs in order from 160 (`nbsp` to `yuml`), then the typography Word and portals write.
 * Code points rather than the characters, so no dash or curly quote sits in the source.
 */
const LATIN1 = (
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para ' +
  'middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute ' +
  'Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute ' +
  'THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ' +
  'ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'
).split(' ');
const HTML_ENTITIES: Record<string, number> = {
  ...Object.fromEntries(LATIN1.map((name, index) => [name, 160 + index])),
  ensp: 0x2002, emsp: 0x2003, thinsp: 0x2009, zwnj: 0x200c, zwj: 0x200d, lrm: 0x200e, rlm: 0x200f,
  ndash: 0x2013, mdash: 0x2014, lsquo: 0x2018, rsquo: 0x2019, sbquo: 0x201a, ldquo: 0x201c, rdquo: 0x201d, bdquo: 0x201e,
  dagger: 0x2020, bull: 0x2022, hellip: 0x2026, permil: 0x2030, prime: 0x2032, lsaquo: 0x2039, rsaquo: 0x203a,
  euro: 0x20ac, trade: 0x2122, larr: 0x2190, rarr: 0x2192, minus: 0x2212, ne: 0x2260, le: 0x2264, ge: 0x2265
};

function decodeHtml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    /* names are case-sensitive (Eacute is not eacute), but a page that writes &NBSP; still means a space */
    const code = HTML_ENTITIES[name] ?? HTML_ENTITIES[name.toLowerCase()];
    return code !== undefined ? String.fromCodePoint(code) : ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/* soft hyphens and zero-width marks: invisible on the page, and inside a word they split it for the AI */
const INVISIBLE = /[\u00ad\u200b-\u200f\ufeff]/g;
const inline = (value: string): string => decodeHtml(value).replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();

/** Elements whose start or end begins a new line. Everything else is read as part of the sentence. */
const BLOCK = new Set(
  'address article aside blockquote br caption center dd details dialog div dl dt fieldset figcaption figure footer form header hr legend main nav ol p pre section summary ul'.split(' ')
);

interface TableFrame {
  row: string[] | null;
  cell: string | null;
  /** Rows of a table that sits inside another table's cell, kept for that cell. */
  rows: string[];
}

/**
 * A web page's text: a line per heading, paragraph and list item, and a line per table row with its
 * cells joined by " | ", as a Word document is read. Headings keep their level as "#" marks and list
 * items a "- ", so the outline and the lists a requirement is split out of survive.
 *
 * Scripts, styles, comments, the head (but for its title) and form dropdowns are not the tender and
 * are left out. HTML lets a page leave `</td>`, `</tr>`, `</li>` and `</p>` out, so a new cell, row or
 * table closes what is open. A table inside a cell stays in that cell, its cells joined by commas.
 */
export function htmlToText(html: string): string {
  let source = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ' ')
    /* the doctype, and the XML declaration Word writes at the top of a web page */
    .replace(/<![^>]*>|<\?[\s\S]*?\?>/g, ' ')
    .replace(/<(script|style|noscript|template|svg|select|object|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const title = inline(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(source)?.[1] ?? '');
  source = source.replace(/<head\b[\s\S]*?<\/head\s*>/i, ' ');

  const lines: string[] = title ? [title] : [];
  const tables: TableFrame[] = [];
  let text = '';
  let prefix = '';

  const top = (): TableFrame | undefined => tables[tables.length - 1];
  const flush = (): void => {
    const words = inline(text);
    text = '';
    if (!words) return;
    const frame = top();
    if (frame?.cell !== null && frame?.cell !== undefined) frame.cell = `${frame.cell} ${words}`;
    else {
      lines.push(prefix + words);
      prefix = '';
    }
  };
  const endCell = (frame: TableFrame): void => {
    flush();
    if (frame.cell === null) return;
    (frame.row ??= []).push(frame.cell.replace(/\s+/g, ' ').trim());
    frame.cell = null;
  };
  const endRow = (frame: TableFrame): void => {
    endCell(frame);
    const row = frame.row;
    frame.row = null;
    if (!row || !row.some(Boolean)) return;
    const outer = tables[tables.length - 2];
    if (outer && outer.cell !== null) frame.rows.push(row.filter(Boolean).join(', '));
    else lines.push(row.join(' | '));
  };

  const tag = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let at = 0;
  for (let found = tag.exec(source); found !== null; found = tag.exec(source)) {
    text += source.slice(at, found.index);
    at = tag.lastIndex;
    const closing = found[1] === '/';
    const name = found[2]!.toLowerCase();
    const frame = top();

    if (name === 'table') {
      if (!closing) {
        flush();
        tables.push({ row: null, cell: null, rows: [] });
      } else if (frame) {
        endRow(frame);
        tables.pop();
        const outer = top();
        if (outer && outer.cell !== null && frame.rows.length > 0) outer.cell = `${outer.cell} ${frame.rows.join('; ')}`;
      }
    } else if (name === 'tr' && frame) {
      endRow(frame);
      if (!closing) frame.row = [];
    } else if ((name === 'td' || name === 'th') && frame) {
      endCell(frame);
      if (!closing) frame.cell = '';
    } else if (/^h[1-6]$/.test(name)) {
      flush();
      if (!closing) prefix = `${'#'.repeat(Number(name[1]))} `;
    } else if (name === 'li') {
      flush();
      if (!closing) prefix = '- ';
    } else if (BLOCK.has(name)) {
      flush();
    }
  }
  text += source.slice(at);
  flush();
  while (tables.length > 0) {
    endRow(tables[tables.length - 1]!);
    tables.pop();
  }
  return lines.join('\n');
}

/**
 * A web page's bytes as text, in the encoding it declares: a byte-order mark first, then a
 * `<meta charset>` or `content="...; charset=..."` near the top. Word saves a web page in
 * windows-1252, where reading it as UTF-8 would turn every accented letter and curly quote into a
 * replacement mark. A label the browser does not know falls back to UTF-8.
 */
export function decodeHtmlBytes(bytes: Uint8Array): string {
  let label = 'utf-8';
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) label = 'utf-8';
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) label = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) label = 'utf-16be';
  else {
    /* the declaration is ASCII in any encoding a page can declare it in */
    const head = new TextDecoder('windows-1252').decode(bytes.slice(0, 4096));
    label = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head)?.[1] ?? 'utf-8';
  }
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

export async function docxToText(bytes: Uint8Array): Promise<string> {
  const files = await unzip(bytes);
  const body = files['word/document.xml'];
  if (!body) throw new Error('This does not look like a Word document (no word/document.xml inside).');
  return docxXmlToText(new TextDecoder().decode(body));
}

/**
 * Every sheet as parts of text, the layout `SHEET_CONTEXT` in server/ai/prompts.ts describes.
 *
 * Each sheet starts a part of its own, so the AI can leave a whole sheet out (instructions,
 * pricing) without cutting into the next. Each row keeps its real row number, which is the only
 * place a person can find it again in the client's file. The header row, the first of the opening
 * rows with three cells filled, is written as a Columns line and repeated at the top of every part
 * that continues the sheet, so a row is never read without its column names.
 */
export function workbookToParts(workbook: Workbook, rowsPerPart = SHEET_ROWS): string[] {
  const parts: string[] = [];
  for (const [name, table] of Object.entries(workbook)) {
    const filled = table
      .map((row, index) => {
        const cells = row.map((cell) => String(cell ?? '').replace(/\s+/g, ' ').trim());
        let end = cells.length;
        while (end > 0 && !cells[end - 1]) end -= 1;
        return { index, cells: cells.slice(0, end) };
      })
      .filter((row) => row.cells.some(Boolean));
    if (filled.length === 0) continue;

    const header = filled.slice(0, 10).find((row) => row.cells.filter(Boolean).length >= 3);
    const columns = header ? `Columns (row ${header.index + 1}): ${header.cells.join(' | ')}` : '';
    let lines = [`## Sheet: ${name}`];
    let rows = 0;
    let chars = lines[0]!.length;
    for (const row of filled) {
      if (row === header) {
        lines.push(columns);
        chars += columns.length + 1;
        continue;
      }
      const line = `Row ${row.index + 1}: ${row.cells.join(' | ')}`;
      if (rows > 0 && (rows >= rowsPerPart || chars + line.length + 1 > PART_CHARS)) {
        parts.push(lines.join('\n'));
        lines = [`## Sheet: ${name} (continued)`, ...(columns ? [columns] : [])];
        rows = 0;
        chars = lines.join('\n').length;
      }
      lines.push(line);
      rows += 1;
      chars += line.length + 1;
    }
    parts.push(lines.join('\n'));
  }
  return parts;
}

/**
 * A CSV file's rows. Handles quoted cells with commas, doubled quotes and line breaks inside them,
 * and takes a semicolon or tab as the separator when the first line uses one, as Excel does in
 * locales where the comma is the decimal mark.
 */
export function csvToRows(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (mark: string): number => firstLine.split(mark).length - 1;
  const separator = [';', '\t'].find((mark) => count(mark) > count(',')) ?? ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = false;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === separator) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * Text cut into parts of about `size` characters at line breaks, each headed `[[Part N]]`.
 * A single line longer than a part is cut at the last space before the limit.
 */
export function paginate(text: string, size = PART_CHARS): { text: string; parts: number } {
  const pieces: string[] = [];
  for (const line of text.split('\n')) {
    let rest = line;
    while (rest.length > size) {
      const space = rest.lastIndexOf(' ', size);
      const cut = space > size / 2 ? space : size;
      pieces.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
    pieces.push(rest);
  }

  const parts: string[] = [];
  let current: string[] = [];
  let length = 0;
  for (const piece of pieces) {
    if (length > 0 && length + piece.length + 1 > size) {
      parts.push(current.join('\n'));
      current = [];
      length = 0;
    }
    current.push(piece);
    length += piece.length + 1;
  }
  if (current.join('').trim()) parts.push(current.join('\n'));

  return { text: parts.map((part, index) => `[[Part ${index + 1}]]\n${part.trim()}`).join('\n\n'), parts: parts.length };
}

export interface PreparedDocument {
  name: string;
  kind: 'pdf' | 'text';
  body: Uint8Array;
  /** Parts of converted text. 0 for a PDF: the fit step counts its pages. */
  pages: number;
  /** Parts one extraction call reads, for a spreadsheet (`SHEET_SPAN`). Missing means the usual. */
  span?: number;
}

const encoded = (name: string, text: string): Uint8Array => {
  const body = new TextEncoder().encode(text);
  if (body.length > MAX_UPLOAD_BYTES) throw new Error(`${name} converts to ${megabytes(body.length)} of text, over the ${megabytes(MAX_UPLOAD_BYTES)} limit.`);
  return body;
};

/** Turns converted text into the upload body, refusing text that would not survive the trip. */
export function preparedText(name: string, text: string): PreparedDocument {
  if (!text.trim()) throw new Error(`${name} has no text in it. If it is a scan, export it as a PDF instead.`);
  const paged = paginate(text);
  return { name, kind: 'text', body: encoded(name, paged.text), pages: paged.parts };
}

/** A spreadsheet's rows as the upload body, in parts of rows, read `SHEET_SPAN` parts at a time. */
export function preparedSheet(name: string, workbook: Workbook): PreparedDocument {
  const parts = workbookToParts(workbook);
  if (parts.length === 0) throw new Error(`${name} has no filled cells in it.`);
  const text = parts.map((part, index) => `[[Part ${index + 1}]]\n${part}`).join('\n\n');
  return { name, kind: 'text', body: encoded(name, text), pages: parts.length, span: SHEET_SPAN };
}

/** Reads a chosen file into what the server uploads. */
export async function prepareTenderFile(name: string, bytes: Uint8Array): Promise<PreparedDocument> {
  const kind = tenderFileKind(name);
  if (kind === 'pdf') {
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error(`${name} is not a readable PDF.`);
    return { name, kind: 'pdf', body: bytes, pages: 0 };
  }
  if (kind === 'docx') return preparedText(name, await docxToText(bytes));
  /* hidden sheets are the workbook's plumbing (dropdown lists, lookups), not the tender */
  if (kind === 'xlsx') return preparedSheet(name, await readWorkbook(bytes, { skipHidden: true }));
  if (kind === 'csv') return preparedSheet(name, { [name.replace(/\.csv$/i, '')]: csvToRows(new TextDecoder().decode(bytes)) });
  if (kind === 'html') return preparedText(name, htmlToText(decodeHtmlBytes(bytes)));
  if (kind === 'text') return preparedText(name, new TextDecoder().decode(bytes));
  throw new Error(`${name} is not ${KINDS_IN_WORDS}.`);
}
