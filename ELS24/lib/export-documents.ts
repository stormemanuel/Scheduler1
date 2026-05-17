export type ExportCell = string | number | null | undefined;

export type ExportSection = {
  heading?: string;
  subheading?: string;
  columns?: string[];
  rows?: ExportCell[][];
  paragraphs?: ExportCell[];
};

export type ExportDocument = {
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

function safeFilename(name: string, extension: string) {
  const cleaned = name.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "export";
  return cleaned.toLowerCase().endsWith(`.${extension}`) ? cleaned : `${cleaned}.${extension}`;
}

function buildExportHtml(document: ExportDocument) {
  const meta = document.meta?.filter(([, value]) => asText(value)).map(([label, value]) => `
      <dt>${htmlEscape(label)}</dt><dd>${htmlEscape(value)}</dd>`).join("") ?? "";
  const sections = document.sections.map((section) => {
    const paragraphs = section.paragraphs?.filter((item) => asText(item)).map((item) => `<p>${htmlEscape(item)}</p>`).join("") ?? "";
    const table = section.columns?.length ? `
      <table>
        <thead><tr>${section.columns.map((column) => `<th>${htmlEscape(column)}</th>`).join("")}</tr></thead>
        <tbody>${section.rows?.length ? section.rows.map((row) => `<tr>${section.columns?.map((_, index) => `<td>${htmlEscape(row[index])}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${section.columns.length}" class="empty">No rows found.</td></tr>`}</tbody>
      </table>` : "";
    return `<section>
      ${section.heading ? `<h2>${htmlEscape(section.heading)}</h2>` : ""}
      ${section.subheading ? `<div class="muted">${htmlEscape(section.subheading)}</div>` : ""}
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
  body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 24px; font-size: 12px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 20px 0 6px; }
  .subtitle, .muted { color: #4b5563; }
  .header { border-bottom: 2px solid #111827; padding-bottom: 12px; margin-bottom: 16px; }
  dl { display: grid; grid-template-columns: 130px 1fr; gap: 4px 12px; margin: 12px 0 0; }
  dt { font-weight: 700; }
  dd { margin: 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; page-break-inside: auto; }
  tr { page-break-inside: avoid; page-break-after: auto; }
  th, td { border: 1px solid #d1d5db; padding: 7px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-weight: 700; }
  .empty { color: #6b7280; font-style: italic; }
  section { margin-bottom: 18px; }
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

function paragraph(text: ExportCell, bold = false, size?: number) {
  const runProps = bold || size ? `<w:rPr>${bold ? "<w:b/>" : ""}${size ? `<w:sz w:val="${size}"/>` : ""}</w:rPr>` : "";
  return `<w:p><w:r>${runProps}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function tableCell(text: ExportCell, header = false) {
  return `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/>${header ? '<w:shd w:fill="F3F4F6"/>' : ""}</w:tcPr>${paragraph(text, header)}</w:tc>`;
}

function tableXml(columns: string[], rows: ExportCell[][]) {
  const header = `<w:tr>${columns.map((column) => tableCell(column, true)).join("")}</w:tr>`;
  const body = rows.length
    ? rows.map((row) => `<w:tr>${columns.map((_, index) => tableCell(row[index])).join("")}</w:tr>`).join("")
    : `<w:tr>${tableCell("No rows found.")}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/><w:left w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/><w:right w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/></w:tblBorders></w:tblPr>${header}${body}</w:tbl>`;
}

function buildDocumentXml(document: ExportDocument) {
  const meta = document.meta?.filter(([, value]) => asText(value)).map(([label, value]) => paragraph(`${asText(label)}: ${asText(value)}`)).join("") ?? "";
  const sections = document.sections.map((section) => [
    section.heading ? paragraph(section.heading, true, 28) : "",
    section.subheading ? paragraph(section.subheading) : "",
    ...(section.paragraphs?.map((item) => paragraph(item)) ?? []),
    section.columns?.length ? tableXml(section.columns, section.rows ?? []) : "",
  ].join("")).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraph(document.title, true, 36)}
    ${document.subtitle ? paragraph(document.subtitle) : ""}
    ${meta}
    ${sections}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
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
