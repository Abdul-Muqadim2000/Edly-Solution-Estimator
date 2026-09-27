import { describe, expect, it } from 'vitest';
import { fingerprint, readWorkbook, rowsToObjects, unzip, writeWorkbook, type CellStyle, type StyledSheet } from '../src/lib/xlsx';

/**
 * The spreadsheet reader and writer, which are written here rather than installed.
 *
 * That is a deliberate trade — two runtime dependencies instead of a tree — and the price is that
 * the OOXML corners nobody thinks about are ours to get right: XML escaping, columns past Z,
 * a sheet name Excel will not accept, a gap in the middle of a row. Each of those is a silently
 * corrupt file rather than an error, so each is asserted here.
 */

const roundTrip = async (sheets: Record<string, (string | number | null)[][]>): Promise<Record<string, string[][]>> =>
  readWorkbook(writeWorkbook(sheets));

describe('a workbook survives the round trip', () => {
  it('keeps sheets, rows and cells where they were', async () => {
    const back = await roundTrip({
      Estimations: [
        ['id', 'name', 'total'],
        ['EST-1', 'Acme Academy', 120]
      ],
      Requests: [['id'], ['RQ-01']]
    });

    expect(Object.keys(back)).toEqual(['Estimations', 'Requests']);
    expect(back.Estimations?.[0]).toEqual(['id', 'name', 'total']);
    expect(back.Estimations?.[1]).toEqual(['EST-1', 'Acme Academy', '120']);
    expect(back.Requests?.[1]).toEqual(['RQ-01']);
  });

  it('writes a real zip, which is what makes Excel open it at all', () => {
    const bytes = writeWorkbook({ Sheet1: [['a']] });
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('contains the parts the format requires', async () => {
    const files = await unzip(writeWorkbook({ Sheet1: [['a']] }));
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml'])
    );
  });

  it('refuses a workbook with no sheets rather than writing an unopenable file', () => {
    expect(() => writeWorkbook({})).toThrow(/at least one sheet/i);
  });
});

describe('the characters that break XML', () => {
  it('carries ampersands, angle brackets and quotes through unharmed', async () => {
    const value = 'Tom & Jerry <script>alert("x")</script> — 50% > 40%';
    const back = await roundTrip({ Sheet1: [[value]] });
    expect(back.Sheet1?.[0]?.[0]).toBe(value);
  });

  it('carries them in a sheet name too', async () => {
    /* the sheet name is interpolated into workbook.xml, and it is read back out of an attribute */
    const back = await roundTrip({ 'R&D': [['x']] });
    expect(Object.keys(back)).toEqual(['R&D']);
  });

  it('keeps non-ASCII intact, so a client name is not mangled', async () => {
    const back = await roundTrip({ Sheet1: [['Universität Köln', '東京大学', 'Café — naïve', '🎓']] });
    expect(back.Sheet1?.[0]).toEqual(['Universität Köln', '東京大学', 'Café — naïve', '🎓']);
  });

  it('keeps newlines and tabs inside a cell', async () => {
    const back = await roundTrip({ Sheet1: [['line one\nline two\tindented']] });
    expect(back.Sheet1?.[0]?.[0]).toBe('line one\nline two\tindented');
  });

  it('drops the control characters that would make the file unopenable', async () => {
    const back = await roundTrip({ Sheet1: [['before\u0000\u0001after']] });
    expect(back.Sheet1?.[0]?.[0]).toBe('beforeafter');
  });
});

describe('cells that are not simple strings', () => {
  it('writes a number as a number, and reads it back as its text', async () => {
    const back = await roundTrip({ Sheet1: [[0, 42, -17, 3.5, 1e6]] });
    expect(back.Sheet1?.[0]).toEqual(['0', '42', '-17', '3.5', '1000000']);
  });

  it('does not store a non-finite number as one', async () => {
    /* `<v>NaN</v>` is not valid, and Excel refuses the whole file for it */
    const back = await roundTrip({ Sheet1: [[Number.NaN, Number.POSITIVE_INFINITY, 7]] });
    expect(back.Sheet1?.[0]?.[2]).toBe('7');
    expect(back.Sheet1?.[0]?.[0] ?? '').not.toMatch(/NaN/);
  });

  it('treats null, undefined and empty string as an empty cell', async () => {
    const back = await roundTrip({ Sheet1: [['a', null, '', 'd']] });
    expect(back.Sheet1?.[0]?.[0]).toBe('a');
    expect(back.Sheet1?.[0]?.[3]).toBe('d');
    expect(back.Sheet1?.[0]?.[1] ?? '').toBe('');
  });

  it('keeps a gap in the middle of a row in the right column', async () => {
    /* an empty cell is not written at all, so the column only survives via its own reference */
    const back = await roundTrip({ Sheet1: [['a', null, null, 'd']] });
    expect(back.Sheet1?.[0]?.[3]).toBe('d');
  });

  it('keeps a string of digits a string, so an id is not rounded', async () => {
    const back = await roundTrip({ Sheet1: [['00123', '1e5', '9007199254740993']] });
    expect(back.Sheet1?.[0]).toEqual(['00123', '1e5', '9007199254740993']);
  });
});

describe('the wide and tall cases', () => {
  it('addresses columns past Z correctly', async () => {
    /* AA is column 27: get the base-26 wrong and every column after Z lands one place out */
    const row = Array.from({ length: 30 }, (_, i) => `c${i}`);
    const back = await roundTrip({ Sheet1: [row] });
    expect(back.Sheet1?.[0]).toHaveLength(30);
    expect(back.Sheet1?.[0]?.[26]).toBe('c26');
    expect(back.Sheet1?.[0]?.[29]).toBe('c29');
  });

  it('handles a blank row in the middle without losing what follows', async () => {
    const back = await roundTrip({ Sheet1: [['a'], [], ['c']] });
    expect(back.Sheet1?.[0]?.[0]).toBe('a');
    expect(back.Sheet1?.[2]?.[0]).toBe('c');
  });

  it('carries a long cell whole', async () => {
    const long = 'x'.repeat(20_000);
    const back = await roundTrip({ Sheet1: [[long]] });
    expect(back.Sheet1?.[0]?.[0]).toHaveLength(20_000);
  });
});

describe('styled sheets', () => {
  const heading: CellStyle = { font: { name: 'Arial', size: 20, bold: true, color: '#DD1F25' }, border: { bottom: { style: 'medium', color: '#DD1F25' } } };
  const figure: CellStyle = { numFmt: '"$"#,##0', align: { h: 'right' }, fill: '#EBF9F6' };
  const styled: StyledSheet = {
    rows: [
      { cells: [{ v: 'Heading', s: heading }], h: 24 },
      { cells: [{ v: 'Body' }, { n: 120, s: figure }, { n: 80, s: { ...figure } }] }
    ],
    merges: ['A1:B1'],
    widths: [40, 12]
  };
  const text = (files: Record<string, Uint8Array>, name: string): string => new TextDecoder().decode(files[name]);

  it('reads back as the same values, whatever the formatting', async () => {
    const back = await readWorkbook(writeWorkbook({ Quote: styled }));
    expect(back.Quote?.[0]?.[0]).toBe('Heading');
    expect(back.Quote?.[1]).toEqual(['Body', '120', '80']);
  });

  it('writes each look into the style table: font, fill, border and number format', async () => {
    const styles = text(await unzip(writeWorkbook({ Quote: styled })), 'xl/styles.xml');
    expect(styles).toContain('<b/><sz val="20"/><color rgb="FFDD1F25"/><name val="Arial"/>');
    expect(styles).toContain('<fgColor rgb="FFEBF9F6"/>');
    expect(styles).toContain('<bottom style="medium"><color rgb="FFDD1F25"/></bottom>');
    expect(styles).toContain('formatCode="&quot;$&quot;#,##0"');
  });

  it('keeps the two fills Excel reserves in the first two places', async () => {
    /* Excel repairs, or refuses, a file whose fills do not start with none and gray125 */
    const styles = text(await unzip(writeWorkbook({ Quote: styled })), 'xl/styles.xml');
    expect(styles).toMatch(/<fills count="\d+"><fill><patternFill patternType="none"\/><\/fill><fill><patternFill patternType="gray125"\/><\/fill>/);
  });

  it('shares one style between cells that look the same, so a big sheet does not bloat the file', async () => {
    const files = await unzip(writeWorkbook({ Quote: styled }));
    const sheet = text(files, 'xl/worksheets/sheet1.xml');
    const b2 = /<c r="B2" s="(\d+)"/.exec(sheet)?.[1];
    const c2 = /<c r="C2" s="(\d+)"/.exec(sheet)?.[1];
    expect(b2).toBeDefined();
    expect(b2).toBe(c2);
    /* the default, the heading and the figure: three looks, three entries */
    expect(text(files, 'xl/styles.xml')).toContain('<cellXfs count="3">');
  });

  it('tells Excel to substitute a sans-serif face for a font the reader does not have', async () => {
    const styles = text(await unzip(writeWorkbook({ Quote: styled })), 'xl/styles.xml');
    const fonts = styles.match(/<font>.*?<\/font>/g) ?? [];
    expect(fonts.length).toBeGreaterThan(1);
    for (const one of fonts) expect(one).toContain('<family val="2"/>');
  });

  it('colours the tab, hides gridlines and freezes the rows above the table', async () => {
    const sheet = text(await unzip(writeWorkbook({ Quote: { ...styled, tab: '#DD1F25', gridlines: false, freezeRows: 8 } })), 'xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<tabColor rgb="FFDD1F25"/>');
    expect(sheet).toContain('showGridLines="0"');
    expect(sheet).toContain('<pane ySplit="8" topLeftCell="A9" activePane="bottomLeft" state="frozen"/>');
    /* sheetViews must come before cols and sheetData, or Excel reports the file as damaged */
    expect(sheet.indexOf('<sheetViews>')).toBeLessThan(sheet.indexOf('<cols>'));
  });

  it('links a cell to another sheet in the workbook', async () => {
    const linked: StyledSheet = { rows: [{ cells: [{ v: 'Next sheet', link: "'Task Breakdown'!A1" }] }] };
    const sheet = text(await unzip(writeWorkbook({ Intro: linked, 'Task Breakdown': [['x']] })), 'xl/worksheets/sheet1.xml');
    expect(sheet).toContain(`<hyperlink ref="A1" location="'Task Breakdown'!A1" display="Next sheet"/>`);
  });

  it('prints landscape, one page wide, with the header row on every page', async () => {
    const printed: StyledSheet = { ...styled, print: { landscape: true, fitWidth: true, repeatRows: [3, 3], footer: '&LEdly&RPage &P' } };
    const files = await unzip(writeWorkbook({ Cover: [['x']], "Acme's Breakdown": printed }));
    const sheet = text(files, 'xl/worksheets/sheet2.xml');
    expect(sheet).toContain('<pageSetUpPr fitToPage="1"/>');
    expect(sheet).toContain('<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>');
    expect(sheet).toContain('<oddFooter>&amp;LEdly&amp;RPage &amp;P</oddFooter>');
    /* the quote in the name is doubled, as a formula reference needs */
    expect(text(files, 'xl/workbook.xml')).toContain(`<definedName name="_xlnm.Print_Titles" localSheetId="1">'Acme''s Breakdown'!$3:$3</definedName>`);
  });

  it('opens on the first sheet', async () => {
    const files = await unzip(writeWorkbook({ First: [['a']], Second: [['b']] }));
    expect(text(files, 'xl/worksheets/sheet1.xml')).toContain('tabSelected="1"');
    expect(text(files, 'xl/worksheets/sheet2.xml')).not.toContain('tabSelected');
  });

  it('cuts a long sheet name before escaping it, so the cut never splits an entity', async () => {
    const name = `${'R'.repeat(29)}&D department`;
    const back = await readWorkbook(writeWorkbook({ [name]: [['x']] }));
    expect(Object.keys(back)).toEqual([name.slice(0, 31)]);
  });
});

describe('rowsToObjects', () => {
  const table = [
    ['id', 'name', ' spaced '],
    ['EST-1', 'Acme', 'yes'],
    ['EST-2', 'Nordic', '']
  ];

  it('keys each row by the header, trimming the header names', () => {
    expect(rowsToObjects(table)).toEqual([
      { id: 'EST-1', name: 'Acme', spaced: 'yes' },
      { id: 'EST-2', name: 'Nordic', spaced: '' }
    ]);
  });

  it('skips rows that are entirely blank, which a hand-edited sheet is full of', () => {
    expect(rowsToObjects([...table, [], ['', '  ', '']])).toHaveLength(2);
  });

  it('gives an absent trailing cell as an empty string, not undefined', () => {
    const rows = rowsToObjects([['id', 'name'], ['EST-1']]);
    expect(rows[0]).toEqual({ id: 'EST-1', name: '' });
  });

  it('ignores a column with no header, rather than keying it as empty', () => {
    const rows = rowsToObjects([['id', ''], ['EST-1', 'orphan']]);
    expect(rows[0]).toEqual({ id: 'EST-1' });
  });

  it('has nothing to say about an empty or missing sheet', () => {
    expect(rowsToObjects(undefined)).toEqual([]);
    expect(rowsToObjects([])).toEqual([]);
    expect(rowsToObjects([['id', 'name']])).toEqual([]);
  });
});

describe('fingerprint', () => {
  it('is stable for the same bytes and different for a change', () => {
    const a = writeWorkbook({ Sheet1: [['a']] });
    const b = writeWorkbook({ Sheet1: [['b']] });

    expect(fingerprint(a)).toBe(fingerprint(a));
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it('reads an ArrayBuffer and a view of it the same way', () => {
    const bytes = writeWorkbook({ Sheet1: [['a']] });
    const copy = new Uint8Array(bytes);
    expect(fingerprint(copy.buffer as ArrayBuffer)).toBe(fingerprint(bytes));
  });
});
