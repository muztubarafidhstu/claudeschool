/** Realistic sample data for live sales demonstrations (one transaction, ~250 students). */
import { db, type Stmt } from './db';
import { subjectGroup, type AppSettings } from './config';
import { calculate } from './grading';
import { billableMonths } from './fees';
import { dateOf, daysInMonth, isFriday, makeStudentId, monthKey, pad2, todayISO } from './util';

const BOYS = [['Rahim', 'রহিম'], ['Karim', 'করিম'], ['Tanvir', 'তানভীর'], ['Sakib', 'সাকিব'], ['Arif', 'আরিফ'], ['Nayeem', 'নাঈম'], ['Fahim', 'ফাহিম'], ['Rafiq', 'রফিক'], ['Imran', 'ইমরান'], ['Siam', 'সিয়াম'], ['Hasan', 'হাসান'], ['Mahin', 'মাহিন']];
const GIRLS = [['Ayesha', 'আয়েশা'], ['Fatema', 'ফাতেমা'], ['Nusrat', 'নুসরাত'], ['Sumaiya', 'সুমাইয়া'], ['Tasnim', 'তাসনিম'], ['Mim', 'মীম'], ['Jannat', 'জান্নাত'], ['Rima', 'রিমা'], ['Sadia', 'সাদিয়া'], ['Lamia', 'লামিয়া']];
const SURNAMES = [['Hossain', 'হোসেন'], ['Rahman', 'রহমান'], ['Islam', 'ইসলাম'], ['Ahmed', 'আহমেদ'], ['Chowdhury', 'চৌধুরী'], ['Akter', 'আক্তার'], ['Khan', 'খান'], ['Sarker', 'সরকার']];
const FATHERS = ['Abdul Karim', 'Mizanur Rahman', 'Shahidul Islam', 'Nurul Amin', 'Abul Kalam', 'Jahangir Alam', 'Mosharraf Hossain', 'Delwar Hossain'];
const AREAS = ['Mirpur-10, Dhaka', 'Dhanmondi, Dhaka', 'Uttara Sector 7, Dhaka', 'Mohammadpur, Dhaka', 'Savar, Dhaka', 'Gazipur Sadar'];
const STAFF = [
  ['Md. Abdur Rouf', 'মো. আব্দুর রউফ', 'Principal', 45000], ['Shirin Akter', 'শিরিন আক্তার', 'Assistant Head Teacher', 32000],
  ['Kamal Uddin', 'কামাল উদ্দিন', 'Senior Teacher (Mathematics)', 26000], ['Nasrin Sultana', 'নাসরিন সুলতানা', 'Senior Teacher (English)', 26000],
  ['Rezaul Karim', 'রেজাউল করিম', 'Teacher (Science)', 22000], ['Farhana Yasmin', 'ফারহানা ইয়াসমিন', 'Teacher (Bangla)', 22000],
  ['Sohel Rana', 'সোহেল রানা', 'Teacher (ICT)', 20000], ['Mahbuba Khatun', 'মাহবুবা খাতুন', 'Teacher (Primary)', 18000],
  ['Jamal Hossain', 'জামাল হোসেন', 'Accountant', 20000], ['Rubel Mia', 'রুবেল মিয়া', 'Office Assistant', 12000],
  ['Selina Begum', 'সেলিনা বেগম', 'Cleaner', 9000], ['Abdul Malek', 'আব্দুল মালেক', 'Security Guard', 10000],
];

let seed = 42;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const mobile = () => `01${pick(['3', '7', '8', '9', '5', '6'])}${String(Math.floor(rnd() * 1e8)).padStart(8, '0')}`;

export async function importDemoData(settings: AppSettings, perClass = 25) {
  const existing = await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM students');
  if (existing && existing.n > 0) throw new Error('Demo data can only be imported into an empty database.');
  if (settings.product === 'COACHING') return importCoachingDemo(settings);
  const year = settings.academicYear;
  const now = new Date();
  const thisMonth = monthKey(now);
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = monthKey(prev);
  const admissionDate = `${year}-01-05` > todayISO() ? todayISO() : `${year}-01-05`;
  const stmts: Stmt[] = [];
  let id = 0;
  const stu: { id: number; classNo: number; section: string; stream: string | null; monthly: number }[] = [];

  for (let c = 1; c <= 10; c++) {
    const sections = settings.modules.sections ? Math.max(1, settings.sectionsPerClass[c] ?? 1) : 1;
    for (let r = 1; r <= perClass; r++) {
      id++;
      const girl = rnd() < 0.48;
      const [fn, fnBn] = pick(girl ? GIRLS : BOYS);
      const [sn, snBn] = pick(SURNAMES);
      const section = String.fromCharCode(65 + ((r - 1) % sections));
      const stream = c >= 9 ? (['Science', 'Arts', 'Commerce'] as const)[r % 3] : null;
      const fees = settings.defaultFees[c] ?? { monthly: 1000, admission: 5000 };
      const birthYear = year - (5 + c);
      stmts.push({
        sql: `INSERT INTO students(id, student_id, admission_year, admission_date, class_no, section, stream, roll, name_en, name_bn, gender, dob, blood_group,
              birth_cert_no, father_name, father_mobile, mother_name, mother_mobile, address, monthly_fee, admission_fee)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        params: [id, makeStudentId(year, c, r), year, admissionDate, c, section, stream, r, `${fn} ${sn}`, `${fnBn} ${snBn}`, girl ? 'Female' : 'Male',
          `${birthYear}-${pad2(1 + Math.floor(rnd() * 12))}-${pad2(1 + Math.floor(rnd() * 28))}`, pick(['A+', 'B+', 'O+', 'AB+', 'O-']),
          `${birthYear}${String(Math.floor(rnd() * 1e13)).padStart(13, '0')}`, `${pick(FATHERS)} ${sn}`, mobile(), `Mrs. ${pick(SURNAMES)[0]}`, mobile(), pick(AREAS), fees.monthly, fees.admission],
      });
      stu.push({ id, classNo: c, section, stream, monthly: fees.monthly });
      // Admission fee (some partial), monthly fees (most paid, some partial, some unpaid)
      const admPaid = rnd() < 0.8 ? fees.admission : Math.round(fees.admission * 0.6);
      stmts.push({ sql: `INSERT INTO fee_ledger(student_id, receipt_no, fee_type, period, regular_amount, paid_amount, due_after, paid_on) VALUES (?,?,?,?,?,?,?,?)`,
        params: [id, `R-ADM-${id}`, 'ADMISSION', 'ADMISSION', fees.admission, admPaid, fees.admission - admPaid, admissionDate] });
      const months = billableMonths(admissionDate, thisMonth);
      months.forEach((m, mi) => {
        const isRecent = mi >= months.length - 2;
        const roll = rnd();
        if (isRecent && roll < 0.25) return; // unpaid
        const paid = isRecent && roll < 0.35 ? Math.round(fees.monthly / 2) : fees.monthly;
        stmts.push({ sql: `INSERT INTO fee_ledger(student_id, receipt_no, fee_type, period, regular_amount, paid_amount, due_after, paid_on) VALUES (?,?,?,?,?,?,?,?)`,
          params: [id, `R-${m.replace('-', '')}-${id}`, 'MONTHLY', m, fees.monthly, paid, fees.monthly - paid, `${m}-${pad2(Math.min(10, daysInMonth(m)))}`] });
      });
    }
  }

  // Attendance: previous + current month (until today), ~92% present
  const today = todayISO();
  for (const ym of [prevMonth, thisMonth]) {
    for (let d = 1; d <= daysInMonth(ym); d++) {
      const date = dateOf(ym, d);
      if (date > today || isFriday(date)) continue;
      for (const s of stu) {
        stmts.push({ sql: 'INSERT INTO attendance_logs(student_id, date, class_no, section, status) VALUES (?,?,?,?,?)',
          params: [s.id, date, s.classNo, s.section, rnd() < 0.92 ? 'P' : 'A'] });
      }
    }
  }

  // Half-yearly results
  for (const s of stu) {
    const subjects = settings.subjects[subjectGroup(s.classNo, s.stream)] ?? [];
    if (!subjects.length) continue;
    const skill = 0.36 + rnd() * 0.58; // a few students fail, like a real class
    const lines = subjects.map((sub) => ({ subject: sub.name, full: sub.full, obtained: Math.min(sub.full, Math.max(0, Math.round(sub.full * (skill + (rnd() - 0.5) * 0.25)))) }));
    const r = calculate(lines);
    stmts.push({ sql: `INSERT INTO exam_results(student_id, academic_year, exam, class_no, section, stream, marks_json, total_full, obtained, percentage, gpa, grade, passed)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      params: [s.id, year, 'HALF_YEARLY', s.classNo, s.section, s.stream, JSON.stringify(lines), r.totalFull, r.obtained, r.percentage, r.gpa, r.grade, r.passed ? 1 : 0] });
  }

  // Staff + salaries
  STAFF.forEach(([en, bn, des, sal], i) => {
    const sid = i + 1;
    stmts.push({ sql: `INSERT INTO staff(id, staff_code, name_en, name_bn, designation, mobile, join_date, monthly_salary) VALUES (?,?,?,?,?,?,?,?)`,
      params: [sid, `ST-${String(sid).padStart(3, '0')}`, en, bn, des, mobile(), `${year - 1 - (i % 5)}-0${1 + (i % 9)}-01`, sal] });
    stmts.push({ sql: `INSERT INTO salary_ledger(staff_id, slip_no, period, regular_amount, paid_amount, due_after, paid_on) VALUES (?,?,?,?,?,?,?)`,
      params: [sid, `PS-${prevMonth.replace('-', '')}-${sid}`, prevMonth, sal, sal, 0, `${thisMonth}-01`] });
  });

  await db.batch(stmts);
  return { students: stu.length, staff: STAFF.length, statements: stmts.length };
}

// ------------------------------------------------------------------------------------------ coaching demo
const COACHING_TEACHERS: [string, string, string, 'MONTHLY' | 'DAILY' | 'PER_CLASS', number][] = [
  ['Md. Rakibul Hasan', 'মো. রাকিবুল হাসান', 'Director & Physics Teacher', 'MONTHLY', 30000],
  ['Tahmina Akter', 'তাহমিনা আক্তার', 'Chemistry Teacher', 'MONTHLY', 22000],
  ['Shafiqul Islam', 'শফিকুল ইসলাম', 'Mathematics Teacher', 'PER_CLASS', 400],
  ['Nusrat Jahan', 'নুসরাত জাহান', 'English Teacher', 'PER_CLASS', 350],
  ['Arif Hossain', 'আরিফ হোসেন', 'ICT Teacher', 'DAILY', 800],
  ['Mitu Rani Das', 'মিতু রানী দাস', 'Biology Teacher', 'DAILY', 700],
  ['Kamrul Ahsan', 'কামরুল আহসান', 'Accounting Teacher', 'MONTHLY', 18000],
  ['Rubina Yasmin', 'রুবিনা ইয়াসমিন', 'Office Assistant', 'MONTHLY', 9000],
];
const EXAM_PLAN = [
  { name: 'Weekly Test 1', full: 50, pass: 17, note: 'Chapter 1–2 · MCQ 25 + Written 25', day: 6 },
  { name: 'Weekly Test 2', full: 50, pass: 17, note: 'Chapter 3–4 · MCQ 25 + Written 25', day: 13 },
  { name: 'Model Test 1', full: 100, pass: 33, note: 'Full syllabus model test (board pattern) · 3 hours', day: 20 },
];

async function importCoachingDemo(settings: AppSettings) {
  const year = new Date().getFullYear();
  const now = new Date();
  const thisMonth = monthKey(now);
  const prevMonth = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const today = todayISO();
  const startMonth = prevMonth; // coaching students joined last month
  const admissionDate = `${startMonth}-03`;
  const batches = settings.batches.filter((b) => b.active);
  const stmts: Stmt[] = [];
  let id = 0;
  const stu: { id: number; batch: number; skill: number }[] = [];
  batches.forEach((b, bi) => {
    const monthly = 800 + (bi % 6) * 300;
    const admission = 500 + (bi % 3) * 250;
    const count = 12 + (bi % 4) * 2;
    for (let r = 1; r <= count; r++) {
      id++;
      const girl = rnd() < 0.5;
      const [fn, fnBn] = pick(girl ? GIRLS : BOYS);
      const [sn, snBn] = pick(SURNAMES);
      stmts.push({
        sql: `INSERT INTO students(id, student_id, admission_year, admission_date, class_no, section, stream, roll, name_en, name_bn, gender, dob, blood_group,
              father_name, father_mobile, mother_name, mother_mobile, address, monthly_fee, admission_fee) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        params: [id, makeStudentId(year, b.no, r), year, admissionDate, b.no, 'A', null, r, `${fn} ${sn}`, `${fnBn} ${snBn}`, girl ? 'Female' : 'Male',
          `${year - 12 - (bi % 6)}-${pad2(1 + Math.floor(rnd() * 12))}-${pad2(1 + Math.floor(rnd() * 28))}`, pick(['A+', 'B+', 'O+', 'AB+']),
          `${pick(FATHERS)} ${sn}`, mobile(), `Mrs. ${pick(SURNAMES)[0]}`, mobile(), pick(AREAS), monthly, admission],
      });
      stu.push({ id, batch: b.no, skill: 0.35 + rnd() * 0.6 });
      stmts.push({ sql: 'INSERT INTO fee_ledger(student_id, receipt_no, fee_type, period, regular_amount, paid_amount, due_after, paid_on) VALUES (?,?,?,?,?,?,?,?)',
        params: [id, `R-ADM-${id}`, 'ADMISSION', 'ADMISSION', admission, admission, 0, admissionDate] });
      for (const m of [prevMonth, thisMonth]) {
        const roll = rnd();
        if (m === thisMonth && roll < 0.3) continue;
        const paid = m === thisMonth && roll < 0.4 ? Math.round(monthly / 2) : monthly;
        stmts.push({ sql: 'INSERT INTO fee_ledger(student_id, receipt_no, fee_type, period, regular_amount, paid_amount, due_after, paid_on) VALUES (?,?,?,?,?,?,?,?)',
          params: [id, `R-${m.replace('-', '')}-${id}`, 'MONTHLY', m, monthly, paid, monthly - paid, `${m}-${pad2(Math.min(8, daysInMonth(m)))}`] });
      }
    }
  });
  // attendance (coaching classes ~4 days a week: skip Fridays and Tuesdays)
  for (const ym of [prevMonth, thisMonth]) {
    for (let d = 1; d <= daysInMonth(ym); d++) {
      const date = dateOf(ym, d);
      if (date > today || isFriday(date) || new Date(`${date}T00:00:00`).getDay() === 2) continue;
      for (const s of stu) stmts.push({ sql: 'INSERT INTO attendance_logs(student_id, date, class_no, section, status) VALUES (?,?,?,?,?)', params: [s.id, date, s.batch, 'A', rnd() < 0.9 ? 'P' : 'A'] });
    }
  }
  // exams with marks
  let examId = 0;
  for (const b of batches) {
    for (const e of EXAM_PLAN) {
      const date = `${prevMonth}-${pad2(e.day)}`;
      examId++;
      stmts.push({ sql: 'INSERT INTO coaching_exams(id, class_no, name, exam_date, note, full_marks, pass_marks) VALUES (?,?,?,?,?,?,?)', params: [examId, b.no, e.name, date, e.note, e.full, e.pass] });
      for (const s of stu.filter((x) => x.batch === b.no)) {
        const absent = rnd() < 0.06;
        const obtained = absent ? null : Math.min(e.full, Math.max(0, Math.round(e.full * (s.skill + (rnd() - 0.5) * 0.2))));
        const remark = absent ? null : obtained! >= e.full * 0.8 ? 'Excellent' : obtained! < e.pass ? 'Needs more practice' : null;
        stmts.push({ sql: 'INSERT INTO coaching_marks(exam_id, student_id, obtained, absent, remark) VALUES (?,?,?,?,?)', params: [examId, s.id, obtained, absent ? 1 : 0, remark] });
      }
    }
  }
  // teachers with their pay type
  COACHING_TEACHERS.forEach(([en, bn, des, type, amount], i) => {
    const sid = i + 1;
    stmts.push({ sql: 'INSERT INTO staff(id, staff_code, name_en, name_bn, designation, mobile, join_date, monthly_salary, pay_type, pay_rate) VALUES (?,?,?,?,?,?,?,?,?,?)',
      params: [sid, `ST-${String(sid).padStart(3, '0')}`, en, bn, des, mobile(), `${year - 1}-0${1 + (i % 9)}-01`, type === 'MONTHLY' ? amount : 0, type, type === 'MONTHLY' ? 0 : amount] });
    const units = type === 'DAILY' ? 18 : type === 'PER_CLASS' ? 22 : null;
    const regular = units ? units * amount : amount;
    stmts.push({ sql: 'INSERT INTO salary_ledger(staff_id, slip_no, period, regular_amount, paid_amount, due_after, paid_on, pay_type, units, unit_rate) VALUES (?,?,?,?,?,?,?,?,?,?)',
      params: [sid, `PS-${prevMonth.replace('-', '')}-${sid}`, prevMonth, regular, regular, 0, `${thisMonth}-01`, type, units, units ? amount : null] });
  });
  await db.batch(stmts);
  return { students: stu.length, staff: COACHING_TEACHERS.length, statements: stmts.length };
}
