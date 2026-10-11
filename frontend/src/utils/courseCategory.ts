export const MAX_COURSE_CATEGORY_LENGTH = 100;

export function parseCourseCategory(value: string): string {
  const category = value.trim().replace(/\s+/g, ' ');
  if (!category) throw new Error('Course category is required. Enter one or choose a suggestion.');
  if (category.length > MAX_COURSE_CATEGORY_LENGTH || /[\p{Cc}\p{Cf}]/u.test(category) || !/[\p{L}\p{N}]/u.test(category)) {
    throw new Error('Course category must contain letters or numbers, have no control characters, and be at most 100 characters.');
  }
  return category;
}
