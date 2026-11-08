export type SignInPdfPage = { clientEvent: string; date: string; location: string; crewLead: string; projectManager: string; rowCount: number };
const plain = (value: string) => value.replace(/[–—]/g, "-").replace(/•/g, " | ");

export async function createSignInPdf(sheets: SignInPdfPage[], logo: string): Promise<Blob> {
  if (!sheets.length) throw new Error("Choose at least one sign-in sheet.");
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter", compress: true });
  pdf.setProperties({ title: "Emanuel Labor Services - Sign In / Sign Out Sheets", author: "Emanuel Labor Services" });
  const margin = 24, width = pdf.internal.pageSize.getWidth(), height = pdf.internal.pageSize.getHeight();
  sheets.forEach((sheet, index) => {
    if (index) pdf.addPage();
    const drawHeader = () => {
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(14); pdf.setTextColor(7, 49, 59);
      pdf.text("Emanuel Labor Services LLC - Sign In / Sign Out Sheet", margin, 36);
      pdf.addImage(logo, "PNG", width - margin - 120, 22, 120, 120 * 231 / 857);
      autoTable(pdf, { startY: 52, theme: "plain", margin: { left: margin, right: margin, bottom: 80 }, styles: { fontSize: 9, cellPadding: 3, overflow: "linebreak" }, columnStyles: { 0: { cellWidth: 88, fontStyle: "bold" } }, body: [
        ["Client & Event", plain(sheet.clientEvent)], ["Date", plain(sheet.date) || "________________________"],
        ["Location", plain(sheet.location)], ["Crew Lead", plain(sheet.crewLead)],
        ["Project Manager", plain(sheet.projectManager)], ["Notes", "________________________________________________________________________________"],
      ] });
      return (pdf as typeof pdf & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    };
    const startY = drawHeader();
    const weights = [3, 22, 8, 12, 8, 8, 8, 8, 23];
    autoTable(pdf, {
      startY, margin: { left: margin, right: margin, top: startY, bottom: 85 }, theme: "grid", showHead: "everyPage", rowPageBreak: "avoid",
      head: [["#", "Name Printed", "Date", "Role", "Time In", "Lunch Out", "Lunch In", "Time Out", "Signature"]],
      body: Array.from({ length: Math.max(1, Math.floor(sheet.rowCount)) }, (_, row) => [String(row + 1), "", "", "", "", "", "", "", ""]),
      styles: { fontSize: 9, cellPadding: 4, minCellHeight: 24, lineWidth: 0.6, lineColor: [40, 50, 55], textColor: [8, 26, 32], valign: "middle" },
      headStyles: { fillColor: [244, 247, 248], textColor: [8, 26, 32], fontStyle: "bold", halign: "center" },
      columnStyles: Object.fromEntries(weights.map((weight, column) => [column, { cellWidth: (width - margin * 2) * weight / 100 }])),
      willDrawPage(data) { if (data.pageNumber > 1) drawHeader(); },
      didDrawPage() {
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(8, 26, 32);
        pdf.text("Instructions: Enter the full date and printed name for each shift. Record exact In, Out, and Lunch times.", margin, height - 65);
        pdf.text("Sign your entry to certify its accuracy.", margin, height - 53);
        pdf.text("Manager Signature: ____________________________    Review Date: __________________", margin, height - 28);
      },
    });
  });
  const count = pdf.getNumberOfPages();
  for (let page = 1; page <= count; page++) { pdf.setPage(page); pdf.setFontSize(8); pdf.text(`${page} / ${count}`, width - margin, height - 12, { align: "right" }); }
  return pdf.output("blob");
}
