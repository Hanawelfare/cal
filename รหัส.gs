/* === Configuration (แก้ตามความเหมาะสม) === */
const SS = SpreadsheetApp.getActiveSpreadsheet();
const FOLDER_ID = '1gdhwPImCCN5EKW4NeX-6EcBC1nFeF1q5'; // ★ เปลี่ยนเป็น Drive folder id ที่ต้องการเก็บรูป
const MASTER_SHEET_NAME = 'Master Data'; // ตารางฐานข้อมูลพนักงาน
/* ============================================ */

/* doGet รองรับ ?page=admin และ ?page=leaderboard */
function doGet(e) {
  const page = e && e.parameter && e.parameter.page;
  if (page === 'admin') {
    return HtmlService.createTemplateFromFile('admin').evaluate().setTitle('Admin Approval');
  }
  if (page === 'leaderboard') {
    return HtmlService.createTemplateFromFile('leaderboard').evaluate().setTitle('Leaderboard');
  }
  return HtmlService.createTemplateFromFile('index').evaluate().setTitle('Step Challenge');
}

function include(filename) { return HtmlService.createHtmlOutputFromFile(filename).getContent(); }

/* ดึงข้อมูลพนักงานจาก Master Data */
function getEmployeeData(employeeId) {
  const masterSheet = SS.getSheetByName(MASTER_SHEET_NAME);
  if (!masterSheet) return { error: 'ไม่พบชีท Master Data' };
  const data = masterSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(employeeId)) {
      return { name: data[i][1], department: data[i][2] };
    }
  }
  return { error: 'ไม่พบรหัสพนักงานนี้' };
}

/* ตรวจสอบว่าเปิดให้ส่งผลหรือไม่ (อ่านจากชีต Settings : key=submissionOpen) */
function isSubmissionOpen() {
  const settingSheet = SS.getSheetByName('Settings');
  if (!settingSheet) return true;
  const data = settingSheet.getRange(1, 1, settingSheet.getLastRow(), 2).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === 'submissionopen') {
      return String(data[i][1]).toLowerCase() === 'true';
    }
  }
  return true;
}

/* บันทึกข้อมูลที่ผู้ใช้ส่งมา — สถานะเริ่มต้น = รออนุมัติ */
function submitData(formData) {
  if (!isSubmissionOpen()) {
    return { success: false, message: '🚫 ขณะนี้ปิดการส่งผลชั่วคราว' };
  }

  const dataSheet = SS.getSheetByName('Data');
  if (!dataSheet) return { success: false, message: 'ไม่พบชีท Data' };

  const emp = getEmployeeData(formData.employeeId);
  if (emp.error) return { success: false, message: emp.error };

  try {
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const decoded = Utilities.base64Decode(formData.proofBase64);
    const blob = Utilities.newBlob(decoded, formData.mimeType || 'image/png', `proof_${Date.now()}.png`);
    const file = folder.createFile(blob);

    // ตรวจว่าชีทมีคอลัมน์สถานะ (ถ้าไม่มี ให้เพิ่มคอลัมน์เปล่าท้าย)
    const lastCol = dataSheet.getLastColumn();
    if (lastCol < 7) {
      // ถ้ายังไม่มีคอลัมน์สถานะ ให้เขียนหัวตาราง (ถ้าต้องการให้เป็นไปโดยอัตโนมัติ)
      // แต่โดยปกติแนะนำให้ผู้ใช้สร้างหัวตารางเองในชีท
    }

    dataSheet.appendRow([
      new Date(),
      "'" + formData.employeeId,
      emp.name,
      emp.department,
      parseInt(formData.steps, 10),
      file.getUrl(),
      "⏳ รออนุมัติ" // สถานะเริ่มต้น
    ]);

    return { success: true, message: 'บันทึกข้อมูลสำเร็จ! (รอแอดมินตรวจสอบ)' };
  } catch (err) {
    return { success: false, message: 'ข้อผิดพลาด: ' + err };
  }
}

/* ดึงรายการที่รออนุมัติ — คืนค่าเป็น array ของ object (มี row index เพื่ออัปเดตได้) */
function getPendingSubmissions() {
  const dataSheet = SS.getSheetByName('Data');
  if (!dataSheet) {
    Logger.log('❌ ไม่พบชีต Data');
    return [];
  }

  const values = dataSheet.getDataRange().getValues();
  Logger.log('🧾 จำนวนแถวทั้งหมด: ' + values.length);

  const pending = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const status = String(row[6]).trim();
    Logger.log(`แถว ${i + 1} → สถานะ: ${status}`);

    if (status.includes('รออนุมัติ')) {
      Logger.log(`✅ เจอรายการรออนุมัติ: ${row[1]} ${row[2]}`);
      pending.push({
        row: i + 1,
        date: row[0],
        id: row[1],
        name: row[2],
        dept: row[3],
        steps: row[4],
        proof: row[5]
      });
    }
  }

  Logger.log('📦 จำนวนที่เจอทั้งหมด: ' + pending.length);
  return pending;
}



/* อัปเดตสถานะ (แอดมินกดอนุมัติ/ไม่อนุมัติ) */
function updateApproval(row, approved) {
  const dataSheet = SS.getSheetByName('Data');
  if (!dataSheet) return { success: false, message: 'ไม่พบชีท Data' };
  const newStatus = approved ? '✅ อนุมัติแล้ว' : '❌ ไม่อนุมัติ';
  dataSheet.getRange(row, 7).setValue(newStatus); // คอลัมน์ 7 = G
  return { success: true };
}

/* สร้าง Leaderboard จากเฉพาะแถวที่สถานะ = '✅ อนุมัติแล้ว' */
function getLeaderboard() {
  const dataSheet = SS.getSheetByName('Data');
  const masterSheet = SS.getSheetByName(MASTER_SHEET_NAME);
  if (!dataSheet || dataSheet.getLastRow() < 2 || !masterSheet) return [];

  const values = dataSheet.getRange(2, 1, dataSheet.getLastRow() - 1, dataSheet.getLastColumn()).getValues();
  // สร้าง lookup จาก master
  const masterData = masterSheet.getDataRange().getValues();
  const lookup = {};
  for (let i = 1; i < masterData.length; i++) {
    lookup[String(masterData[i][0])] = { name: masterData[i][1], dept: masterData[i][2] };
  }

  const total = {};
  const todaySteps = {};
  const todayStr = new Date().toDateString();

  values.forEach(r => {
    const status = r[6]; // คอลัมน์สถานะ
    if (status !== '✅ อนุมัติแล้ว') return; // ข้ามถ้ายังไม่อนุมัติ
    const id = String(r[1]);
    const steps = Number(r[4]) || 0;
    const date = new Date(r[0]).toDateString();

    if (!total[id]) total[id] = { steps: 0, score: 0 };
    total[id].steps += steps;

    // คำนวณคะแนนตามเรทเดิม
    if (steps >= 10000) total[id].score += 8;
    else if (steps >= 6500) total[id].score += 5;
    else if (steps >= 5200) total[id].score += 2;
    else if (steps >= 1) total[id].score += 1;

    if (date === todayStr) {
      if (!todaySteps[id]) todaySteps[id] = 0;
      todaySteps[id] += steps;
    }
  });

  const arr = Object.keys(total).map(id => ({
    id,
    name: lookup[id]?.name || 'N/A',
    dept: lookup[id]?.dept || 'N/A',
    steps: total[id].steps,
    score: total[id].score,
    today: todaySteps[id] || 0
  })).sort((a, b) => b.steps - a.steps);

  // สร้าง rank
  const result = arr.map((r, i) => ({
    rank: i + 1,
    id: r.id,
    name: r.name,
    dept: r.dept,
    steps: r.steps,
    score: r.score,
    today: r.today
  }));

  return result;
}

/* คืนค่าสรุปของพนักงานคนเดียว (เพื่อแสดงในหน้า index) */
function getEmployeeSummary(employeeId) {
  const board = getLeaderboard();
  for (let i = 0; i < board.length; i++) {
    if (String(board[i].id) === String(employeeId)) {
      return {
        found: true,
        rank: board[i].rank,
        steps: board[i].steps,
        score: board[i].score
      };
    }
  }
  return { found: false, message: 'ยังไม่มีข้อมูลที่อนุมัติสำหรับผู้ใช้นี้' };
}
