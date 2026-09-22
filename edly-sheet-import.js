/* Edly catalog importer — reads the master "Open edX Solution Bundles" workbook (.xlsx)
   straight in the browser and rebuilds window.EDLY_BUNDLES-shaped data from it.
   No dependencies: stored/deflate zip reader + SpreadsheetML parser.
   window.EdlySheet.parseBuffer(arrayBuffer) -> { catalog, warnings }
   window.EdlySheet.fromUrl(url)             -> { catalog, warnings, hash }
   window.EdlySheet.diff(oldCat, newCat)     -> { added, removed, changed, bundlesAdded }
   window.EdlySheet.hash(arrayBuffer)        -> string  */
(function () {
  'use strict';

  /* ---------- zip ---------- */
  async function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unzip .xlsx files. Use Chrome, Edge, Firefox 113+ or Safari 16.4+.');
    const st = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(st).arrayBuffer());
  }
  async function unzip(ab) {
    const buf = new Uint8Array(ab), dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('That file is not a readable .xlsx workbook.');
    const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const out = {}, entries = [];
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const nameLen = dv.getUint16(p + 28, true), extLen = dv.getUint16(p + 30, true), comLen = dv.getUint16(p + 32, true);
      entries.push({
        name: new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen)),
        lho: dv.getUint32(p + 42, true), method: dv.getUint16(p + 10, true), csize: dv.getUint32(p + 20, true)
      });
      p += 46 + nameLen + extLen + comLen;
    }
    for (const e of entries) {
      if (!/^(xl\/|docProps\/)/.test(e.name)) continue;
      const nl = dv.getUint16(e.lho + 26, true), el = dv.getUint16(e.lho + 28, true);
      const start = e.lho + 30 + nl + el, raw = buf.subarray(start, start + e.csize);
      out[e.name] = e.method === 0 ? raw : await inflateRaw(raw);
    }
    return out;
  }

  /* ---------- xml ---------- */
  const ENT = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
  const unesc = s => String(s).replace(/&(lt|gt|quot|apos|amp|#\d+);/g, (m, g) => g[0] === '#' ? String.fromCharCode(+g.slice(1)) : ENT[g]);

  function sharedStrings(xml) {
    const out = [];
    if (!xml) return out;
    const re = /<si>([\s\S]*?)<\/si>/g; let m;
    while ((m = re.exec(xml))) {
      let t = ''; const tre = /<t[^>]*>([\s\S]*?)<\/t>/g; let tm;
      while ((tm = tre.exec(m[1]))) t += tm[1];
      out.push(unesc(t));
    }
    return out;
  }

  /* rows[rowNumber] = { A: 'value', B: … } — handles self-closing empty cells */
  function grid(xml, sst) {
    const rows = [];
    const rre = /<row[^>]*\sr="(\d+)"[^>]*>([\s\S]*?)<\/row>/g; let rm;
    while ((rm = rre.exec(xml))) {
      const cells = {}, body = rm[2];
      const cre = /<c\s+r="([A-Z]+)\d+"((?:[^>"]|"[^"]*")*?)(\/>|>)/g; let cm;
      while ((cm = cre.exec(body))) {
        const col = cm[1], attrs = cm[2]; let v = '';
        if (cm[3] === '>') {
          const end = body.indexOf('</c>', cre.lastIndex);
          const inner = end < 0 ? '' : body.slice(cre.lastIndex, end);
          if (end >= 0) cre.lastIndex = end + 4;
          const t = (attrs.match(/t="([^"]+)"/) || [])[1];
          if (t === 's') { const i = (inner.match(/<v>(\d+)<\/v>/) || [])[1]; v = sst[+i] != null ? sst[+i] : ''; }
          else if (t === 'inlineStr' || t === 'str') { const im = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/); v = im ? unesc(im[1]) : unesc((inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || ''); }
          else v = unesc((inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '');
        }
        cells[col] = String(v).trim();
      }
      rows[+rm[1]] = cells;
    }
    return rows;
  }

  /* ---------- helpers ---------- */
  const DASH = /^[—–-]$/;
  const txt = v => { const s = (v == null ? '' : String(v)).trim(); return !s || DASH.test(s) ? null : s; };
  const num = v => {
    const s = (v == null ? '' : String(v)).trim();
    if (!s || DASH.test(s)) return null;
    const n = parseFloat(s.replace(/,/g, '').replace(/[^\d.eE+-]/g, ''));
    return isNaN(n) ? null : n;
  };
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  /* find the row whose cells contain all of `must` (normalised), return {row, map:{field:col}}.
     Exact header matches are claimed first so "Bundle ID" can't be stolen by the "Bundle" alias. */
  function headerRow(rows, spec, must) {
    for (let r = 1; r < rows.length; r++) {
      const c = rows[r]; if (!c) continue;
      const byNorm = {};
      Object.keys(c).forEach(col => { const k = norm(c[col]); if (k && !byNorm[k]) byNorm[k] = col; });
      const keys = Object.keys(byNorm);
      if (!keys.length) continue;
      const map = {}, taken = {};
      Object.keys(spec).forEach(field => {
        for (const alias of spec[field]) { if (byNorm[alias] && !taken[byNorm[alias]]) { map[field] = byNorm[alias]; taken[byNorm[alias]] = true; return; } }
      });
      Object.keys(spec).forEach(field => {
        if (map[field]) return;
        for (const alias of spec[field]) {
          const hit = keys.find(k => !taken[byNorm[k]] && k.indexOf(alias) === 0);
          if (hit) { map[field] = byNorm[hit]; taken[byNorm[hit]] = true; return; }
        }
      });
      if (must.every(f => map[f])) return { row: r, map };
    }
    return null;
  }
  const get = (cells, map, field) => (map[field] && cells[map[field]] != null) ? cells[map[field]] : '';

  const ITEM_SPEC = {
    id: ['solution id', 'id'], name: ['feature', 'solution', 'name'], desc: ['what it does', 'description'],
    form: ['delivery form', 'form'], status: ['status'], deploy: ['std deployment time', 'deployment time', 'std deploy'],
    first: ['first delivery hrs', 'first delivery', 'est first reuse'], repeat: ['repeat config hrs', 'repeat delivery hrs', 'repeat'],
    build: ['original build hrs', 'build hrs', 'already engineered'], saving: ['reuse saving'],
    account: ['3rd party account', 'third party account', 'client held account', 'client accounts'],
    integrations: ['integrations'], notes: ['notes limits', 'notes'], ref: ['reference'],
    bundleId: ['bundle id'], bundle: ['bundle'], category: ['category'], subCategory: ['sub category']
  };
  const BUNDLE_SPEC = {
    id: ['bundle id'], name: ['bundle'], pitch: ['what it delivers', 'elevator pitch', 'pitch'],
    offerWhen: ['offer when'], featureCount: ['features'], solutionIds: ['solution ids'],
    buildHrs: ['build hrs already engineered', 'build hrs'], firstHrs: ['first delivery hrs'], repeatHrs: ['repeat delivery hrs'],
    saved: ['effort saved'], noEstimate: ['no estimate items'], inDev: ['in dev items'],
    accounts: ['client accounts required', 'client accounts'], pairsWith: ['pairs well with', 'pairs with'], price: ['bundle list price']
  };

  function mkItem(cells, map, fallback) {
    fallback = fallback || {};
    const id = txt(get(cells, map, 'id')) || fallback.id;
    if (!id) return null;
    const cat = txt(get(cells, map, 'category')) || fallback.category || null;
    const sub = txt(get(cells, map, 'subCategory')) || fallback.subCategory || null;
    let form = txt(get(cells, map, 'form')) || fallback.form || null;
    if (!form && cat) form = sub ? cat + ' · ' + sub : cat;
    return {
      id: id,
      name: txt(get(cells, map, 'name')) || fallback.name || id,
      desc: txt(get(cells, map, 'desc')) || fallback.desc || '',
      form: form,
      status: txt(get(cells, map, 'status')) || fallback.status || 'Production',
      deploy: txt(get(cells, map, 'deploy')) || fallback.deploy || null,
      first: num(get(cells, map, 'first')) != null ? num(get(cells, map, 'first')) : (fallback.first != null ? fallback.first : null),
      repeat: num(get(cells, map, 'repeat')) != null ? num(get(cells, map, 'repeat')) : (fallback.repeat != null ? fallback.repeat : null),
      build: num(get(cells, map, 'build')) != null ? num(get(cells, map, 'build')) : (fallback.build != null ? fallback.build : null),
      saving: num(get(cells, map, 'saving')) != null ? num(get(cells, map, 'saving')) : (fallback.saving != null ? fallback.saving : null),
      account: txt(get(cells, map, 'account')) || fallback.account || null,
      integrations: txt(get(cells, map, 'integrations')) || fallback.integrations || null,
      notes: txt(get(cells, map, 'notes')) || fallback.notes || null,
      ref: txt(get(cells, map, 'ref')) || fallback.ref || null,
      category: cat, subCategory: sub
    };
  }

  /* ---------- main ---------- */
  async function parseBuffer(ab) {
    const files = await unzip(ab);
    const dec = k => files[k] ? new TextDecoder().decode(files[k]) : '';
    const sst = sharedStrings(dec('xl/sharedStrings.xml'));
    const rels = {}; { const re = /Id="([^"]+)"[^>]*?Target="([^"]+)"/g; let m; const x = dec('xl/_rels/workbook.xml.rels'); while ((m = re.exec(x))) rels[m[1]] = m[2]; }
    const sheets = []; { const re = /<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g; let m; const x = dec('xl/workbook.xml');
      while ((m = re.exec(x))) { const t = rels[m[2]]; if (t) sheets.push({ name: unesc(m[1]), path: 'xl/' + String(t).replace(/^\/?xl\//, '') }); } }
    if (!sheets.length) throw new Error('No worksheets found in that workbook.');
    const gridOf = s => grid(dec(s.path), sst);
    const warnings = [];

    /* All Components — the canonical solution list */
    const allSheet = sheets.find(s => norm(s.name) === 'all components') || sheets.find(s => /all component/.test(norm(s.name)));
    const allById = {}, orderAll = [];
    if (allSheet) {
      const rows = gridOf(allSheet);
      const h = headerRow(rows, ITEM_SPEC, ['id', 'name']);
      if (!h) warnings.push('“All Components” has no recognisable header row — bundle sheets used instead.');
      else for (let r = h.row + 1; r < rows.length; r++) {
        const c = rows[r]; if (!c) continue;
        const it = mkItem(c, h.map);
        if (!it || !/^[A-Z]{2,}-?\d/i.test(it.id)) continue;
        it._bundleId = txt(get(c, h.map, 'bundleId'));
        it._bundleName = txt(get(c, h.map, 'bundle'));
        allById[it.id] = it; orderAll.push(it.id);
      }
    } else warnings.push('No “All Components” sheet — bundle sheets used on their own.');

    /* Bundle Catalog — bundle prose + totals */
    const catSheet = sheets.find(s => norm(s.name) === 'bundle catalog') || sheets.find(s => /bundle catalog/.test(norm(s.name)));
    const bundleMeta = {}, bundleOrder = []; let title = '', subtitle = '', notes = [], totalRow = null;
    if (catSheet) {
      const rows = gridOf(catSheet);
      const h = headerRow(rows, BUNDLE_SPEC, ['id', 'name']);
      for (let r = 1; r < (h ? h.row : rows.length); r++) { const c = rows[r]; if (!c || !c.A) continue; if (!title) title = c.A; else if (!subtitle) subtitle = c.A; }
      if (h) {
        for (let r = h.row + 1; r < rows.length; r++) {
          const c = rows[r]; if (!c) continue;
          const id = txt(get(c, h.map, 'id')), nm = txt(get(c, h.map, 'name'));
          if (!id) { if (nm && /total/i.test(nm)) totalRow = { c: c, map: h.map }; continue; }
          bundleMeta[id] = {
            id: id, name: nm || id, pitch: txt(get(c, h.map, 'pitch')) || '', offerWhen: txt(get(c, h.map, 'offerWhen')) || '',
            featureCount: num(get(c, h.map, 'featureCount')), solutionIds: txt(get(c, h.map, 'solutionIds')),
            buildHrs: num(get(c, h.map, 'buildHrs')), firstHrs: num(get(c, h.map, 'firstHrs')), repeatHrs: num(get(c, h.map, 'repeatHrs')),
            saved: num(get(c, h.map, 'saved')), noEstimate: num(get(c, h.map, 'noEstimate')) || 0, inDev: num(get(c, h.map, 'inDev')) || 0,
            accounts: txt(get(c, h.map, 'accounts')), pairsWith: txt(get(c, h.map, 'pairsWith')), price: txt(get(c, h.map, 'price'))
          };
          bundleOrder.push(id);
        }
      } else warnings.push('“Bundle Catalog” has no recognisable header row — bundle descriptions may be missing.');
      rows.forEach(c => {
        if (!c || !c.A || !/^[•*]/.test(String(c.A).trim())) return;
        const n = String(c.A).replace(/^[•*]\s*/, '').trim();
        if (/cells are for you to fill in/i.test(n)) return; /* sheet-authoring instruction, not a sales note */
        notes.push(n);
      });
    } else warnings.push('No “Bundle Catalog” sheet — bundle pitches unavailable.');

    /* per-bundle detail sheets */
    const detail = {};
    sheets.forEach(s => {
      const m = String(s.name).match(/^\s*(B\d{1,3})\b/i);
      if (!m) return;
      const bid = m[1].toUpperCase();
      const rows = gridOf(s);
      const h = headerRow(rows, ITEM_SPEC, ['id', 'name']);
      if (!h) { warnings.push('Sheet “' + s.name + '” skipped — no header row found.'); return; }
      const list = [];
      for (let r = h.row + 1; r < rows.length; r++) {
        const c = rows[r]; if (!c) continue;
        const rawId = txt(get(c, h.map, 'id'));
        if (!rawId) continue;
        if (/total/i.test(rawId)) continue;
        const it = mkItem(c, h.map, allById[rawId] || {});
        if (!it) continue;
        delete it._bundleId; delete it._bundleName;
        list.push(it);
      }
      if (list.length) detail[bid] = list;
      if (!bundleMeta[bid]) {
        bundleMeta[bid] = { id: bid, name: String(s.name).replace(/^\s*B\d{1,3}\s*/i, '').trim() || bid, pitch: '', offerWhen: '' };
        bundleOrder.push(bid);
      }
      /* pitch / offer / pairs live above the header on the detail sheet */
      for (let r = 1; r < h.row; r++) {
        const a = rows[r] && rows[r].A ? String(rows[r].A) : '';
        const mm = a.match(/^(Pitch|Offer when the client asks about|Pairs well with)\s*:\s*([\s\S]+)$/i);
        if (!mm) continue;
        const key = norm(mm[1]), val = mm[2].trim();
        if (key === 'pitch' && !bundleMeta[bid].pitch) bundleMeta[bid].pitch = val;
        if (key.indexOf('offer when') === 0 && !bundleMeta[bid].offerWhen) bundleMeta[bid].offerWhen = val;
        if (key.indexOf('pairs well with') === 0 && !bundleMeta[bid].pairsWith) bundleMeta[bid].pairsWith = val;
      }
    });

    /* assemble: detail sheet wins, All Components fills gaps and adds anything new */
    const used = {};
    const bundles = bundleOrder.map(bid => {
      const meta = bundleMeta[bid];
      let items = (detail[bid] || []).slice();
      items.forEach(it => { used[it.id] = true; });
      orderAll.forEach(id => {
        const a = allById[id];
        if (used[id] || !a) return;
        if ((a._bundleId || '').toUpperCase() !== bid) return;
        const copy = Object.assign({}, a); delete copy._bundleId; delete copy._bundleName;
        items.push(copy); used[id] = true;
      });
      const rec = items.filter(it => it.first != null && it.build != null);
      const sumF = rec.reduce((a, x) => a + x.first, 0), sumB = rec.reduce((a, x) => a + x.build, 0);
      // the catalog row's own numbers are only trusted while its feature count still matches the
      // rows on the sheet — append a solution without touching the summary and we recompute instead
      const stale = meta.featureCount != null && meta.featureCount !== items.length;
      const pick = (k, calc) => (!stale && meta[k] != null) ? meta[k] : calc;
      return {
        id: bid, name: meta.name, pitch: meta.pitch || '', offerWhen: meta.offerWhen || '',
        featureCount: items.length, solutionIds: meta.solutionIds || null,
        buildHrs: pick('buildHrs', items.some(i => i.build != null) ? items.reduce((a, x) => a + (x.build || 0), 0) : null),
        firstHrs: pick('firstHrs', items.reduce((a, x) => a + (x.first || 0), 0)),
        repeatHrs: pick('repeatHrs', items.reduce((a, x) => a + (x.repeat || 0), 0)),
        saved: pick('saved', sumB > 0 ? 1 - sumF / sumB : null),
        noEstimate: pick('noEstimate', items.filter(i => i.first == null).length),
        inDev: pick('inDev', items.filter(i => i.status === 'In Development').length),
        accounts: meta.accounts || null, pairsWith: meta.pairsWith || null, price: meta.price || null,
        items: items
      };
    }).filter(b => b.items.length);

    /* solutions the sheet lists under a bundle that has no row/sheet of its own */
    const orphans = orderAll.filter(id => !used[id]).map(id => allById[id]);
    if (orphans.length) {
      const byB = {};
      orphans.forEach(o => { const k = (o._bundleId || 'B00').toUpperCase(); (byB[k] = byB[k] || []).push(o); });
      Object.keys(byB).forEach(k => {
        const items = byB[k].map(o => { const c = Object.assign({}, o); const nm = c._bundleName; delete c._bundleId; delete c._bundleName; c.__bn = nm; return c; });
        const nm = items[0].__bn || 'Unsorted solutions';
        items.forEach(i => delete i.__bn);
        bundles.push({
          id: k, name: nm, pitch: 'Added to the master sheet — no bundle sheet written yet.', offerWhen: '',
          featureCount: items.length, solutionIds: null,
          buildHrs: items.some(i => i.build != null) ? items.reduce((a, x) => a + (x.build || 0), 0) : null,
          firstHrs: items.reduce((a, x) => a + (x.first || 0), 0), repeatHrs: items.reduce((a, x) => a + (x.repeat || 0), 0),
          saved: null, noEstimate: items.filter(i => i.first == null && i.status !== 'In Development').length,
          inDev: items.filter(i => i.status === 'In Development').length,
          accounts: null, pairsWith: null, items: items
        });
        warnings.push(items.length + ' new solution' + (items.length === 1 ? '' : 's') + ' under “' + k + '” had no bundle sheet — grouped as “' + nm + '”.');
      });
    }

    const everyItem = [];
    bundles.forEach(b => b.items.forEach(i => everyItem.push(i)));
    const recAll = everyItem.filter(i => i.first != null && i.build != null);
    const sumF = recAll.reduce((a, x) => a + x.first, 0), sumB = recAll.reduce((a, x) => a + x.build, 0);
    const tm = totalRow ? totalRow.map : null, tc = totalRow ? totalRow.c : null;
    const tFeat = tm ? num(get(tc, tm, 'featureCount')) : null;
    const tOk = tm && tFeat != null && tFeat === everyItem.length; // summary row still in step with the rows
    const tp = (k, calc) => { if (!tOk) return calc; const v = num(get(tc, tm, k)); return v != null ? v : calc; };
    const totals = {
      features: everyItem.length,
      buildHrs: tp('buildHrs', everyItem.reduce((a, x) => a + (x.build || 0), 0)),
      firstHrs: tp('firstHrs', everyItem.reduce((a, x) => a + (x.first || 0), 0)),
      repeatHrs: tp('repeatHrs', everyItem.reduce((a, x) => a + (x.repeat || 0), 0)),
      saved: tp('saved', sumB > 0 ? 1 - sumF / sumB : null),
      noEstimate: tp('noEstimate', everyItem.filter(i => i.first == null).length),
      inDev: tp('inDev', everyItem.filter(i => i.status === 'In Development').length)
    };
    let compiled = '';
    const cm = String(subtitle || '').match(/compiled\s+([^.]+?)\s+from/i);
    if (cm) compiled = cm[1].trim();
    if (!compiled) { const cx = dec('docProps/core.xml').match(/<dcterms:modified[^>]*>([^<]+)</); if (cx) compiled = cx[1].slice(0, 10); }

    if (!everyItem.length) throw new Error('No solutions found in that workbook — is it the Open edX Solution Bundles sheet?');

    return {
      warnings: warnings,
      catalog: {
        meta: {
          title: title || 'Edly — Open edX Solution Bundles (Sales Catalog)',
          subtitle: subtitle || (totals.features + ' solutions across ' + bundles.length + ' bundles.'),
          compiled: compiled, totals: totals,
          notes: notes.length ? notes : ['Imported from the master sales sheet — hours are the delivery team’s recorded engineering estimates.']
        },
        bundles: bundles
      }
    };
  }

  function hash(ab) {
    const u = new Uint8Array(ab); let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < u.length; i++) { h1 = (h1 ^ u[i]) >>> 0; h1 = (h1 * 16777619) >>> 0; if ((i & 7) === 0) h2 = ((h2 + u[i]) * 31) >>> 0; }
    return u.length.toString(36) + '-' + h1.toString(36) + h2.toString(36);
  }

  function diff(oldCat, newCat) {
    const idx = c => { const m = {}; (c && c.bundles || []).forEach(b => b.items.forEach(i => m[i.id] = { it: i, b: b.id })); return m; };
    const A = idx(oldCat), B = idx(newCat);
    const added = [], removed = [], changed = [];
    Object.keys(B).forEach(id => {
      if (!A[id]) { added.push({ id: id, name: B[id].it.name, bundle: B[id].b }); return; }
      const a = A[id].it, b = B[id].it, f = [];
      ['first', 'repeat', 'build', 'status', 'name', 'deploy'].forEach(k => { if (String(a[k] == null ? '' : a[k]) !== String(b[k] == null ? '' : b[k])) f.push(k); });
      if (A[id].b !== B[id].b) f.push('bundle');
      if (f.length) changed.push({ id: id, name: b.name, fields: f, from: a, to: b, bundle: B[id].b });
    });
    Object.keys(A).forEach(id => { if (!B[id]) removed.push({ id: id, name: A[id].it.name, bundle: A[id].b }); });
    const oldB = {}; (oldCat && oldCat.bundles || []).forEach(b => oldB[b.id] = true);
    const bundlesAdded = (newCat && newCat.bundles || []).filter(b => !oldB[b.id]).map(b => b.id + ' · ' + b.name);
    return { added: added, removed: removed, changed: changed, bundlesAdded: bundlesAdded };
  }

  async function fromUrl(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const ab = await r.arrayBuffer();
    const out = await parseBuffer(ab);
    out.hash = hash(ab);
    return out;
  }

  window.EdlySheet = { parseBuffer: parseBuffer, fromUrl: fromUrl, diff: diff, hash: hash, unzip: unzip };
})();
