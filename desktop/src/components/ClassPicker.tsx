import { useApp } from './AppContext';
import { CLASSES, SECTION_LETTERS, STREAMS } from '../lib/util';
import { Field } from './ui';

/** Class → Section (only if enabled) → Stream (only Class 9–10). */
export default function ClassPicker({ classNo, section, stream, onChange, allowAll, allowAllSections = true, requireStream }: {
  classNo: number | 0; section: string; stream?: string | null;
  onChange: (v: { classNo: number; section: string; stream: string | null }) => void;
  allowAll?: boolean; allowAllSections?: boolean; requireStream?: boolean;
}) {
  const { settings, t } = useApp();
  const sectionCount = classNo ? (settings.modules.sections ? settings.sectionsPerClass[classNo] ?? 1 : 1) : 0;
  const showSection = settings.modules.sections && classNo > 0 && sectionCount > 1;
  const showStream = classNo >= 9 && stream !== undefined;
  return (
    <>
      <Field label={t('class')}>
        <select className="input" value={classNo} onChange={(e) => onChange({ classNo: Number(e.target.value), section: allowAllSections ? '' : 'A', stream: Number(e.target.value) >= 9 ? (stream ?? (requireStream ? 'Science' : '')) : null })}>
          {allowAll && <option value={0}>All Classes (1–10)</option>}
          {!allowAll && classNo === 0 && <option value={0}>Select class…</option>}
          {CLASSES.map((c) => <option key={c} value={c}>Class {c}</option>)}
        </select>
      </Field>
      {showSection && (
        <Field label={t('section')}>
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
