/**
 * One vocabulary for both products.
 *  School:   groups are Class 1–10 (with sections and Class 9–10 streams)
 *  Coaching: groups are the owner's Batches (ICT, Physics, SSC …), stored in the same class_no column.
 */
import type { AppSettings } from './config';
import { CLASSES } from './util';

export interface Group { no: number; label: string }

export const isCoaching = (s: Pick<AppSettings, 'product'>) => s.product === 'COACHING';

export function groups(s: AppSettings, includeInactive = false): Group[] {
  if (!isCoaching(s)) return CLASSES.map((c) => ({ no: c, label: `Class ${c}` }));
  return s.batches.filter((b) => includeInactive || b.active).map((b) => ({ no: b.no, label: b.name }));
}

export function groupLabel(s: AppSettings, no: number | null | undefined): string {
  if (!no) return '';
  if (!isCoaching(s)) return `Class ${no}`;
  return s.batches.find((b) => b.no === no)?.name ?? `Batch ${no}`;
}

/** Words used on screens and printed documents. */
export function terms(s: AppSettings) {
  const c = isCoaching(s);
  return {
    group: c ? 'Batch' : 'Class',
    groups: c ? 'Batches' : 'Classes',
    groupBn: c ? 'ব্যাচ' : 'শ্রেণি',
    institution: c ? 'Coaching Centre' : 'School',
    head: c ? 'Director' : 'Principal',
    teacher: c ? 'Batch Teacher' : 'Class Teacher',
    allGroups: c ? 'All Batches' : 'All Classes (1–10)',
    streams: !c,          // Science / Arts / Commerce only for school Class 9–10
    promotion: !c,        // year-end promotion only for schools
  };
}

/** e.g. "Class 9-A (Science)" or "Physics" */
export function placement(s: AppSettings, st: { class_no: number; section?: string | null; stream?: string | null }, showSection = s.modules.sections) {
  const base = groupLabel(s, st.class_no);
  // Only show the section letter when that class/batch really has more than one section.
  const sec = showSection && st.section && (s.sectionsPerClass[st.class_no] ?? 1) > 1 ? `-${st.section}` : '';
  return `${base}${sec}${!isCoaching(s) && st.stream ? ` (${st.stream})` : ''}`;
}
