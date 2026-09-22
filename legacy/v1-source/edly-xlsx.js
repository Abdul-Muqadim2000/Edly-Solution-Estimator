/* Minimal branded XLSX writer (stored zip, no deps). window.EdlyXlsx.make(filename, {rows, merges, widths}) */
(function () {
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  const enc = new TextEncoder();
  function zip(files) {
    const parts = [], central = []; let offset = 0;
    files.forEach(f => {
      const nameB = enc.encode(f.name), dataB = enc.encode(f.data), crc = crc32(dataB);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, dataB.length, true); lh.setUint32(22, dataB.length, true);
      lh.setUint16(26, nameB.length, true);
      parts.push(new Uint8Array(lh.buffer), nameB, dataB);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, dataB.length, true); ch.setUint32(24, dataB.length, true);
      ch.setUint16(28, nameB.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), nameB);
      offset += 30 + nameB.length + dataB.length;
    });
    let cd = 0; central.forEach(p => cd += p.length);
    const eo = new DataView(new ArrayBuffer(22));
    eo.setUint32(0, 0x06054b50, true); eo.setUint16(8, files.length, true); eo.setUint16(10, files.length, true);
    eo.setUint32(12, cd, true); eo.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(eo.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function colRef(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function sheetXml(rows, merges, widths) {
    const cols = widths && widths.length ? '<cols>' + widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>' : '';
    let out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + cols + '<sheetData>';
    rows.forEach((r, ri) => {
      out += '<row r="' + (ri + 1) + '"' + (r && r.h ? ' ht="' + r.h + '" customHeight="1"' : '') + '>';
      ((r && r.cells) || []).forEach((c, ci) => {
        if (c == null) return;
        const ref = colRef(ci) + (ri + 1), st = c.s ? ' s="' + c.s + '"' : '';
        if (c.n != null) out += '<c r="' + ref + '"' + st + '><v>' + c.n + '</v></c>';
        else if (c.v != null && c.v !== '') out += '<c r="' + ref + '" t="inlineStr"' + st + '><is><t xml:space="preserve">' + esc(c.v) + '</t></is></c>';
        else if (c.s) out += '<c r="' + ref + '"' + st + '/>';
      });
      out += '</row>';
    });
    out += '</sheetData>';
    if (merges && merges.length) out += '<mergeCells count="' + merges.length + '">' + merges.map(m => '<mergeCell ref="' + m + '"/>').join('') + '</mergeCells>';
    return out + '</worksheet>';
  }
  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="7">'
    + '<font><sz val="11"/><name val="Calibri"/><color rgb="FF252525"/></font>'
    + '<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF252525"/></font>'
    + '<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>'
    + '<font><b/><sz val="15"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>'
    + '<font><sz val="10"/><name val="Calibri"/><color rgb="FF666666"/></font>'
    + '<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF0A6B5B"/></font>'
    + '<font><b/><sz val="12"/><name val="Calibri"/><color rgb="FF252525"/></font>'
    + '</fonts>'
    + '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FF252525"/><bgColor rgb="FF252525"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFEBF9F6"/><bgColor rgb="FFEBF9F6"/></patternFill></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="7">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>'
    + '<xf numFmtId="0" fontId="3" fillId="2" borderId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>'
    + '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" applyFont="1"/>'
    + '<xf numFmtId="0" fontId="2" fillId="2" borderId="0" applyFont="1" applyFill="1"/>'
    + '<xf numFmtId="0" fontId="1" fillId="3" borderId="0" applyFont="1" applyFill="1"/>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1"/>'
    + '<xf numFmtId="0" fontId="5" fillId="0" borderId="0" applyFont="1"/>'
    + '</cellXfs></styleSheet>';
  function make(filename, spec) {
    const files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Bundle Estimate" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: STYLES },
      { name: 'xl/worksheets/sheet1.xml', data: sheetXml(spec.rows || [], spec.merges || [], spec.widths || []) }
    ];
    const blob = zip(files);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  window.EdlyXlsx = { make };
})();
