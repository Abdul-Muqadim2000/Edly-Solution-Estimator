/**
 * Dependency-free XLSX read and write, for the browser, Bun and Node.
 *
 * Reader: stored + deflate zip, SpreadsheetML worksheets → rows of plain values.
 * Writer: stored zip, inline strings → a workbook Excel and Google Sheets both open.
 *
 * No npm packages: `DecompressionStream` and `Blob` are built in everywhere this runs.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Rows of a sheet, indexed from 0. Absent cells read as ''. */
export type SheetTable = string[][];
export type Workbook = Record<string, SheetTable>;
/** What the writer accepts — numbers stay numeric in the cell. */
export type CellValue = string | number | null | undefined;
export type WriteSheets = Record<string, CellValue[][]>;

/** A styled cell. `s` indexes STYLES below; plain values still work unstyled. */
export interface StyledCell {
  v?: string | number | null;
  /** Numeric value, written as a real number Excel can sum. */
  n?: number | null;
  s?: StyleId;
}

export type SheetCell = CellValue | StyledCell;

export interface SheetRow {
  cells?: (SheetCell | null)[];
  /** Row height in points. */
  h?: number;
}

/**
 * The branded style slots, matching the source workbook 1:1.
 *
 *   1 title band · 2 grey caption · 3 dark header · 4 brand-wash subtotal
 *   5 bold total · 6 brand-green note
 */
export type StyleId = 1 | 2 | 3 | 4 | 5 | 6;

export interface StyledSheet {
  rows: SheetRow[];
  /** A1-notation ranges, e.g. "A1:E1". */
  merges?: string[];
  /** Column widths in characters. */
  widths?: number[];
}

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="7">' +
  '<font><sz val="11"/><name val="Calibri"/><color rgb="FF252525"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF252525"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>' +
  '<font><b/><sz val="15"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>' +
  '<font><sz val="10"/><name val="Calibri"/><color rgb="FF666666"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF0A6B5B"/></font>' +
  '<font><b/><sz val="12"/><name val="Calibri"/><color rgb="FF252525"/></font>' +
  '</fonts>' +
  '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF252525"/><bgColor rgb="FF252525"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFEBF9F6"/><bgColor rgb="FFEBF9F6"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="7">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>' +
  '<xf numFmtId="0" fontId="3" fillId="2" borderId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
  '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="2" fillId="2" borderId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="3" borderId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="5" fillId="0" borderId="0" applyFont="1"/>' +
  '</cellXfs></styleSheet>';

/* ----------------------------------------------------------------- zip ---- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This runtime cannot unzip .xlsx files (needs DecompressionStream).');
  }
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Every entry in a zip, inflated. */
export async function unzip(input: ArrayBuffer | Uint8Array): Promise<Record<string, Uint8Array>> {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66_000; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a readable .xlsx file');

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries: { name: string; offset: number; method: number; size: number }[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    entries.push({
      name: decoder.decode(buf.subarray(p + 46, p + 46 + nameLen)),
      offset: view.getUint32(p + 42, true),
      method: view.getUint16(p + 10, true),
      size: view.getUint32(p + 20, true)
    });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const out: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    const nameLen = view.getUint16(entry.offset + 26, true);
    const extraLen = view.getUint16(entry.offset + 28, true);
    const start = entry.offset + 30 + nameLen + extraLen;
    const raw = buf.subarray(start, start + entry.size);
    out[entry.name] = entry.method === 0 ? raw : await inflateRaw(raw);
  }
  return out;
}

function zipStored(files: { name: string; data: string | Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number): number[] => [v & 255, (v >> 8) & 255];
  const u32 = (v: number): number[] => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    const crc = crc32(data);
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)
    ];
    parts.push(new Uint8Array(local), name, data);
    const dir = [
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length),
      ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)
    ];
    central.push(new Uint8Array(dir), name);
    offset += local.length + name.length + data.length;
  }

  const centralSize = central.reduce((total, chunk) => total + chunk.length, 0);
  const eocd = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length), ...u32(centralSize), ...u32(offset), ...u16(0)
  ]);

  const chunks = [...parts, ...central, eocd];
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    result.set(chunk, at);
    at += chunk.length;
  }
  return result;
}

/* ---------------------------------------------------------------- read ---- */

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };

const unescapeXml = (value: string): string =>
  value.replace(/&(lt|gt|quot|apos|amp|#\d+);/g, (_, group: string) =>
    group.startsWith('#') ? String.fromCharCode(Number(group.slice(1))) : ENTITIES[group] ?? ''
  );

function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  if (!xml) return out;
  const re = /<si>([\s\S]*?)<\/si>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    let text = '';
    const inner = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let part: RegExpExecArray | null;
    while ((part = inner.exec(match[1]!))) text += part[1];
    out.push(unescapeXml(text));
  }
  return out;
}

/** Cells keyed by column letter, per row number. Handles self-closing empty cells. */
function sheetCells(xml: string, sst: string[]): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const rowRe = /<row[^>]*\sr="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(xml))) {
    const cells: Record<string, string> = {};
    const body = rowMatch[2]!;
    const cellRe = /<c\s+r="([A-Z]+)\d+"((?:[^>"]|"[^"]*")*?)(\/>|>)/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(body))) {
      const column = cellMatch[1]!;
      const attrs = cellMatch[2]!;
      let value = '';
      if (cellMatch[3] === '>') {
        const end = body.indexOf('</c>', cellRe.lastIndex);
        const inner = end < 0 ? '' : body.slice(cellRe.lastIndex, end);
        if (end >= 0) cellRe.lastIndex = end + 4;
        const type = /t="([^"]+)"/.exec(attrs)?.[1];
        if (type === 's') {
          const index = /<v>(\d+)<\/v>/.exec(inner)?.[1];
          value = sst[Number(index)] ?? '';
        } else if (type === 'inlineStr' || type === 'str') {
          const text = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1];
          value = text !== undefined ? unescapeXml(text) : unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '');
        } else {
          value = unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '');
        }
      }
      cells[column] = value.trim();
    }
    rows[Number(rowMatch[1])] = cells;
  }
  return rows;
}

const columnIndex = (ref: string): number => {
  let n = 0;
  for (let i = 0; i < ref.length; i++) n = n * 26 + (ref.charCodeAt(i) - 64);
  return n - 1;
};

/** Read a workbook into `{ sheetName: rows }`, row 0 being the first row. */
export async function readWorkbook(input: ArrayBuffer | Uint8Array): Promise<Workbook> {
  const files = await unzip(input);
  const text = (key: string): string => (files[key] ? decoder.decode(files[key]) : '');
  const sst = sharedStrings(text('xl/sharedStrings.xml'));

  const rels: Record<string, string> = {};
  {
    const re = /Id="([^"]+)"[^>]*?Target="([^"]+)"/g;
    const xml = text('xl/_rels/workbook.xml.rels');
    let match: RegExpExecArray | null;
    while ((match = re.exec(xml))) rels[match[1]!] = match[2]!;
  }

  const out: Workbook = {};
  const sheetRe = /<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g;
  const workbookXml = text('xl/workbook.xml');
  let sheetMatch: RegExpExecArray | null;
  while ((sheetMatch = sheetRe.exec(workbookXml))) {
    const target = rels[sheetMatch[2]!];
    if (!target) continue;
    const path = `xl/${target.replace(/^\/?xl\//, '')}`;
    const cells = sheetCells(text(path), sst);
    const table: SheetTable = [];
    cells.forEach((row, rowNumber) => {
      if (!row) return;
      const line: string[] = [];
      for (const column of Object.keys(row)) line[columnIndex(column)] = row[column]!;
      for (let i = 0; i < line.length; i++) if (line[i] === undefined) line[i] = '';
      table[rowNumber - 1] = line;
    });
    for (let i = 0; i < table.length; i++) if (!table[i]) table[i] = [];
    out[unescapeXml(sheetMatch[1]!)] = table;
  }
  return out;
}

/** Objects from a sheet whose first row is the header. */
export function rowsToObjects(table: SheetTable | undefined): Record<string, string>[] {
  if (!table || table.length === 0) return [];
  const header = (table[0] ?? []).map((h) => String(h ?? '').trim());
  return table
    .slice(1)
    .filter((row) => row && row.some((cell) => String(cell ?? '').trim() !== ''))
    .map((row) => {
      const out: Record<string, string> = {};
      header.forEach((name, i) => {
        if (name) out[name] = row[i] ?? '';
      });
      return out;
    });
}

/* --------------------------------------------------------------- write ---- */

const escapeXml = (value: CellValue): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const columnRef = (index: number): string => {
  let ref = '';
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    ref = String.fromCharCode(65 + remainder) + ref;
    n = Math.floor((n - 1) / 26);
  }
  return ref;
};

function worksheetXml(sheet: StyledSheet): string {
  const { rows, merges = [], widths = [] } = sheet;
  const cols =
    widths.length > 0
      ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
      : '';

  let out =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>`;

  rows.forEach((row, rowIndex) => {
    out += `<row r="${rowIndex + 1}"${row?.h ? ` ht="${row.h}" customHeight="1"` : ''}>`;
    (row?.cells ?? []).forEach((cell, cellIndex) => {
      if (cell === null || cell === undefined) return;
      const ref = columnRef(cellIndex) + (rowIndex + 1);
      const styled: StyledCell = typeof cell === 'object' ? cell : typeof cell === 'number' ? { n: cell } : { v: cell };
      const st = styled.s ? ` s="${styled.s}"` : '';
      if (styled.n !== null && styled.n !== undefined && Number.isFinite(styled.n)) {
        out += `<c r="${ref}"${st}><v>${styled.n}</v></c>`;
      } else if (styled.v !== null && styled.v !== undefined && styled.v !== '') {
        out += `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${escapeXml(String(styled.v))}</t></is></c>`;
      } else if (styled.s) {
        out += `<c r="${ref}"${st}/>`;
      }
    });
    out += '</row>';
  });

  out += '</sheetData>';
  if (merges.length > 0) {
    out += `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`;
  }
  return `${out}</worksheet>`;
}

/** `{ name: rows }` → the bytes of a .xlsx. */
export function writeWorkbook(sheets: Record<string, CellValue[][] | StyledSheet>): Uint8Array {
  const names = Object.keys(sheets);
  if (names.length === 0) throw new Error('writeWorkbook needs at least one sheet');

  const files: { name: string; data: string | Uint8Array }[] = [
    {
      name: '[Content_Types].xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        names
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
          )
          .join('') +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>'
    },
    {
      name: '_rels/.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    },
    {
      name: 'xl/workbook.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        names
          .map((name, i) => `<sheet name="${escapeXml(name).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join('') +
        '</sheets></workbook>'
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        names
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
          )
          .join('') +
        `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>'
    },
    { name: 'xl/styles.xml', data: STYLES }
  ];

  names.forEach((name, i) => {
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: worksheetXml(normalise(sheets[name])) });
  });

  return zipStored(files);
}

/** Accepts either a plain grid or the styled form. */
function normalise(sheet: CellValue[][] | StyledSheet | undefined): StyledSheet {
  if (!sheet) return { rows: [] };
  if (Array.isArray(sheet)) return { rows: sheet.map((cells) => ({ cells })) };
  return sheet;
}

/** Stable fingerprint of a file, to notice when a served sheet changes. */
export function fingerprint(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < bytes.length; i++) {
    h1 = (h1 ^ bytes[i]!) >>> 0;
    h1 = (h1 * 16_777_619) >>> 0;
    if ((i & 7) === 0) h2 = ((h2 + bytes[i]!) * 31) >>> 0;
  }
  return `${bytes.length.toString(36)}-${h1.toString(36)}${h2.toString(36)}`;
}
