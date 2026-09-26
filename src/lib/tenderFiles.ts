import { readWorkbook, unzip, type Workbook } from '@/lib/xlsx';

/**
 * Getting a tender file ready to send.
 *
 * A PDF goes to Claude as it is, so tables and scanned pages survive. Word, Excel and text files
 * are turned into text here, in the browser, with the zip reader the catalog already uses, then
 * cut into parts marked `[[Part N]]`. Text has no pages, and a requirement still needs a place a
 * person can find it again.
 */

/** Vercel refuses a function request body over 4.5 MB, so one file has to fit under it. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** A Word or Excel file is converted before upload, so only its text has to fit. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES = 5;
/** Characters per part of converted text: about a printed page. */
export const PART_CHARS = 4000;

export type TenderFileKind = 'pdf' | 'docx' | 'xlsx' | 'text';

export function tenderFileKind(name: string): TenderFileKind | null {
  const extension = name.toLowerCase().split('.').pop() ?? '';
  if (extension === 'pdf') return 'pdf';
  if (extension === 'docx') return 'docx';
  if (extension === 'xlsx') return 'xlsx';
  if (extension === 'txt' || extension === 'md' || extension === 'csv') return 'text';
  return null;
}

const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Why a set of chosen files cannot be sent, or null when it can. Checked before anything uploads. */
export function checkTenderFiles(files: readonly { name: string; size: number }[]): string | null {
  if (files.length === 0) return 'Choose at least one file.';
  if (files.length > MAX_FILES) return `At most ${MAX_FILES} files per tender.`;
  for (const file of files) {
    const kind = tenderFileKind(file.name);
    if (!kind) return `${file.name} is not a PDF, Word (.docx), Excel (.xlsx) or text file.`;
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

export async function docxToText(bytes: Uint8Array): Promise<string> {
  const files = await unzip(bytes);
  const body = files['word/document.xml'];
  if (!body) throw new Error('This does not look like a Word document (no word/document.xml inside).');
  return docxXmlToText(new TextDecoder().decode(body));
}

/** Every sheet as text: a heading, then a line per non-empty row with its cells joined by " | ". */
export function workbookToText(workbook: Workbook): string {
  const blocks: string[] = [];
  for (const [name, rows] of Object.entries(workbook)) {
    const lines = rows
      .map((row) => row.map((cell) => String(cell ?? '').replace(/\s+/g, ' ').trim()))
      .map((cells) => {
        let end = cells.length;
        while (end > 0 && !cells[end - 1]) end -= 1;
        return cells.slice(0, end).join(' | ');
      })
      .filter((line) => line.replace(/[|\s]/g, ''));
    if (lines.length > 0) blocks.push([`## ${name}`, ...lines].join('\n'));
  }
  return blocks.join('\n\n');
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
}

/** Turns converted text into the upload body, refusing text that would not survive the trip. */
export function preparedText(name: string, text: string): PreparedDocument {
  if (!text.trim()) throw new Error(`${name} has no text in it. If it is a scan, export it as a PDF instead.`);
  const paged = paginate(text);
  const body = new TextEncoder().encode(paged.text);
  if (body.length > MAX_UPLOAD_BYTES) throw new Error(`${name} converts to ${megabytes(body.length)} of text, over the ${megabytes(MAX_UPLOAD_BYTES)} limit.`);
  return { name, kind: 'text', body, pages: paged.parts };
}

/** Reads a chosen file into what the server uploads. */
export async function prepareTenderFile(name: string, bytes: Uint8Array): Promise<PreparedDocument> {
  const kind = tenderFileKind(name);
  if (kind === 'pdf') {
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error(`${name} is not a readable PDF.`);
    return { name, kind: 'pdf', body: bytes, pages: 0 };
  }
  if (kind === 'docx') return preparedText(name, await docxToText(bytes));
  if (kind === 'xlsx') return preparedText(name, workbookToText(await readWorkbook(bytes)));
  if (kind === 'text') return preparedText(name, new TextDecoder().decode(bytes));
  throw new Error(`${name} is not a PDF, Word (.docx), Excel (.xlsx) or text file.`);
}
