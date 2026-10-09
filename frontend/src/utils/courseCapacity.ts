export const COURSE_CAPACITY_ERROR = 'Max students must be a positive whole number, or blank for unlimited.';

export function parseCourseCapacity(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[0-9]+$/.test(trimmed)) throw new Error(COURSE_CAPACITY_ERROR);
  const capacity = Number(trimmed);
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 2147483647) throw new Error(COURSE_CAPACITY_ERROR);
  return capacity;
}
