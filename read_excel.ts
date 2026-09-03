import xlsx from 'xlsx';

const filePath = 'd:\\pj\\porj\\corse\\course_618d5152-a00d-4108-9468-caf6fe9e96b1_export.xlsx';
const workbook = xlsx.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const rows = xlsx.utils.sheet_to_json(worksheet);

if (rows.length > 0) {
  const firstRow: any = rows[0];
  console.log('--- Lesson Content ---');
  console.log(firstRow['Lesson Content']);
  console.log('--- Lesson Slides ---');
  console.log(firstRow['Lesson Slides']);
  console.log('--- Lesson Assignments ---');
  console.log(firstRow['Lesson Assignments']);
  console.log('--- Lesson Questions ---');
  console.log(firstRow['Lesson Questions']);
  console.log('--- Lesson Attachments ---');
  console.log(firstRow['Lesson Attachments']);
} else {
  console.log('File is empty.');
}
