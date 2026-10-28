// Ekspor tabel ke Excel (.xlsx) dan PDF di browser — server tidak terbebani.
// XLSX ditulis langsung (ZIP tanpa kompresi + XML), tanpa pustaka besar.

// ---------- ZIP (metode STORE) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

function zip(files) {
  const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
  for (const [name, text] of files) {
    const nameB = enc.encode(name); const data = enc.encode(text); const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, nameB.length, true);
    parts.push(new Uint8Array(local.buffer), nameB, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, nameB.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cenSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const colName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

/**
 * @param {string} sheetName
 * @param {string[]} titleLines  baris judul di atas tabel
 * @param {string[]} headers
 * @param {(string|number)[][]} rows
 * @param {number[]} widths lebar kolom (karakter)
 */
export function toXlsx({ sheetName = 'Presensi', titleLines = [], headers, rows, widths = [] }) {
  let r = 0; const xmlRows = [];
  const cell = (c, v, style) => {
    const ref = colName(c) + (r + 1);
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  };
  titleLines.forEach((t, i) => { xmlRows.push(`<row r="${r + 1}">${cell(0, t, i === 0 ? 1 : 0)}</row>`); r++; });
  if (titleLines.length) r++;
  const headerRow = r + 1;
  xmlRows.push(`<row r="${r + 1}">${headers.map((h, c) => cell(c, h, 2)).join('')}</row>`); r++;
  for (const row of rows) { xmlRows.push(`<row r="${r + 1}">${row.map((v, c) => cell(c, v, 3)).join('')}</row>`); r++; }
  const cols = headers.map((h, i) => `<col min="${i + 1}" max="${i + 1}" width="${widths[i] || Math.max(10, String(h).length + 2)}" customWidth="1"/>`).join('');
  const last = colName(headers.length - 1);
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols}</cols><sheetData>${xmlRows.join('')}</sheetData>
${rows.length ? `<autoFilter ref="A${headerRow}:${last}${headerRow + rows.length}"/>` : ''}
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF3963A7"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD0D7E2"/></left><right style="thin"><color rgb="FFD0D7E2"/></right><top style="thin"><color rgb="FFD0D7E2"/></top><bottom style="thin"><color rgb="FFD0D7E2"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  const safeSheet = esc(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeSheet}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', sheet],
    ['xl/styles.xml', styles],
  ]);
}

/** PDF tabel (jsPDF dimuat hanya saat dibutuhkan). */
export async function toPdf({ title, subtitleLines = [], headers, rows, footer }) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(45, 78, 126);
  doc.text(title, 40, 44);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(80, 90, 105);
  subtitleLines.forEach((l, i) => doc.text(l, 40, 64 + i * 14));
  autoTable(doc, {
    head: [headers], body: rows, startY: 64 + subtitleLines.length * 14 + 8,
    styles: { fontSize: 9, cellPadding: 5, lineColor: [208, 215, 226], lineWidth: 0.5 },
    headStyles: { fillColor: [57, 99, 167], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [244, 247, 252] },
    margin: { left: 40, right: 40 },
    didDrawPage: () => {
      const n = doc.internal.getNumberOfPages();
      doc.setFontSize(8); doc.setTextColor(130);
      doc.text(`${footer || ''}  ·  Halaman ${n}`, W - 40, doc.internal.pageSize.getHeight() - 20, { align: 'right' });
    },
  });
  return doc.output('blob');
}

export function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Font standar PDF (Helvetica) hanya memuat Latin-1: ganti tanda baca Unicode umum, sisanya '?'.
const latin = (v) => String(v ?? '').replace(/[–—−]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/…/g, '...').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[^\x00-\xFF]/g, '?');

/**
 * Daftar hadir resmi: kop, judul, info kegiatan, tabel, ringkasan, blok tanda tangan,
 * dan nomor "Halaman x dari y" di setiap halaman.
 * @param {{orientation?:'portrait'|'landscape', app:string, campus:string, title?:string, subtitle?:string,
 *   info:[string,string][], headers:string[], rows:any[][], columnStyles?:object, statusCol?:number,
 *   summary?:string, sign?:{date?:string, title:string, name:string}, note?:string}} o
 */
export async function attendancePdf(o) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: o.orientation || 'portrait', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40;
  const BLUE = [57, 99, 167], INK = [31, 43, 61], MUTED = [102, 114, 132];
  const printed = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date()).replace(/\./g, ':');

  // --- Kop ---
  const kop = () => {
    doc.setFillColor(74, 120, 189); doc.roundedRect(M, 30, 34, 34, 7, 7, 'F');
    doc.setFillColor(255, 255, 255); doc.roundedRect(M + 7, 41, 13, 12, 2, 2, 'F'); doc.triangle(M + 21, 47, M + 28, 42, M + 28, 52, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...INK); doc.text(latin(o.app), M + 46, 44);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...MUTED); doc.text(latin(o.campus), M + 46, 59);
    doc.setDrawColor(...BLUE); doc.setLineWidth(1.6); doc.line(M, 76, W - M, 76);
    doc.setLineWidth(0.5); doc.line(M, 79, W - M, 79);
  };
  kop();

  // --- Judul ---
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(...INK);
  doc.text(latin(o.title || 'DAFTAR HADIR'), W / 2, 110, { align: 'center' });
  let y = 116;
  if (o.subtitle) {
    doc.setFontSize(12); doc.setTextColor(...BLUE);
    const lines = doc.splitTextToSize(latin(o.subtitle), W - M * 2 - 40);
    doc.text(lines, W / 2, y + 14, { align: 'center' }); y += 14 + (lines.length - 1) * 15;
  }

  // --- Info kegiatan (label : nilai) ---
  autoTable(doc, {
    startY: y + 14, theme: 'plain', margin: { left: M, right: M },
    body: o.info.map(([k, v]) => [latin(k), ':', latin(v)]),
    styles: { fontSize: 10, cellPadding: { top: 2.5, bottom: 2.5, left: 0, right: 4 }, textColor: INK },
    columnStyles: { 0: { cellWidth: 118, textColor: MUTED }, 1: { cellWidth: 10 }, 2: { fontStyle: 'bold' } },
  });

  // --- Tabel kehadiran ---
  const sc = o.statusCol;
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 12, theme: 'grid',
    head: [o.headers.map(latin)], body: o.rows.map(r => r.map(latin)),
    margin: { left: M, right: M, top: 96, bottom: 46 },
    styles: { fontSize: 9, cellPadding: 5, lineColor: [205, 213, 225], lineWidth: 0.5, textColor: INK, valign: 'middle' },
    headStyles: { fillColor: BLUE, textColor: 255, fontStyle: 'bold', halign: 'center' },
    alternateRowStyles: { fillColor: [245, 248, 253] },
    columnStyles: { 0: { halign: 'center', cellWidth: 26 }, ...(o.columnStyles || {}) },
    didParseCell: (c) => {
      if (c.section !== 'body' || c.column.index !== sc) return;
      const ok = /^(Memenuhi|Ya|Hadir)/.test(String(c.cell.raw));
      c.cell.styles.textColor = ok ? [33, 122, 82] : [178, 58, 58]; c.cell.styles.fontStyle = 'bold';
    },
    didDrawPage: (d) => { if (d.pageNumber > 1) kop(); },
  });
  y = doc.lastAutoTable.finalY;
  if (!o.rows.length) { doc.setFontSize(10); doc.setTextColor(...MUTED); doc.text('Belum ada peserta yang tercatat hadir.', W / 2, y + 18, { align: 'center' }); y += 24; }

  // --- Ringkasan + catatan + tanda tangan (dipindah ke halaman baru bila tidak muat) ---
  const need = 26 + (o.note ? 26 : 0) + (o.sign ? 110 : 0);
  if (y + need > H - 50) { doc.addPage(); kop(); y = 96; }
  if (o.summary) { doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...INK); doc.text(latin(o.summary), M, y + 20); y += 20; }
  if (o.note) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
    const n = doc.splitTextToSize(latin(o.note), W - M * 2); doc.text(n, M, y + 15); y += 15 + (n.length - 1) * 11;
  }
  if (o.sign) {
    const x = W - M - 190, cx = x + 95;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...INK);
    doc.text(latin(o.sign.date || ''), cx, y + 30, { align: 'center' });
    const t = doc.splitTextToSize(latin(o.sign.title), 190); doc.text(t, cx, y + 44, { align: 'center' });
    const ny = y + 44 + (t.length - 1) * 12 + 58;
    doc.setFont('helvetica', 'bold'); doc.text(latin(o.sign.name), cx, ny, { align: 'center' });
    doc.setDrawColor(...INK); doc.setLineWidth(0.6);
    const nw = Math.min(190, doc.getTextWidth(latin(o.sign.name)) + 20); doc.line(cx - nw / 2, ny + 3, cx + nw / 2, ny + 3);
  }

  // --- Footer setiap halaman ---
  const total = doc.internal.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(215, 222, 232); doc.setLineWidth(0.5); doc.line(M, H - 34, W - M, H - 34);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text(latin(`Dokumen dibuat otomatis oleh ${o.app} pada ${printed} WIB`), M, H - 22);
    doc.text(`Halaman ${p} dari ${total}`, W - M, H - 22, { align: 'right' });
  }
  return doc.output('blob');
}
