import { useEffect, useState } from 'react';
import { Download, Printer, Pencil, Trash2, Eye, Search } from 'lucide-react';
import { useApp } from '../components/AppContext';
import { Card, Empty } from '../components/ui';
import ClassPicker from '../components/ClassPicker';
import PrintPreview from '../components/PrintPreview';
import { ContactDirectory } from '../docs/Documents';
import { db, type Param } from '../lib/db';
import type { Student } from '../lib/fees';
import { saveTextFile } from '../lib/platform';
import { toCsv } from '../lib/util';

export default function Students({ onEdit }: { onEdit: (id: number) => void }) {
  const { settings, openStudent, requirePin, toast, bump, dataVersion } = useApp();
  const [filter, setFilter] = useState({ classNo: 0, section: '', stream: null as string | null });
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Student[]>([]);
  const [print, setPrint] = useState(false);

  useEffect(() => {
    const where = ["status = 'active'"]; const p: Param[] = [];
    if (filter.classNo) { where.push('class_no = ?'); p.push(filter.classNo); }
    if (filter.section && settings.modules.sections) { where.push('section = ?'); p.push(filter.section); }
    if (filter.stream && filter.classNo >= 9) { where.push('stream = ?'); p.push(filter.stream); }
    if (q.trim()) { where.push('(name_en LIKE ? OR name_bn LIKE ? OR student_id LIKE ? OR father_mobile LIKE ? OR mother_mobile LIKE ? OR CAST(roll AS TEXT) = ?)'); const s = `%${q.trim()}%`; p.push(s, s, `${q.trim()}%`, s, s, q.trim()); }
    const h = setTimeout(() => db.select<Student>(`SELECT id, student_id, class_no, section, stream, roll, name_en, name_bn, gender, father_name, father_mobile, mother_mobile, photo, monthly_fee FROM students WHERE ${where.join(' AND ')} ORDER BY class_no, section, roll`, p).then(setRows), 120);
    return () => clearTimeout(h);
  }, [filter, q, dataVersion, settings.modules.sections]);

  const title = filter.classNo ? `Class ${filter.classNo}${filter.section ? ` · Section ${filter.section}` : ''}${filter.stream ? ` · ${filter.stream}` : ''}` : 'All Classes';

  async function remove(s: Student) {
    if (!(await requirePin('modify', `Delete ${s.name_en} (${s.student_id}) and all fee, attendance and result records?`))) return;
    await db.execute('DELETE FROM students WHERE id = ?', [s.id]);
    toast('Student deleted'); bump();
  }
  async function edit(s: Student) {
    if (await requirePin('modify', `Edit the saved record of ${s.name_en}?`)) onEdit(s.id);
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Student Directory</h1>
      <Card>
        <div className="grid gap-4 p-4 md:grid-cols-5">
          <ClassPicker allowAll classNo={filter.classNo} section={filter.section} stream={filter.classNo >= 9 ? filter.stream ?? '' : null} onChange={(v) => setFilter({ classNo: v.classNo, section: v.section, stream: v.stream })} />
          <label className="block md:col-span-2"><span className="label">Search</span>
            <div className="relative"><Search size={16} className="absolute left-3 top-2.5 text-slate-400" /><input className="input pl-9" placeholder="Name, ID, roll or mobile" value={q} onChange={(e) => setQ(e.target.value)} /></div></label>
        </div>
      </Card>
      <Card title={`${title} — ${rows.length} students`} actions={<>
        <button className="btn-ghost btn-sm" onClick={() => saveTextFile(`contacts-${title.replace(/\W+/g, '-')}.csv`, toCsv([['Student ID', 'Class', 'Section', 'Stream', 'Roll', 'Name', 'Name (Bangla)', "Father's Name", 'Mobile Number', "Mother's Mobile"], ...rows.map((s) => [s.student_id, s.class_no, s.section, s.stream, s.roll, s.name_en, s.name_bn, s.father_name, s.father_mobile, s.mother_mobile])]), 'text/csv')}><Download size={14} /> Export contacts CSV</button>
        <button className="btn-ghost btn-sm" onClick={() => setPrint(true)}><Printer size={14} /> Print directory</button>
      </>}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Photo</th><th>ID</th><th>Class</th><th>Roll</th><th>Name</th><th>Father's Name</th><th>Mobile</th><th className="text-right">Actions</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td>{s.photo ? <img src={s.photo} className="h-9 w-8 rounded object-cover" /> : <div className="grid h-9 w-8 place-items-center rounded bg-slate-100 text-xs text-slate-400">{s.name_en[0]}</div>}</td>
                  <td className="font-mono text-xs">{s.student_id}</td>
                  <td>{s.class_no}{settings.modules.sections && s.section ? `-${s.section}` : ''}{s.stream ? <span className="text-xs text-slate-400"> {s.stream}</span> : ''}</td>
                  <td>{s.roll}</td>
                  <td><button className="text-left font-medium hover:text-brand" onClick={() => openStudent(s.id)}>{s.name_en}</button>{s.name_bn && <div className="bn text-xs text-slate-500">{s.name_bn}</div>}</td>
                  <td>{s.father_name}</td>
                  <td>{s.father_mobile}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-ghost btn-sm" onClick={() => openStudent(s.id)} title="View"><Eye size={14} /></button>{' '}
                    <button className="btn-ghost btn-sm" onClick={() => edit(s)} title="Edit (PIN)"><Pencil size={14} /></button>{' '}
                    <button className="btn-ghost btn-sm text-bad" onClick={() => remove(s)} title="Delete (PIN)"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty>No students match.</Empty>}
        </div>
      </Card>
      <PrintPreview open={print} onClose={() => setPrint(false)} title="Student contact directory"><ContactDirectory school={settings.school} title={title} rows={rows} /></PrintPreview>
    </div>
  );
}
