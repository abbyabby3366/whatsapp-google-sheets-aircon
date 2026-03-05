/**
 * Google Apps Script for WhatsApp Lead Tracking
 *
 * Instructions:
 * 1. Open your Google Sheet.
 * 2. Go to Extensions > Apps Script.
 * 3. Delete any existing code and paste this in.
 * 4. Ensure you have a sheet named "aircon_leads".
 * 5. Deployment:
 *    - Click "Deploy" > "New Deployment".
 *    - Select "Web App".
 *    - Set "Execute as" to "Me".
 *    - Set "Who has access" to "Anyone".
 *    - Click "Deploy" and copy the Web App URL.
 */

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const { phone, name, timestamp } = data;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("aircon_leads");

    // Create sheet if it doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet("aircon_leads");
      sheet.appendRow([
        "Phone Number",
        "Name",
        "First Message Time",
        "Last Message Time",
        "",
        "",
        "",
        "",
        "",
        "",
        "Blacklist phone numbers",
      ]);
    }

    const rows = sheet.getDataRange().getValues();
    let found = false;
    let rowIndex = -1;

    // Search for existing phone number in Column A
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0].toString() === phone.toString()) {
        found = true;
        rowIndex = i + 1;
        break;
      }
    }

    if (found) {
      // Update Last Message Time in Column D
      sheet.getRange(rowIndex, 4).setValue(timestamp);
      // Update Name in Column B if it was "Unknown" or empty
      if (!rows[rowIndex - 1][1] || rows[rowIndex - 1][1] === "Unknown") {
        sheet.getRange(rowIndex, 2).setValue(name);
      }
    } else {
      // Append new lead
      // Columns: A=Phone, B=Name, C=First, D=Last
      sheet.appendRow([phone, name, timestamp, timestamp]);
    }

    // Get blacklist from Column K (index 11), starting from row 2
    // getRange(row, column, numRows, numColumns)
    const lastRow = sheet.getLastRow();
    let blacklist = [];
    if (lastRow >= 2) {
      const blacklistValues = sheet.getRange(2, 11, lastRow - 1, 1).getValues();
      blacklist = blacklistValues
        .flat()
        .map((v) => v.toString().trim())
        .filter((v) => v.length > 0);
    }

    return ContentService.createTextOutput(
      JSON.stringify({
        success: true,
        blacklist: blacklist,
      }),
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({
        success: false,
        error: error.toString(),
      }),
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
