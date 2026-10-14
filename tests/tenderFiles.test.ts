import { describe, expect, it } from 'vitest';
import {
  checkTenderFiles,
  csvToRows,
  decodeHtmlBytes,
  docxToText,
  docxXmlToText,
  htmlToText,
  MAX_UPLOAD_BYTES,
  paginate,
  PART_CHARS,
  preparedSheet,
  preparedText,
  prepareTenderFile,
  SHEET_SPAN,
  tenderFileKind,
  workbookToParts
} from '../src/lib/tenderFiles';
import { unzip, writeWorkbook, zipStored } from '../src/lib/xlsx';

/**
 * Tender files are turned into something Claude can read before anything is uploaded.
 *
 * The traps here are silent ones: a table whose cells come apart so a requirement loses its
 * heading, a tag pattern that also matches paragraph properties, a part boundary that swallows a
 * word. None of them fail loudly; they just make the AI read a slightly different tender.
 */

const docx = (body: string): Uint8Array =>
  zipStored([{ name: 'word/document.xml', data: `<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>` }]);

const p = (text: string, props = ''): string => `<w:p>${props}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

describe('which files a tender can use', () => {
  it('knows the kinds by extension, case aside', () => {
    expect(tenderFileKind('RFP.PDF')).toBe('pdf');
    expect(tenderFileKind('annex.docx')).toBe('docx');
    expect(tenderFileKind('pricing.xlsx')).toBe('xlsx');
    expect(tenderFileKind('notes.md')).toBe('text');
    expect(tenderFileKind('matrix.CSV')).toBe('csv');
    expect(tenderFileKind('portal-notice.HTML')).toBe('html');
    expect(tenderFileKind('rfp.htm')).toBe('html');
    expect(tenderFileKind('old.doc')).toBeNull();
  });

  it('says why a set of files cannot be sent, before anything uploads', () => {
    expect(checkTenderFiles([])).toBe('Choose at least one file.');
    expect(checkTenderFiles(Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.pdf`, size: 10 })))).toContain('At most 5');
    expect(checkTenderFiles([{ name: 'old.doc', size: 10 }])).toContain('is not a PDF');
    /* Vercel refuses a bigger body before the function runs, with a page nobody can act on */
    expect(checkTenderFiles([{ name: 'big.pdf', size: MAX_UPLOAD_BYTES + 1 }])).toContain('at most 4.0 MB');
    expect(checkTenderFiles([{ name: 'huge.docx', size: 30 * 1024 * 1024 }])).toContain('over the 25.0 MB limit');
    expect(checkTenderFiles([{ name: 'fine.pdf', size: 1000 }, { name: 'annex.docx', size: 6 * 1024 * 1024 }])).toBeNull();
    expect(checkTenderFiles([{ name: 'notice.html', size: 1000 }])).toBeNull();
    /* the refusal names every kind a person can choose, web pages included */
    expect(checkTenderFiles([{ name: 'old.doc', size: 10 }])).toContain('web page (.html)');
  });
});

describe('reading a Word document', () => {
  it('keeps each paragraph on its own line, and decodes entities', () => {
    const text = docxXmlToText(p('Scope &amp; approach') + p('Learners get &lt;SSO&gt; &#8211; always') + p(''));
    expect(text).toBe('Scope & approach\nLearners get <SSO> – always');
  });

  it('does not mistake paragraph properties for a paragraph', () => {
    /* `<w:pPr>` starts with `<w:p`: matched as a paragraph, it would reset the text mid-run */
    const text = docxXmlToText(`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Requirements</w:t></w:r><w:r><w:tab/><w:t>list</w:t></w:r></w:p>`);
    expect(text).toBe('Requirements list');
  });

  it('keeps a table row together, cells joined, because tenders put requirements in tables', () => {
    const row = (...cells: string[]): string => `<w:tr><w:trPr/>${cells.map((cell) => `<w:tc><w:tcPr/>${p(cell)}</w:tc>`).join('')}</w:tr>`;
    const text = docxXmlToText(p('Annex B') + `<w:tbl>${row('R-12', 'Single sign-on', 'Mandatory')}${row('', '', '')}${row('R-13', 'Grade export', 'Desirable')}</w:tbl>`);
    expect(text).toBe('Annex B\nR-12 | Single sign-on | Mandatory\nR-13 | Grade export | Desirable');
  });

  it('reads the body out of the zip, and says plainly when it is not a Word file', async () => {
    expect(await docxToText(docx(p('Hello from the tender')))).toBe('Hello from the tender');
    await expect(docxToText(writeWorkbook({ Sheet: [['a']] }))).rejects.toThrow('does not look like a Word document');
  });
});

describe('reading a web page', () => {
  const char = (code: number): string => String.fromCodePoint(code);

  it('keeps each heading, paragraph and list item on its own line, and leaves scripts, styles and comments out', () => {
    const page = [
      '<!DOCTYPE html><html><head><title>Nordic University LMS tender</title>',
      '<style>p { color: red }</style><script>var x = "<p>not part of the tender</p>";</script></head>',
      '<body><h1>Scope of work</h1><p>The supplier shall&nbsp;host the platform &amp; support it.</p>',
      '<ul><li>Single sign-on</li><li><p>Grade export</p></li></ul><!-- <p>a draft note</p> --></body></html>'
    ].join('\n');
    expect(htmlToText(page)).toBe(
      /* the title often names the tender; headings keep their level, so the outline survives */
      ['Nordic University LMS tender', '# Scope of work', 'The supplier shall host the platform & support it.', '- Single sign-on', '- Grade export'].join('\n')
    );
  });

  it('keeps a table row together, cells joined, because tenders put requirements in tables', () => {
    const table = '<table><thead><tr><th>ID</th><th>Requirement</th></tr></thead><tbody><tr><td>FR-1</td><td><p>Single sign-on</p><p>with SAML 2.0</p></td></tr>' + '<tr><td>FR-2<td>Grade export</table>';
    /* the second row leaves its cells and the row unclosed, which HTML allows */
    expect(htmlToText(table)).toBe('ID | Requirement\nFR-1 | Single sign-on with SAML 2.0\nFR-2 | Grade export');
  });

  it('keeps the last row of a table the page never closes, as a page saved part way leaves it', () => {
    expect(htmlToText('<p>Requirements</p><table><tr><td>FR-9</td><td>Offline mobile access')).toBe('Requirements\nFR-9 | Offline mobile access');
  });

  it('keeps a table inside a cell in that cell, rather than scattering its rows through the page', () => {
    expect(htmlToText('<table><tr><td>Hosting <table><tr><td>EU</td><td>99.9%</td></tr></table></td><td>Must</td></tr></table>')).toBe('Hosting EU, 99.9% | Must');
  });

  it('reads inline markup as part of the sentence, and a line break as a break', () => {
    expect(htmlToText('<p>The LMS <b>must</b> support <a href="/lti">LTI&nbsp;1.3</a>.<br>Caliper is optional.</p>')).toBe('The LMS must support LTI 1.3.\nCaliper is optional.');
    /* an attribute holding ">" must not end the tag early and leak its value into the text */
    expect(htmlToText('<p title="a > b" data-x=\'c > d\'>Text</p>')).toBe('Text');
    /* a portal form's dropdown is not tender text */
    expect(htmlToText('<p>Answer:</p><select><option>Yes</option><option>No</option></select>')).toBe('Answer:');
  });

  it('decodes the entities web pages use, and leaves one it does not know as written', () => {
    expect(htmlToText('<p>Caf&eacute; &Eacute;cole &rsquo;quoted&rsquo; &mdash; 5&nbsp;&euro; &#233;&#x2014; &yuml; &bogus; &#1114112;</p>')).toBe(
      `Caf${char(233)} ${char(201)}cole ${char(8217)}quoted${char(8217)} ${char(8212)} 5 ${char(8364)} ${char(233)}${char(8212)} ${char(255)} &bogus; &#1114112;`
    );
    /* soft hyphens and zero-width marks are invisible on the page and would split words for the AI */
    expect(htmlToText(`<p>imple&shy;mentation ${char(0x200b)}plan</p>`)).toBe('implementation plan');
  });

  it('reads the page in the encoding it declares, as Word saves a web page in windows-1252', () => {
    const bytes = (head: string, tail: number[]): Uint8Array => new Uint8Array([...new TextEncoder().encode(head), ...tail]);
    /* "Café" with an é of 0xE9, which is not valid UTF-8 */
    expect(decodeHtmlBytes(bytes('<meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><p>Caf', [0xe9]))).toContain('Café'.normalize());
    expect(decodeHtmlBytes(bytes('<meta charset="utf-8"><p>Caf', [0xc3, 0xa9]))).toContain('Café'.normalize());
    /* a byte-order mark wins over the meta tag, and a label nobody knows falls back to UTF-8 */
    expect(decodeHtmlBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('<meta charset="windows-1252">ok')]))).toContain('ok');
    expect(decodeHtmlBytes(bytes('<meta charset="klingon"><p>Caf', [0xc3, 0xa9]))).toContain('Café'.normalize());
    /* Notepad's "Unicode" is UTF-16 with a byte-order mark, in either byte order */
    const utf16 = (text: string, littleEndian: boolean): Uint8Array => {
      const out = [littleEndian ? 0xff : 0xfe, littleEndian ? 0xfe : 0xff];
      for (const ch of text) out.push(...(littleEndian ? [ch.charCodeAt(0), 0] : [0, ch.charCodeAt(0)]));
      return new Uint8Array(out);
    };
    expect(htmlToText(decodeHtmlBytes(utf16('<p>Hosting</p>', true)))).toBe('Hosting');
    expect(htmlToText(decodeHtmlBytes(utf16('<p>Hosting</p>', false)))).toBe('Hosting');
  });

  it('turns a web page into marked text, and refuses one with no text in it', async () => {
    const page = await prepareTenderFile('portal-notice.html', new TextEncoder().encode('<html><body><h2>3.1 Hosting</h2><p>The supplier shall host the LMS in the EU.</p></body></html>'));
    expect(page.kind).toBe('text');
    expect(new TextDecoder().decode(page.body)).toBe('[[Part 1]]\n## 3.1 Hosting\nThe supplier shall host the LMS in the EU.');
    await expect(prepareTenderFile('empty.htm', new TextEncoder().encode('<html><head><title></title></head><body><script>1</script></body></html>'))).rejects.toThrow('has no text');
  });
});

describe('reading a spreadsheet', () => {
  it('writes each row with its own row number, under a line naming the columns', () => {
    const parts = workbookToParts({
      Requirements: [['Nordhaven College: requirements'], [], ['ID', 'Requirement', 'Priority', ''], ['', '', ''], ['R-1', 'SSO   through  Azure', 'M']],
      Empty: [['', '']]
    });
    /* row 5 is where a person finds it in the client's file; an empty sheet is not a part */
    expect(parts).toEqual(['## Sheet: Requirements\nRow 1: Nordhaven College: requirements\nColumns (row 3): ID | Requirement | Priority\nRow 5: R-1 | SSO through Azure | M']);
  });

  it('starts every sheet on a part of its own, so the AI can leave a whole sheet out', () => {
    const parts = workbookToParts({ Instructions: [['Answer every row']], Matrix: [['R-1', 'Reporting']] });
    expect(parts).toEqual(['## Sheet: Instructions\nRow 1: Answer every row', '## Sheet: Matrix\nRow 1: R-1 | Reporting']);
  });

  it('repeats the column names at the top of each part that continues a sheet', () => {
    const rows = [['ID', 'Requirement', 'Priority'], ...Array.from({ length: 5 }, (_, i) => [`R-${i + 1}`, `Requirement ${i + 1}`, 'M'])];
    const parts = workbookToParts({ Matrix: rows }, 2);
    expect(parts).toHaveLength(3);
    expect(parts[1]).toBe('## Sheet: Matrix (continued)\nColumns (row 1): ID | Requirement | Priority\nRow 4: R-3 | Requirement 3 | M\nRow 5: R-4 | Requirement 4 | M');
    expect(parts[2]).toContain('Row 6: R-5');
  });

  it('keeps a part near a printed page of text, however few rows fill it', () => {
    const long = 'x'.repeat(PART_CHARS - 100);
    const parts = workbookToParts({ Notes: [['A'], [long], [long]] });
    expect(parts).toHaveLength(2);
  });

  it('reads a spreadsheet in small ranges, and leaves hidden sheets out', async () => {
    const book = writeWorkbook({ Matrix: [['ID', 'Requirement', 'Priority'], ['R-1', 'Reporting', 'M']], Lists: [['Y'], ['N']] });
    const files = await unzip(book);
    const workbookXml = new TextDecoder().decode(files['xl/workbook.xml']).replace(/(<sheet [^>]*name="Lists")/, '$1 state="hidden"');
    const hidden = zipStored(Object.entries(files).map(([name, data]) => ({ name, data: name === 'xl/workbook.xml' ? workbookXml : data })));
    const sheet = await prepareTenderFile('matrix.xlsx', hidden);
    const text = new TextDecoder().decode(sheet.body);
    expect(text).toContain('Row 2: R-1 | Reporting | M');
    /* the dropdown values behind a hidden sheet are the workbook's plumbing, not the tender */
    expect(text).not.toContain('Lists');
    expect(sheet.span).toBe(SHEET_SPAN);
  });

  it('refuses a spreadsheet with nothing in it', () => {
    expect(() => preparedSheet('blank.xlsx', { Sheet1: [['', '']] })).toThrow('no filled cells');
  });
});

describe('reading a CSV file', () => {
  it('keeps commas, quotes and line breaks that sit inside a quoted cell', () => {
    expect(csvToRows('ID,Requirement\r\nR-1,"Export grades, nightly"\nR-2,"The ""gold"" tier\nand the rest"\n')).toEqual([
      ['ID', 'Requirement'],
      ['R-1', 'Export grades, nightly'],
      ['R-2', 'The "gold" tier\nand the rest']
    ]);
  });

  it('takes a semicolon or a tab as the separator when the first line uses one', () => {
    /* Excel writes semicolons where the comma is the decimal mark */
    expect(csvToRows('\uFEFFID;Requirement;Weight\nR-1;Reporting;1,5')).toEqual([
      ['ID', 'Requirement', 'Weight'],
      ['R-1', 'Reporting', '1,5']
    ]);
    expect(csvToRows('ID\tRequirement\nR-1\tReporting')).toEqual([
      ['ID', 'Requirement'],
      ['R-1', 'Reporting']
    ]);
  });

  it('reads a CSV as a spreadsheet, not as prose', async () => {
    const sheet = await prepareTenderFile('Matrix.csv', new TextEncoder().encode('ID,Requirement,Priority\nR-1,Reporting,M\n'));
    expect(new TextDecoder().decode(sheet.body)).toBe('[[Part 1]]\n## Sheet: Matrix\nColumns (row 1): ID | Requirement | Priority\nRow 2: R-1 | Reporting | M');
    expect(sheet.span).toBe(SHEET_SPAN);
  });
});

describe('cutting text into parts', () => {
  it('marks each part so a requirement has somewhere to point', () => {
    const { text, parts } = paginate(['one', 'two', 'three'].join('\n'), 8);
    expect(parts).toBe(2);
    expect(text).toBe('[[Part 1]]\none\ntwo\n\n[[Part 2]]\nthree');
  });

  it('cuts a line longer than a part at a space, so no word is split', () => {
    const { text, parts } = paginate('alpha beta gamma delta epsilon', 12);
    expect(parts).toBeGreaterThan(1);
    for (const word of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) expect(text).toContain(word);
    expect(text).not.toMatch(/\balph\b|\bgam\b/);
  });

  it('refuses a file with no text in it, which is what a scan looks like', () => {
    expect(() => preparedText('scan.docx', '   \n ')).toThrow('export it as a PDF');
  });

  it('refuses text that converts past the upload limit', () => {
    expect(() => preparedText('giant.txt', 'x '.repeat(MAX_UPLOAD_BYTES))).toThrow('converts to');
  });
});

describe('preparing a file for upload', () => {
  it('sends a PDF as it is, and refuses one that is not a PDF', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7 rest of the file');
    expect(await prepareTenderFile('RFP.pdf', pdf)).toEqual({ name: 'RFP.pdf', kind: 'pdf', body: pdf, pages: 0 });
    await expect(prepareTenderFile('fake.pdf', new TextEncoder().encode('<html>'))).rejects.toThrow('not a readable PDF');
  });

  it('converts Word, Excel and plain text to marked text', async () => {
    const word = await prepareTenderFile('annex.docx', docx(p('The supplier shall host the platform.')));
    expect(word.kind).toBe('text');
    expect(new TextDecoder().decode(word.body)).toBe('[[Part 1]]\nThe supplier shall host the platform.');
    expect(word.pages).toBe(1);

    const sheet = await prepareTenderFile('matrix.xlsx', writeWorkbook({ Matrix: [['R-1', 'Reporting']] }));
    expect(new TextDecoder().decode(sheet.body)).toContain('R-1 | Reporting');

    const plain = await prepareTenderFile('notes.txt', new TextEncoder().encode('Mobile app required'));
    expect(new TextDecoder().decode(plain.body)).toContain('Mobile app required');
  });

  it('refuses a kind it cannot read', async () => {
    await expect(prepareTenderFile('slides.pptx', new Uint8Array([1, 2, 3]))).rejects.toThrow('is not a PDF');
    await expect(prepareTenderFile('slides.pptx', new Uint8Array([1, 2, 3]))).rejects.toThrow('web page (.html)');
  });
});
