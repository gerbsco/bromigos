/**
 * scripts/picks.gs
 *
 * Backend for the weekly pick'em. Deploy this as its own Apps Script web app,
 * separate from the trade block, so the two cannot break each other.
 *
 * SETUP, once:
 *   1. sheets.new  ->  name the sheet "Picks"
 *   2. Extensions  ->  Apps Script, delete what is there, paste this in
 *   3. Deploy  ->  New deployment  ->  type: Web app
 *        Execute as:        Me
 *        Who has access:    Anyone
 *   4. Copy the /exec URL and paste it into PICKS_URL in index.html
 *
 * The sheet ends up with one row per manager per week:
 *   week | manager | picks (JSON) | updated
 *
 * Reads are JSONP because the page is on github.io and this is on
 * script.google.com, which is a cross-origin request Apps Script will not
 * grant CORS for. Writes go through the same trick.
 */

var SHEET = "Picks";

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.appendRow(["week", "manager", "picks", "updated"]);
  }
  return sh;
}

/** everything on file, shaped as { week: { manager: {matchupId: winner} } } */
function readAll_() {
  var rows = sheet_().getDataRange().getValues();
  var out = {};
  for (var i = 1; i < rows.length; i++) {
    var week = String(rows[i][0] || "").trim();
    var man  = String(rows[i][1] || "").trim();
    var raw  = String(rows[i][2] || "").trim();
    if (!week || !man || !raw) continue;
    try {
      out[week] = out[week] || {};
      out[week][man] = JSON.parse(raw);
    } catch (e) { /* a row someone hand-edited, skip it rather than fail */ }
  }
  return out;
}

/** one row per manager per week, updated in place rather than appended */
function writePicks_(week, manager, picks) {
  var sh = sheet_();
  var rows = sh.getDataRange().getValues();
  var body = JSON.stringify(picks);
  var stamp = new Date().toISOString();

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(week) && String(rows[i][1]) === String(manager)) {
      sh.getRange(i + 1, 3).setValue(body);
      sh.getRange(i + 1, 4).setValue(stamp);
      return;
    }
  }
  sh.appendRow([week, manager, body, stamp]);
}

function reply_(payload, callback) {
  var json = JSON.stringify(payload);
  if (callback) {
    return ContentService
      .createTextOutput(callback + "(" + json + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  var cb = p.callback;

  try {
    /* A write arrives as a GET too, because a JSONP request cannot POST. The
       lock stops two managers saving at the same instant from clobbering each
       other, which on a Sunday morning is a real possibility. */
    if (p.action === "save" && p.week && p.manager && p.picks) {
      var lock = LockService.getScriptLock();
      lock.waitLock(8000);
      try {
        writePicks_(p.week, p.manager, JSON.parse(p.picks));
      } finally {
        lock.releaseLock();
      }
      return reply_({ ok: true, week: p.week, manager: p.manager }, cb);
    }
    return reply_({ ok: true, picks: readAll_() }, cb);
  } catch (err) {
    return reply_({ ok: false, error: String(err) }, cb);
  }
}

function doPost(e) { return doGet(e); }
