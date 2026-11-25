import { useApp } from './AppContext';
import { SECTION_LETTERS, STREAMS } from '../lib/util';
import { groups, terms } from '../lib/groups';
import { Field } from './ui';

/** Class/Batch → Section (only if enabled) → Stream (school Class 9–10 only). */
export default function ClassPicker({ classNo, section, stream, onChange, allowAll, allowAllSections = true, requireStream }: {
  classNo: number | 0; section: string; stream?: string | null;
  onChange: (v: { classNo: number; section: string; stream: string | null }) => void;
  allowAll?: boolean; allowAllSections?: boolean; requireStream?: boolean;
}) {
  const { settings } = useApp();
  const T = terms(settings);
  const list = groups(settings);
  const sectionCount = classNo ? (settings.modules.sections ? settings.sectionsPerClass[classNo] ?? 1 : 1) : 0;
  const showSection = settings.modules.sections && classNo > 0 && sectionCount > 1;
  const showStream = T.streams && classNo >= 9 && stream !== undefined;
  return (
    <>
      <Field label={T.group}>
        <select className="input" value={classNo} onChange={(e) => {
          const n = Number(e.target.value);
          onChange({ classNo: n, section: allowAllSections ? '' : 'A', stream: T.streams && n >= 9 ? (stream ?? (requireStream ? 'Science' : '')) : null });
        }}>
          {allowAll && <option value={0}>{T.allGroups}</option>}
          {!allowAll && !list.some((g) => g.no === classNo) && <option value={0}>Select {T.group.toLowerCase()}…</option>}
          {list.map((g) => <option key={g.no} value={g.no}>{g.label}</option>)}
        </select>
      </Field>
      {showSection && (
        <Field label="Section">
          <select className="input" value={section} onChange={(e) => onChange({ classNo, section: e.target.value, stream: stream ?? null })}>
            {allowAllSections && <option value="">All sections</option>}
            {SECTION_LETTERS.slice(0, sectionCount).map((s) => <option key={s} value={s}>Section {s}</option>)}
          </select>
        </Field>
      )}
      {showStream && (
        <Field label="Stream / Category">
          <select className="input" value={stream ?? ''} onChange={(e) => onChange({ classNo, section, stream: e.target.value || null })}>
            {!requireStream && <option value="">All streams</option>}
            {STREAMS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      )}
    </>
  );
}
