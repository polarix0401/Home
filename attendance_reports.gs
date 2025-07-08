// =============================
// File: attendance_reports.gs
// =============================

function doGet() {
  return HtmlService
    .createHtmlOutputFromFile('attendance_reports_index')
    .setTitle('Attendance Reports')
    .addMetaTag('viewport','width=device-width, initial-scale=1');
}

/**
 * Summarize visits and hours in buckets + per-student stats.
 * @param {string} granularity 'day'|'week'|'month'
 * @param {string} startDateStr ISO date
 * @param {string} endDateStr   ISO date
 * @param {string} studentId    optional filter
 */
function getReportData(granularity, startDateStr, endDateStr, studentId) {
  const attSS  = SpreadsheetApp.openById(ATTENDANCE_FILE_ID)
                   .getSheetByName(ATTENDANCE_SHEET_NAME);
  const studSS = SpreadsheetApp.openById(STUDENTS_SHEET_ID)
                   .getSheetByName(STUDENTS_SHEET_NAME);
  const attVals  = attSS.getDataRange().getValues();
  const studVals = studSS.getDataRange().getValues();

  // Map ID→Name
  const studentMap = {};
  for (let i = 1; i < studVals.length; i++) {
    studentMap[studVals[i][1]] = studVals[i][2];
  }

  const startDT = new Date(startDateStr);
  const endDT   = new Date(endDateStr);
  endDT.setHours(23, 59, 59);

  const summary = {
    totalVisits:   0,
    totalHours:    0,
    timeline:      {},  // visit counts
    timelineHours:{},   // hour sums
    studentStats:  {}   // per-student {name, visits, hours}
  };

  for (let i = 1; i < attVals.length; i++) {
    const row = attVals[i];
    // filter by student if provided
    if (studentId && String(row[0]) !== studentId) continue;

    const inDate = new Date(row[2]);
    if (inDate < startDT || inDate > endDT) continue;

    const hours = parseDuration(row[6]); // from attendance_reports_util.gs
    summary.totalVisits++;
    summary.totalHours += hours;

    // per-student
    const id = row[0];
    if (!summary.studentStats[id]) {
      summary.studentStats[id] = {
        name:   studentMap[id] || id,
        visits: 0,
        hours:  0
      };
    }
    summary.studentStats[id].visits++;
    summary.studentStats[id].hours += hours;

    // determine bucket key
    let key;
    if (granularity === 'day') {
      key = Utilities.formatDate(inDate, TIME_ZONE, 'yyyy-MM-dd');
    }
    else if (granularity === 'week') {
      const dt = new Date(inDate);
      const d  = (dt.getDay()+6)%7;
      dt.setDate(dt.getDate() - d + 3);
      const w1 = new Date(dt.getFullYear(),0,4);
      const wn = 1 + Math.round(((dt - w1)/864e5 - 3 + ((w1.getDay()+6)%7))/7);
      key = dt.getFullYear()+'-W'+wn;
    }
    else {
      key = Utilities.formatDate(inDate, TIME_ZONE, 'yyyy-MM');
    }

    // record visits & hours
    summary.timeline[key]      = (summary.timeline[key] || 0) + 1;
    summary.timelineHours[key] = (summary.timelineHours[key] || 0) + hours;
  }

  return summary;
}

/**
 * Returns list of {id,name} from Students sheet,
 * using column B for both value & display.
 */
function getStudentList() {
  const ss   = SpreadsheetApp.openById(STUDENTS_SHEET_ID)
                   .getSheetByName(STUDENTS_SHEET_NAME);
  const vals = ss.getDataRange().getValues().slice(1);
  return vals.map(r=>({
    id:   r[1],
    name: r[1]
  }));
}

/**
 * Turn a “duration” cell into a number of hours.
 * Supports:
 *   •  numeric values (e.g. 1.5)
 *   •  “HH:MM” strings (e.g. “1:30” → 1.5h)
 *   •  anything else → 0
 */
function parseDuration(raw) {
  if (raw == null) return 0;
  // already a number?
  if (typeof raw === 'number') return raw;
  var s = raw.toString().trim();
  // HH:MM format?
  if (s.indexOf(':') !== -1) {
    var parts = s.split(':');
    var h = parseFloat(parts[0]) || 0;
    var m = parseFloat(parts[1]) || 0;
    return h + (m / 60);
  }
  // fallback to plain float
  var v = parseFloat(s);
  return isNaN(v) ? 0 : v;
}

/**
 * Return every attendance row for a given student+date range,
 * formatted for the client.
 */
/**
 * Return every attendance row for a given student+date range,
 * with:
 *  • Check-in / Check-out → “EEE dd-MMM-yy HH:mm”
 *  • Duration → “H:MMh”
 *  • Notes as-is
 *
 * @param {string} startDateStr  ISO date string for start
 * @param {string} endDateStr    ISO date string for end
 * @param {string} studentId     the ID to filter by
 * @return {Array.<{checkin:string,checkout:string,duration:string,notes:string}>}
 */
function getIndividualDetails(startDateStr, endDateStr, studentId) {
  // open the Attendance sheet
  const attSS = SpreadsheetApp
    .openById(ATTENDANCE_FILE_ID)
    .getSheetByName(ATTENDANCE_SHEET_NAME);

  // grab all rows ([ID, PlanID, InTime, OutTime, ..., Notes, Duration])
  const rows = attSS.getDataRange().getValues();

  // build our date bounds
  const start = new Date(startDateStr);
  const end   = new Date(endDateStr);
  end.setHours(23, 59, 59);

  // desired date-time format
  const dtFmt = "EEE dd-MMM-yy HH:mm"; 

  // process each data row
  return rows
    .slice(1)                             // skip header
    .filter(r => String(r[0]) === String(studentId))
    .map(r => {
      const inDT  = new Date(r[2]);
      if (inDT < start || inDT > end) return null;
      const outDT = r[3] ? new Date(r[3]) : null;

      // format check-in / check-out
      const checkin  = Utilities.formatDate(inDT , TIME_ZONE, dtFmt);
      const checkout = outDT
        ? Utilities.formatDate(outDT, TIME_ZONE, dtFmt)
        : "";

      // compute hours as decimal then turn into H:MMh
      const totalH = parseDuration(r[6]);  // ensure you have parseDuration defined
      const h      = Math.floor(totalH);
      const m      = Math.round((totalH - h) * 60);
      const duration = `${h}:${("0" + m).slice(-2)}h`;

      // pull notes (column index 5)
      const notes = r[5] || "";

      return { checkin, checkout, duration, notes };
    })
    .filter(x => x !== null);
}


