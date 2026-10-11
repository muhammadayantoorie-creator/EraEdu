import { supabase } from '../config/supabase';

export const HISTORY_MIGRATION_MESSAGE = 'Assessment history protection is required before deletion. Apply backend/migrations/025_preserve_assessment_history.sql.';

export async function requireAssessmentHistoryProtection(): Promise<void> {
  const { data, error } = await supabase.rpc('assessment_history_protection_ready');
  if (error || data !== true) throw Object.assign(new Error(HISTORY_MIGRATION_MESSAGE), { statusCode: 503 });
}

export function explainProtectedDelete(error: any): never {
  if (error?.code === '23503') {
    throw Object.assign(new Error('This content is linked to assessment history or exams. Unpublish it instead of deleting it.'), { statusCode: 409 });
  }
  throw new Error(error?.message || 'Could not delete content');
}
