/* Dependency-free XLSX read + write for Bun / Vercel functions and the browser.
   Reader: stored + deflate zip, SpreadsheetML worksheets -> rows of plain values.
   Writer: stored zip, inline strings -> a workbook Excel and Sheets both open.
   No npm packages: Bun and modern browsers give us DecompressionStream and CompressionStream. */

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ---------------- zip ---------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function inflateRaw(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzip(buffer) {
  const buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a readable .xlsx file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), cmtLen = dv.getUint16(p + 32, true);
    entries.push({
      name: dec.decode(buf.subarray(p + 46, p + 46 + nameLen)),
      offset: dv.getUint32(p + 42, true),
      method: dv.getUint16(p + 10, true),
      size: dv.getUint32(p + 20, true)
    });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  const out = {};
  for (const e of entries) {
    const nl = dv.getUint16(e.offset + 26, true), el = dv.getUint16(e.offset + 28, true);
    const start = e.offset + 30 + nl + el;
    const raw = buf.subarray(start, start + e.size);
    out[e.name] = e.method === 0 ? raw : await inflateRaw(raw);
  }
  return out;
}

function zipStored(files) {
  const parts = [], central = [];
  let offset = 0;
  const u16 = v => [v & 255, (v >> 8) & 255];
  const u32 = v => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  files.forEach(f => {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const lh = [...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
    parts.push(new Uint8Array(lh), name, data);
    const ch = [...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length),
      ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)];
    central.push(new Uint8Array(ch), name);
    offset += lh.length + name.length + data.length;
  });
  let cdSize = 0;
  central.forEach(p => { cdSize += p.length; });
  const eocd = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const chunks = [...parts, ...central, eocd];
  let total = 0;
  chunks.forEach(c => { total += c.length; });
  const result = new Uint8Array(total);
  let at = 0;
  chunks.forEach(c => { result.set(c, at); at += c.length; });
  return result;
}

/* ---------------- read ---------------- */

const ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const unescapeXml = s => String(s).replace(/&(lt|gt|quot|apos|amp|#\d+);/g,
  (m, g) => (g[0] === '#' ? String.fromCharCode(+g.slice(1)) : ENTITIES[g]));

function sharedStrings(xml) {
  const out = [];
  if (!xml) return out;
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) {
    let text = '';
    const tre = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = tre.exec(m[1]))) text += tm[1];
    out.push(unescapeXml(text));
  }
  return out;
}

/* rows[rowIndex] = { A: value, B: value } — handles self-closing empty cells */
function sheetRows(xml, sst) {
  const rows = [];
  const rre = /<row[^>]*\sr="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rre.exec(xml))) {
    const cells = {}, body = rm[2];
    const cre = /<c\s+r="([A-Z]+)\d+"((?:[^>"]|"[^"]*")*?)(\/>|>)/g;
    let cm;
    while ((cm = cre.exec(body))) {
      const col = cm[1], attrs = cm[2];
      let value = '';
      if (cm[3] === '>') {
        const end = body.indexOf('</c>', cre.lastIndex);
        const inner = end < 0 ? '' : body.slice(cre.lastIndex, end);
        if (end >= 0) cre.lastIndex = end + 4;
        const type = (attrs.match(/t="([^"]+)"/) || [])[1];
        if (type === 's') {
          const idx = (inner.match(/<v>(\d+)<\/v>/) || [])[1];
          value = sst[+idx] != null ? sst[+idx] : '';
        } else if (type === 'inlineStr' || type === 'str') {
          const im = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
          value = im ? unescapeXml(im[1]) : unescapeXml((inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '');
        } else {
          value = unescapeXml((inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '');
        }
      }
      cells[col] = String(value).trim();
    }
    rows[+rm[1]] = cells;
  }
  return rows;
}

const colIndex = ref => {
  let n = 0;
  for (let i = 0; i < ref.length; i++) n = n * 26 + (ref.charCodeAt(i) - 64);
  return n - 1;
};

/** Read a workbook into { sheetName: Array<Array<string>> } (row 0 = first row). */
export async function readWorkbook(buffer) {
  const files = await unzip(buffer);
  const text = key => (files[key] ? dec.decode(files[key]) : '');
  const sst = sharedStrings(text('xl/sharedStrings.xml'));
  const rels = {};
  {
    const re = /Id="([^"]+)"[^>]*?Target="([^"]+)"/g;
    let m;
    const xml = text('xl/_rels/workbook.xml.rels');
    while ((m = re.exec(xml))) rels[m[1]] = m[2];
  }
  const out = {};
  const re = /<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g;
  let m;
  const wb = text('xl/workbook.xml');
  while ((m = re.exec(wb))) {
    const target = rels[m[2]];
    if (!target) continue;
    const path = 'xl/' + String(target).replace(/^\/?xl\//, '');
    const rows = sheetRows(text(path), sst);
    const table = [];
    rows.forEach((cells, rowNo) => {
      if (!cells) return;
      const arr = [];
      Object.keys(cells).forEach(col => { arr[colIndex(col)] = cells[col]; });
      for (let i = 0; i < arr.length; i++) if (arr[i] === undefined) arr[i] = '';
      table[rowNo - 1] = arr;
    });
    for (let i = 0; i < table.length; i++) if (!table[i]) table[i] = [];
    out[unescapeXml(m[1])] = table;
  }
  return out;
}

/** Rows of objects from a sheet whose first row is the header. */
export function rowsToObjects(table) {
  if (!table || !table.length) return [];
  const header = (table[0] || []).map(h => String(h || '').trim());
  return table.slice(1)
    .filter(r => r && r.some(c => String(c || '').trim() !== ''))
    .map(r => {
      const o = {};
      header.forEach((h, i) => { if (h) o[h] = r[i] != null ? r[i] : ''; });
      return o;
    });
}

/* ---------------- write ---------------- */

const escXml = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const colRef = i => {
  let s = '', n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

function worksheetXml(rows) {
  let out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
  rows.forEach((row, ri) => {
    out += '<row r="' + (ri + 1) + '">';
    (row || []).forEach((cell, ci) => {
      if (cell == null || cell === '') return;
      const ref = colRef(ci) + (ri + 1);
      if (typeof cell === 'number' && isFinite(cell)) out += '<c r="' + ref + '"><v>' + cell + '</v></c>';
      else out += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + escXml(cell) + '</t></is></c>';
    });
    out += '</row>';
  });
  return out + '</sheetData></worksheet>';
}

/** sheets: { name: Array<Array<string|number>> } -> Uint8Array of a .xlsx */
export function writeWorkbook(sheets) {
  const names = Object.keys(sheets);
  if (!names.length) throw new Error('writeWorkbook needs at least one sheet');
  const files = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + names.map((n, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')
      + '</Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>' },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + names.map((n, i) => '<sheet name="' + escXml(n).slice(0, 31) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('')
      + '</sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + names.map((n, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('')
      + '</Relationships>' }
  ];
  names.forEach((n, i) => files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: worksheetXml(sheets[n]) }));
  return zipStored(files);
}
