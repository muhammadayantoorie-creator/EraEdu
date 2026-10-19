export const hasTeacherGrade = (grade: unknown): grade is number =>
  typeof grade === 'number' && Number.isFinite(grade);

// Prefer the API's operational explanation over a generic page message.
// Unknown JavaScript/network errors do not expose their raw internal text.
export function submissionErrorMessage(error: unknown, fallback: string): string {
  const response = (error as { response?: { data?: { error?: { message?: unknown }; message?: unknown } } })?.response?.data;
  const message = response?.error?.message ?? response?.message;
  return typeof message === 'string' && message.trim() && message.length <= 1000 ? message : fallback;
}
