// =============================
// File: attendance_reports_export.gs
// =============================

function exportReport(granularity, startDateStr, endDateStr) {
  const data = getReportData(granularity, startDateStr, endDateStr);
  const deck = SlidesApp.create(`Report ${startDateStr} → ${endDateStr}`);
  const slide = deck.getSlides()[0];
  slide.insertTextBox(
    `Period: ${startDateStr} → ${endDateStr}\n` +
    `Total Visits: ${data.totalVisits}\n` +
    `Total Hours: ${data.totalHours.toFixed(2)}`
  );
  return deck.getUrl();
}
