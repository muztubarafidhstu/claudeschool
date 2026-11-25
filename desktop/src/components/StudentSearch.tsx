import { useEffect, useState } from 'react';
import { useApp } from './AppContext';
import { placement } from '../lib/groups';
import { Search } from 'lucide-react';
import { db } from '../lib/db';
import type { Student } from '../lib/fees';

/** Search by Student ID, Roll Number or Guardian mobile. */
export async function searchStudents(q: string, limit = 12): Promise<Student[]> {
  const s = q.trim();
  if (!s) return [];
  const digits = s.replace(/\D/g, '');
  if (/^\d{1,3}$/.test(s)) {
    return db.select<Student>("SELECT * FROM students WHERE status='active' AND (roll = ? OR student_id LIKE ?) ORDER BY class_no, roll LIMIT ?", [Number(s), `${s}%`, limit]);
  }
  if (digits.length >= 4 && digits.length === s.replace(/[\s+-]/g, '').length) {
    const tail = digits.slice(-10);
    return db.select<Student>(
      "SELECT * FROM students WHERE status='active' AND (student_id LIKE ? OR father_mobile LIKE ? OR mother_mobile LIKE ?) ORDER BY class_no, roll LIMIT ?",
      [`${digits}%`, `%${tail}%`, `%${tail}%`, limit]);
  }
  return db.select<Student>("SELECT * FROM students WHERE status='active' AND (name_en LIKE ? OR name_bn LIKE ?) ORDER BY class_no, roll LIMIT ?", [`%${s}%`, `%${s}%`, limit]);
}

export default function StudentSearch({ onPick, placeholder = 'Student ID, roll or guardian mobile…', autoFocus }: { onPick: (s: Student) => void; placeholder?: string; autoFocus?: boolean }) {
  const { settings } = useApp();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Student[]>([]);
  useEffect(() => { const h = setTimeout(() => searchStudents(q).then(setRows), 150); return () => clearTimeout(h); }, [q]);
  return (
    <div className="relative">
      <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
      <input autoFocus={autoFocus} className="input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      {rows.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-line bg-white shadow-xl">
          {rows.map((s) => (
            <button key={s.id} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50" onClick={() => { onPick(s); setQ(''); setRows([]); }}>
              {s.photo ? <img src={s.photo} className="h-9 w-8 rounded object-cover" /> : <div className="h-9 w-8 rounded bg-slate-100" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{s.name_en} {s.name_bn && <span className="bn font-normal text-slate-500">· {s.name_bn}</span>}</div>
                <div className="text-xs text-slate-500">ID {s.student_id} · {placement(settings, s)} · Roll {s.roll} · {s.father_mobile}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
