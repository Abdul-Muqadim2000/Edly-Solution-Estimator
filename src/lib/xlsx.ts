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

/** One edge of a cell border. Colours are hex, with or without the '#'. */
export interface BorderEdge {
  style: 'thin' | 'medium' | 'thick' | 'hair';
  color: string;
}

/**
 * How a cell looks. The writer turns every distinct one into an entry in the workbook's style
 * table, so a sheet describes its formatting per cell and never has to manage style ids.
 */
export interface CellStyle {
  font?: { name?: string; size?: number; bold?: boolean; italic?: boolean; underline?: boolean; color?: string };
  /** Solid background colour. */
  fill?: string;
  border?: { left?: BorderEdge; right?: BorderEdge; top?: BorderEdge; bottom?: BorderEdge };
  align?: { h?: 'left' | 'center' | 'right'; v?: 'top' | 'center' | 'bottom'; wrap?: boolean; indent?: number };
  /** An Excel number format, such as '#,##0.0#' or '"$"#,##0'. */
  numFmt?: string;
}

export interface StyledCell {
  v?: string | number | null;
  /** Numeric value, written as a real number Excel can sum. */
  n?: number | null;
  s?: CellStyle;
  /** A place in this workbook the cell jumps to when clicked, such as "'Task Breakdown'!A1". */
  link?: string;
}

export type SheetCell = CellValue | StyledCell;

export interface SheetRow {
  cells?: (SheetCell | null)[];
  /** Row height in points. */
  h?: number;
}

export interface SheetPrint {
  landscape?: boolean;
  /** Scale the sheet to one page wide, however many pages tall. */
  fitWidth?: boolean;
  /** First and last row, from 1, printed at the top of every page. */
  repeatRows?: [number, number];
  /** Excel header/footer codes, such as '&LEdly&RPage &P of &N'. */
  footer?: string;
}

export interface StyledSheet {
  rows: SheetRow[];
  /** A1-notation ranges, e.g. "A1:E1". */
  merges?: string[];
  /** Column widths in characters. */
  widths?: number[];
  /** Colour of the sheet's tab. */
  tab?: string;
  /** Excel's cell gridlines. On unless a sheet draws its own lines. */
  gridlines?: boolean;
  /** Rows kept in view while the rest scrolls. */
  freezeRows?: number;
  print?: SheetPrint;
}

/* --------------------------------------------------------------- styles ---- */

const argb = (hex: string): string => {
  const clean = hex.replace(/^#/, '').toUpperCase();
  return clean.length === 6 ? `FF${clean}` : clean;
};

const edgeXml = (side: 'left' | 'right' | 'top' | 'bottom', edge: BorderEdge | undefined): string =>
  edge ? `<${side} style="${edge.style}"><color rgb="${argb(edge.color)}"/></${side}>` : `<${side}/>`;

/**
 * The style table a workbook is written with. Entries are shared: two cells with the same look
 * use one `xf`, and two looks with the same font share the font. Index 0 of each list is the
 * default Excel expects there, and index 1 of the fills is the gray125 pattern it reserves.
 */
class StyleTable {
  private readonly fonts: string[] = ['<font><sz val="11"/><color rgb="FF252525"/><name val="Calibri"/><family val="2"/></font>'];
  private readonly fills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  private readonly borders: string[] = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  private readonly formats: string[] = [];
  private readonly xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private readonly known = new Map<string, number>();

  private static slot(list: string[], xml: string): number {
    const found = list.indexOf(xml);
    if (found >= 0) return found;
    list.push(xml);
    return list.length - 1;
  }

  /** The `s` attribute for a cell with this look. 0 is the default and needs no attribute. */
  id(style: CellStyle | undefined): number {
    if (!style) return 0;
    const key = JSON.stringify(style);
    const cached = this.known.get(key);
    if (cached !== undefined) return cached;

    const f = style.font ?? {};
    const fontXml =
      '<font>' +
      (f.bold ? '<b/>' : '') +
      (f.italic ? '<i/>' : '') +
      (f.underline ? '<u/>' : '') +
      /* family 2 is sans-serif: where a font such as Poppins is not installed, Excel substitutes a
         sans-serif one instead of falling back to a serif */
      `<sz val="${f.size ?? 11}"/><color rgb="${argb(f.color ?? '252525')}"/><name val="${escapeXml(f.name ?? 'Calibri')}"/><family val="2"/></font>`;
    const fontId = StyleTable.slot(this.fonts, fontXml);
    const fillId = style.fill
      ? StyleTable.slot(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="${argb(style.fill)}"/><bgColor indexed="64"/></patternFill></fill>`)
      : 0;
    const b = style.border;
    /* the schema fixes the edge order: left, right, top, bottom, diagonal */
    const borderId = b
      ? StyleTable.slot(this.borders, `<border>${edgeXml('left', b.left)}${edgeXml('right', b.right)}${edgeXml('top', b.top)}${edgeXml('bottom', b.bottom)}<diagonal/></border>`)
      : 0;
    const formatId = style.numFmt ? 164 + StyleTable.slot(this.formats, style.numFmt) : 0;

    const a = style.align;
    const alignment = a
      ? '<alignment' +
        (a.h ? ` horizontal="${a.h}"` : '') +
        (a.v ? ` vertical="${a.v}"` : '') +
        (a.wrap ? ' wrapText="1"' : '') +
        (a.indent ? ` indent="${a.indent}"` : '') +
        '/>'
      : '';
    const xf =
      `<xf numFmtId="${formatId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"` +
      ' applyFont="1"' +
      (fillId ? ' applyFill="1"' : '') +
      (borderId ? ' applyBorder="1"' : '') +
      (formatId ? ' applyNumberFormat="1"' : '') +
      (alignment ? ` applyAlignment="1">${alignment}</xf>` : '/>');

    const id = StyleTable.slot(this.xfs, xf);
    this.known.set(key, id);
    return id;
  }

  xml(): string {
    const formats = this.formats.map((code, i) => `<numFmt numFmtId="${164 + i}" formatCode="${escapeXml(code)}"/>`).join('');
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (formats ? `<numFmts count="${this.formats.length}">${formats}</numFmts>` : '') +
      `<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join('')}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join('')}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>'
    );
  }
}

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

export function zipStored(files: { name: string; data: string | Uint8Array }[]): Uint8Array {
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

/**
 * Read a workbook into `{ sheetName: rows }`, row 0 being the first row. `skipHidden` leaves out
 * sheets hidden in Excel; the catalog import reads every sheet, so it is off unless asked for.
 */
export async function readWorkbook(input: ArrayBuffer | Uint8Array, options: { skipHidden?: boolean } = {}): Promise<Workbook> {
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
  const sheetRe = /<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*>/g;
  const workbookXml = text('xl/workbook.xml');
  let sheetMatch: RegExpExecArray | null;
  while ((sheetMatch = sheetRe.exec(workbookXml))) {
    if (options.skipHidden && /\sstate="(hidden|veryHidden)"/.test(sheetMatch[0])) continue;
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

function worksheetXml(sheet: StyledSheet, styles: StyleTable, selected: boolean): string {
  const { rows, merges = [], widths = [], tab, gridlines = true, freezeRows = 0, print } = sheet;
  const cols =
    widths.length > 0
      ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
      : '';
  const links: string[] = [];

  const sheetPr =
    tab || print?.fitWidth
      ? `<sheetPr>${tab ? `<tabColor rgb="${argb(tab)}"/>` : ''}${print?.fitWidth ? '<pageSetUpPr fitToPage="1"/>' : ''}</sheetPr>`
      : '';
  const top = `A${freezeRows + 1}`;
  const pane =
    freezeRows > 0
      ? `<pane ySplit="${freezeRows}" topLeftCell="${top}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="${top}" sqref="${top}"/>`
      : '';
  const views =
    `<sheetViews><sheetView workbookViewId="0"${gridlines ? '' : ' showGridLines="0"'}${selected ? ' tabSelected="1"' : ''}` +
    (pane ? `>${pane}</sheetView>` : '/>') +
    '</sheetViews>';

  let out =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `${sheetPr}${views}${cols}<sheetData>`;

  rows.forEach((row, rowIndex) => {
    out += `<row r="${rowIndex + 1}"${row?.h ? ` ht="${row.h}" customHeight="1"` : ''}>`;
    (row?.cells ?? []).forEach((cell, cellIndex) => {
      if (cell === null || cell === undefined) return;
      const ref = columnRef(cellIndex) + (rowIndex + 1);
      const styled: StyledCell = typeof cell === 'object' ? cell : typeof cell === 'number' ? { n: cell } : { v: cell };
      const id = styles.id(styled.s);
      const st = id ? ` s="${id}"` : '';
      if (styled.link) links.push(`<hyperlink ref="${ref}" location="${escapeXml(styled.link)}" display="${escapeXml(String(styled.v ?? ''))}"/>`);
      if (styled.n !== null && styled.n !== undefined && Number.isFinite(styled.n)) {
        out += `<c r="${ref}"${st}><v>${styled.n}</v></c>`;
      } else if (styled.v !== null && styled.v !== undefined && styled.v !== '') {
        out += `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${escapeXml(String(styled.v))}</t></is></c>`;
      } else if (id) {
        out += `<c r="${ref}"${st}/>`;
      }
    });
    out += '</row>';
  });

  out += '</sheetData>';
  /* the schema fixes this order too: merges, hyperlinks, margins, page setup, header/footer */
  if (merges.length > 0) {
    out += `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`;
  }
  if (links.length > 0) out += `<hyperlinks>${links.join('')}</hyperlinks>`;
  if (print) {
    out += '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.6" header="0.3" footer="0.3"/>';
    out +=
      '<pageSetup' +
      (print.landscape ? ' orientation="landscape"' : '') +
      (print.fitWidth ? ' fitToWidth="1" fitToHeight="0"' : '') +
      '/>';
    if (print.footer) out += `<headerFooter><oddFooter>${escapeXml(print.footer)}</oddFooter></headerFooter>`;
  }
  return `${out}</worksheet>`;
}

/** A sheet name as a formula reference: quoted, with any quote inside doubled. */
const sheetRef = (name: string): string => `'${name.replace(/'/g, "''")}'`;

/** `{ name: rows }` → the bytes of a .xlsx. */
export function writeWorkbook(sheets: Record<string, CellValue[][] | StyledSheet>): Uint8Array {
  const names = Object.keys(sheets);
  if (names.length === 0) throw new Error('writeWorkbook needs at least one sheet');
  /* cut before escaping, or the cut can land inside an entity and break the XML */
  const shown = names.map((name) => name.slice(0, 31));
  const normalised = names.map((name) => normalise(sheets[name]));
  const styles = new StyleTable();
  const worksheets = normalised.map((sheet, i) => worksheetXml(sheet, styles, i === 0));

  const printTitles = normalised
    .map((sheet, i) => {
      const repeat = sheet.print?.repeatRows;
      if (!repeat) return '';
      return `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${escapeXml(`${sheetRef(shown[i]!)}!$${repeat[0]}:$${repeat[1]}`)}</definedName>`;
    })
    .join('');

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
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<bookViews><workbookView/></bookViews><sheets>' +
        shown.map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets>' +
        (printTitles ? `<definedNames>${printTitles}</definedNames>` : '') +
        '</workbook>'
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
    /* written after the sheets, because writing them is what fills the table */
    { name: 'xl/styles.xml', data: styles.xml() }
  ];

  worksheets.forEach((xml, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xml }));

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
