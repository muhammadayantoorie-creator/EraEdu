// Topic exams release on completion. Teacher exams retain teacher review.
// A legacy premature grade never releases an active attempt.
export function canReleaseStudentResult(attempt: { status?: string; topic_id?: unknown; teacher_grade?: unknown }): boolean {
  return attempt.status === 'completed' && (Boolean(attempt.topic_id)
    || (typeof attempt.teacher_grade === 'number' && Number.isFinite(attempt.teacher_grade)));
}
