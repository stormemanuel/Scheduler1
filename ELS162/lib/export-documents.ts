export type ExportCell = string | number | null | undefined;

export type ExportSection = {
  heading?: string;
  subheading?: string;
  columns?: string[];
  rows?: ExportCell[][];
  paragraphs?: ExportCell[];
  accentColor?: string;
};

export type ExportDocument = {
  layout?: "standard" | "wide-table" | "call-sheet";
  title: string;
  subtitle?: string;
  meta?: Array<[string, ExportCell]>;
  sections: ExportSection[];
};

function asText(value: ExportCell) {
  return String(value ?? "").trim();
}

function htmlEscape(value: ExportCell) {
  return asText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function xmlEscape(value: ExportCell) {
  return asText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}


function softAccentBackground(_hexColor: string) {
  // PDF exports use a restrained, mostly neutral palette. Area-specific colors are
  // intentionally not used as full section backgrounds because they made exports
  // look too busy when a show has many booths/areas.
  return "#ffffff";
}

function safeFilename(name: string, extension: string) {
  const cleaned = name.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "export";
  return cleaned.toLowerCase().endsWith(`.${extension}`) ? cleaned : `${cleaned}.${extension}`;
}

function buildExportHtml(document: ExportDocument) {
  const meta = document.meta?.filter(([, value]) => asText(value)).map(([label, value]) => `
      <dt>${htmlEscape(label)}</dt><dd>${htmlEscape(value)}</dd>`).join("") ?? "";
  const sections = document.sections.map((section) => {
    const rawAccentColor = /^#[0-9a-f]{6}$/i.test(asText(section.accentColor)) ? asText(section.accentColor) : "#17313b";
    const accentBackground = softAccentBackground(rawAccentColor);
    const paragraphs = section.paragraphs?.filter((item) => asText(item)).map((item) => `<p>${htmlEscape(item)}</p>`).join("") ?? "";
    const table = section.columns?.length ? `
      <table>
        <thead><tr>${section.columns.map((column) => `<th>${htmlEscape(column)}</th>`).join("")}</tr></thead>
        <tbody>${section.rows?.length ? section.rows.map((row) => `<tr>${section.columns?.map((_, index) => `<td>${htmlEscape(row[index])}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${section.columns.length}" class="empty">No rows found.</td></tr>`}</tbody>
      </table>` : "";
    return `<section class="export-section" style="--accent-color: ${rawAccentColor}; background: ${accentBackground}; border-left-color: ${rawAccentColor};">
      ${section.heading ? `<div class="section-heading-bar"><div class="section-heading-row"><span class="section-stick" aria-hidden="true"></span><h2>${htmlEscape(section.heading)}</h2></div></div>` : ""}
      ${section.subheading ? `<div class="muted section-subheading">${htmlEscape(section.subheading)}</div>` : ""}
      ${paragraphs}
      ${table}
    </section>`;
  }).join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${htmlEscape(document.title)}</title>
<style>
  @page { margin: 0.45in; }
  body { font-family: Arial, Helvetica, sans-serif; color: #081a20; margin: 24px; font-size: 12px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 0 0 6px; }
  .subtitle, .muted { color: #61747a; }
  .header { border-bottom: 2px solid #d7e0e4; padding-bottom: 12px; margin-bottom: 16px; }
  dl { display: grid; grid-template-columns: 130px 1fr; gap: 4px 12px; margin: 12px 0 0; }
  dt { font-weight: 700; color: #243b42; }
  dd { margin: 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; page-break-inside: auto; border: 1px solid #d9e2e6; }
  tr { page-break-inside: avoid; page-break-after: auto; }
  th, td { border: 1px solid #d9e2e6; padding: 7px; text-align: left; vertical-align: top; }
  th { background: #f6f8f9; color: #102a31; font-weight: 700; }
  tbody tr:nth-child(even) td { background: #fbfcfc; }
  .empty { color: #6b7280; font-style: italic; }
  section { margin: 0 0 28px; }
  .export-section { border: 1px solid #d9e2e6; border-top: 3px solid var(--accent-color, #17313b); border-left: 4px solid var(--accent-color, #94a3ab); border-radius: 5px; padding: 14px 14px 16px; page-break-inside: avoid; }
  .section-heading-bar { padding: 0 0 5px; border-bottom: 1px solid #e5ebee; margin-bottom: 6px; }
  .section-heading-row { display: flex; align-items: center; gap: 10px; }
  .section-stick { display: inline-block; width: 6px; min-width: 6px; height: 24px; border-radius: 999px; background: var(--accent-color, #94a3ab); }
  .section-heading-bar h2 { color: #102a31; margin: 0; }
  .section-subheading { border-bottom: 1px solid #e5ebee; padding: 4px 0 7px; margin-bottom: 8px; font-weight: 700; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
  <div class="header">
    <h1>${htmlEscape(document.title)}</h1>
    ${document.subtitle ? `<div class="subtitle">${htmlEscape(document.subtitle)}</div>` : ""}
    ${meta ? `<dl>${meta}</dl>` : ""}
  </div>
  ${sections}
</body>
</html>`;
}

export function exportDocumentPdf(document: ExportDocument, filenameBase?: string) {
  const html = buildExportHtml(document);
  const win = window.open("", "_blank");
  if (!win) {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = safeFilename(filenameBase || document.title, "html");
    window.document.body.appendChild(link);
    link.click();
    window.document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.document.title = safeFilename(filenameBase || document.title, "pdf");
  win.setTimeout(() => {
    win.focus();
    win.print();
  }, 350);
}

function paragraph(text: ExportCell, bold = false, size?: number, options?: { keepNext?: boolean; color?: string }) {
  const runProps = bold || size || options?.color ? `<w:rPr>${bold ? "<w:b/>" : ""}${size ? `<w:sz w:val="${size}"/>` : ""}${options?.color ? `<w:color w:val="${options.color}"/>` : ""}</w:rPr>` : "";
  const paragraphProps = options?.keepNext ? "<w:pPr><w:keepNext/></w:pPr>" : "";
  return `<w:p>${paragraphProps}<w:r>${runProps}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function tableCell(text: ExportCell, header = false, width = 2200) {
  const shade = header ? '<w:shd w:fill="EAF3F0"/>' : "";
  const vAlign = "<w:vAlign w:val=\"top\"/>";
  const noWrap = width <= 1500 ? "" : "";
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade}${vAlign}${noWrap}</w:tcPr>${paragraph(text, header, header ? 20 : 19)}</w:tc>`;
}

function wordColorValue(color: ExportCell | undefined) {
  const match = asText(color).match(/^#?([0-9a-f]{6})$/i);
  return match ? match[1].toUpperCase() : "17313B";
}

function columnWidth(column: string, columnCount: number) {
  const normalized = column.toLowerCase();
  if (normalized.includes("name") || normalized.includes("worker")) return 2600;
  if (normalized.includes("time") || normalized.includes("schedule")) return 2800;
  if (normalized.includes("position")) return 1850;
  if (normalized.includes("contact") || normalized.includes("phone")) return 2200;
  if (normalized.includes("status") || normalized === "sent" || normalized === "confirmed") return 1500;
  if (normalized.includes("notes")) return 3300;
  if (columnCount >= 6) return 2000;
  return 2400;
}

function tableXml(columns: string[], rows: ExportCell[][]) {
  const widths = columns.map((column) => columnWidth(column, columns.length));
  const tableWidth = Math.max(9000, widths.reduce((sum, width) => sum + width, 0));
  const header = `<w:tr>${columns.map((column, index) => tableCell(column, true, widths[index])).join("")}</w:tr>`;
  const body = rows.length
    ? rows.map((row) => `<w:tr>${columns.map((_, index) => tableCell(row[index], false, widths[index])).join("")}</w:tr>`).join("")
    : `<w:tr>${tableCell("No rows found.", false, tableWidth)}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${tableWidth}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/></w:tblBorders></w:tblPr>${header}${body}</w:tbl>`;
}

function sectionDividerXml(color: ExportCell | undefined) {
  return `<w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="12" w:space="8" w:color="${wordColorValue(color)}"/></w:pBdr><w:spacing w:before="240" w:after="160"/></w:pPr></w:p>`;
}

function callSheetSectionXml(section: ExportSection) {
  const rows = section.rows ?? [];
  const useTableLayout = (section.columns?.length ?? 0) >= 7;

  if (useTableLayout && section.columns?.length) {
    return [
      sectionDividerXml(section.accentColor),
      section.heading ? paragraph(section.heading, true, 28, { keepNext: true, color: wordColorValue(section.accentColor) }) : "",
      section.subheading ? paragraph(section.subheading, true, 21, { keepNext: true }) : "",
      ...(section.paragraphs?.map((item) => paragraph(item, false, 21)) ?? []),
      tableXml(section.columns, rows),
      paragraph(""),
      paragraph(""),
    ].join("");
  }

  const people = rows.length
    ? rows.map((row) => {
        const [name, times, position, phone, status, notes] = row;
        const line = `${asText(name)}${asText(position) ? ` — ${asText(position)}` : ""}${asText(times) ? ` — ${asText(times)}` : ""}${asText(phone) ? ` — ${asText(phone)}` : ""}${asText(status) ? ` — ${asText(status)}` : ""}${asText(notes) ? ` — Notes: ${asText(notes)}` : ""}`;
        return paragraph(`☐ ${line}`, false, 21);
      }).join("")
    : paragraph("No rows found.");
  return [
    sectionDividerXml(section.accentColor),
    section.heading ? paragraph(section.heading, true, 28, { keepNext: true, color: wordColorValue(section.accentColor) }) : "",
    section.subheading ? paragraph(section.subheading, true, 21, { keepNext: true }) : "",
    ...(section.paragraphs?.map((item) => paragraph(item, false, 21)) ?? []),
    people,
    paragraph(""),
    paragraph(""),
  ].join("");
}

function buildDocumentXml(document: ExportDocument) {
  const wideTable = document.layout === "wide-table" || document.layout === "call-sheet" || document.sections.some((section) => (section.columns?.length ?? 0) >= 5);
  const meta = document.meta?.filter(([, value]) => asText(value)).map(([label, value]) => paragraph(`${asText(label)}: ${asText(value)}`, false, 20)).join("") ?? "";
  const sections = document.sections.map((section) => {
    if (document.layout === "call-sheet") return callSheetSectionXml(section);
    return [
      section.heading ? paragraph(section.heading, true, 28, { keepNext: true, color: wordColorValue(section.accentColor) }) : "",
      section.subheading ? paragraph(section.subheading, true, 21, { keepNext: true }) : "",
      ...(section.paragraphs?.map((item) => paragraph(item, false, 21)) ?? []),
      section.columns?.length ? tableXml(section.columns, section.rows ?? []) : "",
      paragraph(""),
    ].join("");
  }).join("");

  const pageSize = wideTable
    ? '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>'
    : '<w:pgSz w:w="12240" w:h="15840"/>';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraph(document.title, true, 36)}
    ${document.subtitle ? paragraph(document.subtitle, false, 22) : ""}
    ${meta}
    ${paragraph("")}
    ${sections}
    <w:sectPr>${pageSize}<w:pgMar w:top="540" w:right="540" w:bottom="540" w:left="540" w:header="540" w:footer="540" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>`;
}

let crcTable: Uint32Array | null = null;

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(data: Uint8Array) {
  const table = crcTable ?? (crcTable = makeCrcTable());
  let c = 0xffffffff;
  for (const byte of data) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = (date.getFullYear() - 1980) << 9 | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function concatArrays(parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function bytes(values: number[]) {
  return new Uint8Array(values);
}

function createZip(files: Array<{ name: string; content: string }>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const { time, day } = dosDateTime();

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const localHeader = bytes([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(time), ...u16(day), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0),
    ]);
    localParts.push(localHeader, nameBytes, data);
    const centralHeader = bytes([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(time), ...u16(day), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
    ]);
    centralParts.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + data.length;
  }

  const centralDirectory = concatArrays(centralParts);
  const localFiles = concatArrays(localParts);
  const end = bytes([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(centralDirectory.length), ...u32(localFiles.length), ...u16(0),
  ]);
  return concatArrays([localFiles, centralDirectory, end]);
}

export function exportDocumentDocx(document: ExportDocument, filenameBase?: string) {
  const docXml = buildDocumentXml(document);
  const zip = createZip([
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/document.xml", content: docXml },
  ]);
  const blob = new Blob([zip], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = safeFilename(filenameBase || document.title, "docx");
  window.document.body.appendChild(link);
  link.click();
  window.document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function waitForBrowserPaint() {
  return new Promise<void>((resolve) => {
    if (typeof window === "undefined") {
      resolve();
      return;
    }
    window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
  });
}

function waitForIdleTurn(timeout = 750) {
  return new Promise<void>((resolve) => {
    if (typeof window === "undefined") {
      resolve();
      return;
    }
    const idleCallback = (window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number }).requestIdleCallback;
    if (idleCallback) {
      idleCallback(() => resolve(), { timeout });
      return;
    }
    window.setTimeout(resolve, 0);
  });
}

export async function exportDocumentPdfQueued(document: ExportDocument, filenameBase?: string) {
  await waitForBrowserPaint();
  await waitForIdleTurn();
  exportDocumentPdf(document, filenameBase);
}

export async function exportDocumentDocxQueued(document: ExportDocument, filenameBase?: string) {
  await waitForBrowserPaint();
  await waitForIdleTurn();
  exportDocumentDocx(document, filenameBase);
}

