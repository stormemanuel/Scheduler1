import type { ExportDocument, ExportCell } from "@/lib/export-documents";

const text = (value: ExportCell) => String(value ?? "").replace(/[–—]/g, "-").replace(/•/g, " | ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();

/** Build a real PDF locally; crew contact details never leave the browser. */
export async function createExportPdf(document: ExportDocument, logo?: string): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const wide = document.layout === "wide-table" || document.sections.some(section => (section.columns?.length || 0) >= 6);
  const pdf = new jsPDF({ orientation: wide ? "landscape" : "portrait", unit: "pt", format: "letter", compress: true });
  pdf.setProperties({ title: document.title, author: "Emanuel Labor Services" });
  const margin = 30, width = pdf.internal.pageSize.getWidth(), height = pdf.internal.pageSize.getHeight();
  let y = margin;
  const ensureSpace = (needed: number) => { if (y + needed > height - margin - 15) { pdf.addPage(); y = margin; } };
  function write(value: ExportCell, size = 10, bold = false, availableWidth = width - margin * 2) {
    pdf.setFont("helvetica", bold ? "bold" : "normal"); pdf.setFontSize(size); pdf.setTextColor(15, 42, 49);
    const lines = pdf.splitTextToSize(text(value), availableWidth) as string[];
    for (const line of lines) { ensureSpace(size * 1.4); pdf.text(line, margin, y + size); y += size * 1.4; }
  }
  const logoWidth = 135, logoHeight = logoWidth * 231 / 857;
  if (logo && document.showLogo !== false) pdf.addImage(logo, "PNG", width - margin - logoWidth, y, logoWidth, logoHeight);
  write(document.title, 15, true, logo && document.showLogo !== false ? width - margin * 2 - logoWidth - 15 : width - margin * 2);
  if (document.subtitle) write(document.subtitle, 9, false, width - margin * 2 - (logo ? logoWidth + 15 : 0));
  y = Math.max(y, margin + (logo && document.showLogo !== false ? logoHeight : 0)) + 10;
  if (document.meta?.length) {
    autoTable(pdf, { startY: y, margin: { left: margin, right: margin, bottom: margin + 15 }, theme: "plain", body: document.meta.filter(([, value]) => text(value)).map(([label, value]) => [label, text(value)]), styles: { fontSize: 9, cellPadding: 3, overflow: "linebreak" }, columnStyles: { 0: { cellWidth: 95, fontStyle: "bold" } } });
    y = (pdf as typeof pdf & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
  }
  for (const section of document.sections) {
    ensureSpace(65);
    if (section.heading) write(section.heading, 12, true);
    if (section.subheading) write(section.subheading, 9);
    for (const paragraph of section.paragraphs || []) { write(paragraph, 10); y += 5; }
    if (section.columns?.length) {
      autoTable(pdf, {
        startY: y + 5, margin: { left: margin, right: margin, top: margin, bottom: margin + 15 },
        head: [section.columns.map(text)], body: section.rows?.length ? section.rows.map(row => section.columns!.map((_, index) => text(row[index]))) : [[{ content: "No rows found.", colSpan: section.columns.length }]],
        theme: "grid", showHead: "everyPage", rowPageBreak: "avoid",
        styles: { fontSize: 8, cellPadding: 5, overflow: "linebreak", lineColor: [215, 224, 228], lineWidth: 0.4, valign: "top", textColor: [15, 42, 49] },
        headStyles: { fillColor: [237, 243, 245], textColor: [15, 42, 49], fontStyle: "bold" },
        didParseCell(data) {
          if (data.section !== "body") return;
          const kind = section.rowKinds?.[data.row.index];
          if (kind && kind !== "data" && kind !== "spacer") { data.cell.styles.fillColor = [237, 243, 245]; data.cell.styles.fontStyle = "bold"; }
        },
      });
      y = (pdf as typeof pdf & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
    } else y += 12;
  }
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) { pdf.setPage(page); pdf.setFontSize(8); pdf.setTextColor(90, 105, 110); pdf.text(`Emanuel Labor Services | ${page} / ${pages}`, margin, height - 18); }
  return pdf.output("blob");
}
