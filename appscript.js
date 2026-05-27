// Google Apps Script — NTA Court Booking
// Paste this into Extensions → Apps Script, then deploy as a Web App:
//   Execute as: Me
//   Who has access: Anyone
// On updates: Deploy → Manage deployments → edit existing → new version → Deploy

// ── GET: lookup, register, book, getBookings ──────────────────────────────────

function doGet(e) {
  const p = e.parameter;
  if (p.action === 'lookup')      return lookupMember(p.phone);
  if (p.action === 'register')    return registerMember(p);
  if (p.action === 'book')        return createBooking(p);
  if (p.action === 'getBookings') return getBookings(p.date);
  return respond({ error: 'Unknown action' });
}

function lookupMember(phone) {
  const rows = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName('Members').getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(phone))
      return respond({ found: true, name: String(rows[i][1]),
        nat: String(rows[i][2]), ranked: rows[i][3] === true || rows[i][3] === 'TRUE' });
  }
  return respond({ found: false });
}

function registerMember(p) {
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Members')
    .appendRow([p.phone, p.name, p.nat, p.ranked === 'true', new Date().toISOString()]);
  return respond({ success: true });
}

function createBooking(p) {
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Bookings')
    .appendRow([p.ref, p.phone, p.name, p.court, p.date, p.time,
      p.match, 'Rs.' + p.amount, 'Pending Payment',
      new Date().toISOString(), p.slots, p.rawDate]);
  return respond({ success: true });
}

function getBookings(rawDate) {
  const rows = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName('Bookings').getDataRange().getValues();
  const bookings = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][11]) === rawDate && rows[i][8] !== 'Cancelled') {
      const slots = String(rows[i][10]).split(',').map(Number).filter(n => !isNaN(n));
      if (slots.length) bookings.push({ court: Number(rows[i][3]), slots });
    }
  }
  return respond({ bookings });
}

// ── POST: uploadPayment ───────────────────────────────────────────────────────

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  if (data.action === 'uploadPayment') return uploadPayment(data);
  return respond({ error: 'Unknown action' });
}

function uploadPayment(data) {
  // Get or create the NTA Payment Proofs folder in Drive
  const folderName = 'NTA Payment Proofs';
  const folders = DriveApp.getFoldersByName(folderName);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);

  // Decode base64 and save the file
  const blob = Utilities.newBlob(
    Utilities.base64Decode(data.fileData), data.mimeType, data.ref + '_' + data.fileName
  );
  const file = folder.createFile(blob);

  // Update booking row: status → Payment Submitted, col 13 → Drive link
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Bookings');
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.ref) {
      sheet.getRange(i + 1, 9).setValue('Payment Submitted');
      sheet.getRange(i + 1, 13).setValue(file.getUrl());
      break;
    }
  }
  return respond({ success: true });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Sheet structure ───────────────────────────────────────────────────────────
//
// Members sheet columns:
//   A: Phone | B: Name | C: Nat | D: Ranked | E: Registered
//
// Bookings sheet columns:
//   A: Ref | B: Phone | C: Name | D: Court | E: Date | F: Time |
//   G: Match | H: Amount | I: Status | J: Timestamp | K: Slots | L: RawDate | M: PaymentProofURL
