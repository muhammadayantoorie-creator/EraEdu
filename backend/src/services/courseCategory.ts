import { supabase } from '../config/supabase';

export const MAX_COURSE_CATEGORY_LENGTH = 100;

const suggestedCategories = [
  'Web Development', 'Mobile Development', 'Data Science', 'Machine Learning',
  'DevOps', 'Cybersecurity', 'Database', 'Cloud Computing',
  'Programming Languages', 'Software Engineering', 'Other',
];

export function normalizeCourseCategory(value: unknown): string {
  if (typeof value !== 'string') throw Object.assign(new Error('Course category is required.'), { statusCode: 400 });
  const category = value.trim().replace(/\s+/g, ' ');
  if (!category) throw Object.assign(new Error('Course category is required.'), { statusCode: 400 });
  if (category.length > MAX_COURSE_CATEGORY_LENGTH || /[\p{Cc}\p{Cf}]/u.test(category) || !/[\p{L}\p{N}]/u.test(category)) {
    throw Object.assign(new Error('Course category must contain letters or numbers, have no control characters, and be at most 100 characters.'), { statusCode: 400 });
  }
  return category;
}

export function categoryKey(category: string): string {
  return category.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export async function canonicalCourseCategory(value: unknown, current?: string | null): Promise<string> {
  const category = normalizeCourseCategory(value);
  if (current && categoryKey(current) === categoryKey(category)) return current;
  // Keep the first saved spelling for any category; do not rewrite old rows.
  const escaped = category.replace(/[\\%_]/g, '\\$&');
  const { data, error } = await supabase.from('courses').select('category').ilike('category', escaped)
    .order('created_at', { ascending: true }).limit(100);
  if (error) throw new Error(error.message);
  const existing = (data || []).find((row: any) => typeof row.category === 'string' && categoryKey(row.category) === categoryKey(category))?.category;
  if (existing) return existing;
  return suggestedCategories.find(item => categoryKey(item) === categoryKey(category)) || category;
}
