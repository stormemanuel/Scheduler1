export type ExportCell = string | number | null | undefined;

export type ExportSection = {
  heading?: string;
  headingStyle?: "standard" | "day-bar";
  subheading?: string;
  columns?: string[];
  rows?: ExportCell[][];
  rowKinds?: Array<"data" | "day-divider" | "spacer" | "group-label" | "full-divider" | "half-divider" | "other-divider">;
  paragraphs?: ExportCell[];
  accentColor?: string;
};

export type ExportDocument = {
  layout?: "standard" | "wide-table" | "call-sheet" | "cover-sheet";
  showLogo?: boolean;
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

function buildCoverSheetHtml(document: ExportDocument) {
  const metaRows = document.meta?.filter(([, value]) => asText(value)).map(([label, value]) => `<tr><th>${htmlEscape(label)}</th><td>${htmlEscape(value)}</td></tr>`).join("") ?? "";
  const sectionParagraphs = document.sections.flatMap((section) => {
    const lines = [section.heading, section.subheading, ...(section.paragraphs ?? [])].map((item) => asText(item)).filter(Boolean);
    return lines;
  });
  const highlight = sectionParagraphs.length
    ? `<div class="cover-highlight">${sectionParagraphs.map((line) => `<div>${htmlEscape(line)}</div>`).join("")}</div>`
    : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${htmlEscape(document.title)}</title>
<style>
  @page { margin: 0.3in; }
  :root { --navy:#0b2d55; --gold:#d4a62a; --line:#bcc7d4; --soft:#f7f8fa; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #0f2237; background: #ffffff; }
  .page { min-height: 100vh; border: 8px solid var(--navy); padding: 26px; position: relative; }
  .page::before { content: ""; position: absolute; inset: 10px; border: 3px solid var(--gold); pointer-events: none; }
  .inner { position: relative; z-index: 1; }
  .brand { text-align: center; margin-bottom: 16px; }
  .brand img { width: 100%; max-width: 520px; height: auto; }
  .title-line { display: flex; align-items: center; gap: 14px; justify-content: center; margin: 14px 0 18px; color: var(--gold); }
  .title-line .rule { height: 2px; width: 140px; background: linear-gradient(90deg, transparent, var(--gold), transparent); }
  .title-line .bolt { font-size: 30px; line-height: 1; }
  .book-title { text-align: center; font-size: 34px; letter-spacing: 0.18em; color: var(--navy); margin: 0 0 24px; font-weight: 700; }
  .meta-card { border: 2px solid var(--navy); border-radius: 18px; overflow: hidden; background: #fff; }
  .meta-card table { width: 100%; border-collapse: collapse; }
  .meta-card th, .meta-card td { border-bottom: 1px solid var(--line); padding: 15px 18px; vertical-align: top; }
  .meta-card tr:last-child th, .meta-card tr:last-child td { border-bottom: 0; }
  .meta-card th { width: 34%; text-align: left; font-size: 15px; letter-spacing: 0.04em; color: var(--navy); text-transform: uppercase; background: #fbfcfe; }
  .meta-card td { font-size: 18px; font-weight: 600; color: #12263f; }
  .cover-highlight { margin-top: 22px; border: 2px solid var(--gold); border-radius: 18px; padding: 16px 20px; background: var(--soft); font-size: 20px; font-weight: 700; color: var(--navy); }
  .cover-highlight div + div { margin-top: 8px; font-size: 16px; font-weight: 500; color: #203956; }
  .footer { text-align: center; margin-top: 28px; color: var(--navy); }
  .footer .name { font-size: 26px; letter-spacing: 0.2em; font-weight: 700; }
  .footer .tag { color: #44628c; font-size: 13px; letter-spacing: 0.28em; margin-top: 6px; }
  @media print { body { margin: 0; } .page { min-height: calc(100vh - 0.6in); } }
</style>
</head>
<body>
  <div class="page">
    <div class="inner">
      <div class="brand">
        <img src="/apple-touch-icon.png" alt="Emanuel Labor Services" />
      </div>
      <div class="title-line"><div class="rule"></div><div class="bolt">⚡</div><div class="rule"></div></div>
      <h1 class="book-title">${htmlEscape(document.title)}</h1>
      <div class="meta-card">
        <table>${metaRows || `<tr><td style="padding:18px">No details available.</td></tr>`}</table>
      </div>
      ${highlight}
      <div class="footer">
        <div class="title-line"><div class="rule"></div><div class="bolt">⚡</div><div class="rule"></div></div>
        <div class="name">EMANUEL LABOR SERVICES</div>
        <div class="tag">PROFESSIONAL LABOR COORDINATION</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function buildExportHtml(document: ExportDocument) {
  if (document.layout === "cover-sheet") return buildCoverSheetHtml(document);
  const meta = document.meta?.filter(([, value]) => asText(value)).map(([label, value]) => `
      <dt>${htmlEscape(label)}</dt><dd>${htmlEscape(value)}</dd>`).join("") ?? "";
  const sections = document.sections.map((section) => {
    const rawAccentColor = /^#[0-9a-f]{6}$/i.test(asText(section.accentColor)) ? asText(section.accentColor) : "#17313b";
    const accentBackground = softAccentBackground(rawAccentColor);
    const paragraphs = section.paragraphs?.filter((item) => asText(item)).map((item) => `<p>${htmlEscape(item)}</p>`).join("") ?? "";
    const table = section.columns?.length ? `
      <table>
        <thead><tr>${section.columns.map((column) => `<th>${htmlEscape(column)}</th>`).join("")}</tr></thead>
        <tbody>${section.rows?.length ? section.rows.map((row, rowIndex) => {
          const rowKind = section.rowKinds?.[rowIndex] ?? "data";
          const dividerTextIndex = section.columns?.findIndex((column) => column.toLowerCase().includes("date")) ?? -1;
          const dividerColumnIndex = dividerTextIndex >= 0 ? dividerTextIndex : 0;
          if (rowKind === "day-divider") {
            return `<tr class="day-divider-row">${section.columns?.map((_, index) => `<td>${index === dividerColumnIndex ? htmlEscape(row[index] ?? row[0]) : ""}</td>`).join("")}</tr>`;
          }
          if (rowKind === "full-divider" || rowKind === "half-divider" || rowKind === "other-divider") {
            return `<tr class="schedule-divider-row ${rowKind}">${section.columns?.map((_, index) => `<td>${index === 0 ? htmlEscape(row[0]) : ""}</td>`).join("")}</tr>`;
          }
          if (rowKind === "group-label") {
            return `<tr class="group-label-row">${section.columns?.map((_, index) => `<td>${htmlEscape(row[index])}</td>`).join("")}</tr>`;
          }
          if (rowKind === "spacer") {
            return `<tr class="spacer-row">${section.columns?.map(() => "<td></td>").join("")}</tr>`;
          }
          return `<tr>${section.columns?.map((_, index) => `<td>${htmlEscape(row[index])}</td>`).join("")}</tr>`;
        }).join("") : `<tr><td colspan="${section.columns.length}" class="empty">No rows found.</td></tr>`}</tbody>
      </table>` : "";
    const headingClass = section.headingStyle === "day-bar" ? "section-heading-bar day-heading-bar" : "section-heading-bar";
    const breakableClass = section.rowKinds?.includes("day-divider") ? " breakable-section" : "";
    return `<section class="export-section${section.headingStyle === "day-bar" ? " day-section" : ""}${breakableClass}" style="--accent-color: ${rawAccentColor}; background: ${accentBackground}; border-left-color: ${rawAccentColor};">
      ${section.heading ? `<div class="${headingClass}"><div class="section-heading-row"><span class="section-stick" aria-hidden="true"></span><h2>${htmlEscape(section.heading)}</h2></div></div>` : ""}
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
  .header-with-logo { display: grid; grid-template-columns: minmax(170px, 250px) 1fr; gap: 24px; align-items: start; }
  .export-logo { display: block; width: 100%; max-width: 250px; height: auto; object-fit: contain; margin-top: 2px; }
  .header-copy { min-width: 0; }
  dl { display: grid; grid-template-columns: 130px 1fr; gap: 4px 12px; margin: 12px 0 0; }
  dt { font-weight: 700; color: #102a31; }
  dd { margin: 0; color: #081a20; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; page-break-inside: auto; border: 1px solid #d9e2e6; }
  tr { page-break-inside: avoid; page-break-after: auto; }
  th, td { border: 1px solid #d9e2e6; padding: 7px; text-align: left; vertical-align: top; }
  th { background: #f6f8f9; color: #102a31; font-weight: 700; }
  tbody tr:nth-child(even) td { background: #fbfcfc; }
  .day-divider-row { page-break-inside: avoid; page-break-after: avoid; }
  .day-divider-row td { background: #0b2d55 !important; color: #ffffff; border-color: #0b2d55; font-weight: 700; padding-top: 8px; padding-bottom: 8px; }
  .day-divider-row td:nth-child(2) { font-size: 13px; }
  .schedule-divider-row { page-break-inside: avoid; page-break-after: avoid; }
  .schedule-divider-row td { font-weight: 800; padding-top: 8px; padding-bottom: 8px; }
  .schedule-divider-row.full-divider td { background: #eef6fb !important; color: #0b5b83; border-color: #9ac5da; }
  .schedule-divider-row.half-divider td { background: #fff8e1 !important; color: #a66a00; border-color: #e8be54; }
  .schedule-divider-row.other-divider td { background: #f1f3f5 !important; color: #5b6670; border-color: #cbd5da; }
  .group-label-row td { background: #ffffff !important; color: #102a31; font-weight: 700; padding-top: 8px; padding-bottom: 5px; border-top: 1px solid #cfd9de; border-bottom: 1px solid #e5ebee; }
  .group-label-row td:last-child { color: #61747a; text-align: right; font-weight: 700; }
  .spacer-row td { height: 8px; padding: 0; border-left-color: transparent; border-right-color: transparent; background: #ffffff !important; }
  .empty { color: #6b7280; font-style: italic; }
  section { margin: 0 0 28px; }
  .export-section { border: 1px solid #d9e2e6; border-top: 3px solid var(--accent-color, #17313b); border-left: 4px solid var(--accent-color, #94a3ab); border-radius: 5px; padding: 14px 14px 16px; page-break-inside: avoid; break-inside: avoid; }
  .export-section.breakable-section { page-break-inside: auto; break-inside: auto; }
  .export-section.day-section { border: 1px solid #c8d5dc; border-top: 0; border-left: 0; padding: 0 12px 12px; overflow: hidden; }
  .section-heading-bar { padding: 0 0 5px; border-bottom: 1px solid #e5ebee; margin-bottom: 6px; }
  .section-heading-row { display: flex; align-items: center; gap: 10px; }
  .section-stick { display: inline-block; width: 6px; min-width: 6px; height: 24px; border-radius: 999px; background: var(--accent-color, #94a3ab); }
  .section-heading-bar h2 { color: #102a31; margin: 0; }
  .day-heading-bar { margin: 0 -12px 8px; padding: 9px 14px; border: 0; background: #0b2d55; }
  .day-heading-bar .section-heading-row { gap: 0; }
  .day-heading-bar .section-stick { display: none; }
  .day-heading-bar h2 { color: #ffffff; font-size: 15px; }
  .section-subheading { border-bottom: 1px solid #e5ebee; padding: 4px 0 7px; margin-bottom: 8px; font-weight: 700; }
  @media print {
    body { margin: 0; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    .export-section.breakable-section { page-break-before: auto; page-break-after: auto; page-break-inside: auto; break-inside: auto; }
    .export-section.breakable-section .section-heading-bar { page-break-after: avoid; break-after: avoid-page; }
    .export-section.breakable-section table { page-break-before: avoid; break-before: avoid-page; }
  }
  @media (max-width: 700px) {
    .header-with-logo { grid-template-columns: 1fr; }
    .export-logo { max-width: 220px; }
  }
</style>
</head>
<body>
  <div class="header${document.showLogo ? " header-with-logo" : ""}">
    ${document.showLogo ? `<img src="/apple-touch-icon.png" alt="Emanuel Labor Services" class="export-logo" />` : ""}
    <div class="header-copy">
      <h1>${htmlEscape(document.title)}</h1>
      ${document.subtitle ? `<div class="subtitle">${htmlEscape(document.subtitle)}</div>` : ""}
      ${meta ? `<dl>${meta}</dl>` : ""}
    </div>
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

function tableCell(text: ExportCell, header = false, width = 2200, options?: { fill?: string; textColor?: string; bold?: boolean }) {
  const shade = options?.fill ? `<w:shd w:fill="${options.fill}"/>` : header ? '<w:shd w:fill="EAF3F0"/>' : "";
  const vAlign = "<w:vAlign w:val=\"top\"/>";
  const noWrap = width <= 1500 ? "" : "";
  const bold = options?.bold ?? header;
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade}${vAlign}${noWrap}</w:tcPr>${paragraph(text, bold, header ? 20 : 19, options?.textColor ? { color: options.textColor } : undefined)}</w:tc>`;
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

function tableXml(columns: string[], rows: ExportCell[][], rowKinds?: ExportSection["rowKinds"]) {
  const widths = columns.map((column) => columnWidth(column, columns.length));
  const tableWidth = Math.max(9000, widths.reduce((sum, width) => sum + width, 0));
  const header = `<w:tr>${columns.map((column, index) => tableCell(column, true, widths[index])).join("")}</w:tr>`;
  const body = rows.length
    ? rows.map((row, rowIndex) => {
        const rowKind = rowKinds?.[rowIndex] ?? "data";
        if (rowKind === "day-divider") {
          const dividerTextIndex = columns.findIndex((column) => column.toLowerCase().includes("date"));
          const dividerColumnIndex = dividerTextIndex >= 0 ? dividerTextIndex : 0;
          return `<w:tr>${columns.map((_, index) => tableCell(index === dividerColumnIndex ? row[index] ?? row[0] : "", false, widths[index], { fill: "0B2D55", textColor: "FFFFFF", bold: true })).join("")}</w:tr>`;
        }
        if (rowKind === "full-divider" || rowKind === "half-divider" || rowKind === "other-divider") {
          const fill = rowKind === "full-divider" ? "EEF6FB" : rowKind === "half-divider" ? "FFF8E1" : "F1F3F5";
          const textColor = rowKind === "full-divider" ? "0B5B83" : rowKind === "half-divider" ? "A66A00" : "5B6670";
          return `<w:tr>${columns.map((_, index) => tableCell(index === 0 ? row[0] : "", false, widths[index], { fill, textColor, bold: true })).join("")}</w:tr>`;
        }
        if (rowKind === "group-label") {
          return `<w:tr>${columns.map((_, index) => tableCell(row[index], false, widths[index], { bold: index === 0 || index === columns.length - 1 })).join("")}</w:tr>`;
        }
        if (rowKind === "spacer") {
          return `<w:tr>${columns.map((_, index) => tableCell("", false, widths[index])).join("")}</w:tr>`;
        }
        return `<w:tr>${columns.map((_, index) => tableCell(row[index], false, widths[index])).join("")}</w:tr>`;
      }).join("")
    : `<w:tr>${tableCell("No rows found.", false, tableWidth)}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${tableWidth}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/></w:tblBorders></w:tblPr>${header}${body}</w:tbl>`;
}

function sectionDividerXml(color: ExportCell | undefined) {
  return `<w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="12" w:space="8" w:color="${wordColorValue(color)}"/></w:pBdr><w:spacing w:before="240" w:after="160"/></w:pPr></w:p>`;
}

function callSheetSectionXml(section: ExportSection) {
  const rows = section.rows ?? [];
  const useTableLayout = (section.columns?.length ?? 0) >= 7 || Boolean(section.rowKinds?.length);

  if (useTableLayout && section.columns?.length) {
    return [
      sectionDividerXml(section.accentColor),
      section.heading ? paragraph(section.heading, true, 28, { keepNext: true, color: wordColorValue(section.accentColor) }) : "",
      section.subheading ? paragraph(section.subheading, true, 21, { keepNext: true }) : "",
      ...(section.paragraphs?.map((item) => paragraph(item, false, 21)) ?? []),
      tableXml(section.columns, rows, section.rowKinds),
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
      section.columns?.length ? tableXml(section.columns, section.rows ?? [], section.rowKinds) : "",
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

