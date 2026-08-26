import React, { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuiz } from '../../hooks/useQuiz';
import { CheckCircleIcon, ClockIcon, XCircleIcon } from '@heroicons/react/24/solid';
import { PostQuizFeedbackModal } from '../../components/shared';

const QuizResultsPage: React.FC = () => {
  const { attemptId } = useParams<{ attemptId: string }>();
  const { currentAttempt, loading, error, getAttemptResults } = useQuiz();

  useEffect(() => {
    if (attemptId) void getAttemptResults(attemptId);
  }, [attemptId, getAttemptResults]);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-primary-50"><span className="h-12 w-12 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" /></div>;

  if (error || !currentAttempt) {
    return <div className="flex min-h-screen items-center justify-center bg-primary-50 px-4"><div className="text-center"><p className="text-rose-700">{error || 'Results not found'}</p><Link to="/dashboard" className="mt-4 inline-block font-semibold text-primary-700 hover:text-primary-800">Return to Dashboard</Link></div></div>;
  }

  // Teacher-graded and short-answer submissions deliberately return no score
  // or answer review until the teacher has completed the review.
  const result: any = currentAttempt;
  const reviewPending = result.reviewPending === true;
  const answers = Array.isArray(result.answers) ? result.answers : [];
  const score = Number(result.score ?? 0);
  const maxScore = Number(result.maxScore ?? 0);
  const percentage = Number.isFinite(Number(result.percentage))
    ? Number(result.percentage)
    : maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

  return (
    <div className="min-h-screen bg-primary-50/60 px-4 py-12 sm:px-6 lg:px-8">
      {!reviewPending && <PostQuizFeedbackModal attemptId={attemptId} />}
      <div className="mx-auto max-w-3xl overflow-hidden rounded-3xl border border-primary-900/10 bg-white shadow-soft">
        <div className="bg-gradient-to-br from-primary-800 via-primary-700 to-teal-700 px-6 py-9 text-center text-white sm:px-10">
          <CheckCircleIcon className="mx-auto h-12 w-12 text-primary-200" />
          <h1 className="mt-3 font-display text-3xl">Quiz submitted</h1>
          <p className="mt-2 text-sm text-white/70">Your answers have been saved securely.</p>
        </div>

        {reviewPending ? (
          <div className="px-6 py-10 text-center sm:px-10">
            <ClockIcon className="mx-auto h-14 w-14 text-amber-500" />
            <h2 className="mt-4 text-2xl font-bold text-ink-900">Awaiting teacher review</h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-ink-500">Your submission was received successfully. Your score will appear here after your teacher reviews it.</p>
            <Link to="/dashboard" className="mt-7 inline-flex rounded-xl bg-primary-700 px-5 py-3 text-sm font-semibold text-white shadow-soft transition hover:bg-primary-800">Back to Dashboard</Link>
          </div>
        ) : (
          <div className="px-6 py-8 sm:px-10">
            {result.autoSubmitted && <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-800">This quiz was auto-submitted due to detected violations.</div>}
            <div className="text-center"><div className="mx-auto inline-flex h-32 w-32 items-center justify-center rounded-full bg-primary-50 ring-8 ring-primary-100"><span className="text-4xl font-bold text-primary-700">{percentage}%</span></div></div>
            <dl className="mt-8 grid gap-4 sm:grid-cols-3"><div className="rounded-2xl bg-primary-50 p-5 text-center"><dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Score</dt><dd className="mt-2 text-2xl font-bold text-ink-900">{score} / {maxScore}</dd></div><div className="rounded-2xl bg-primary-50 p-5 text-center"><dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Questions</dt><dd className="mt-2 text-2xl font-bold text-ink-900">{answers.length}</dd></div><div className="rounded-2xl bg-primary-50 p-5 text-center"><dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Status</dt><dd className="mt-2 text-2xl font-bold capitalize text-ink-900">{result.status || 'Completed'}</dd></div></dl>
            {answers.length > 0 && <><h2 className="mt-9 text-lg font-bold text-ink-900">Question review</h2><ul className="mt-3 divide-y divide-ink-900/10">{answers.map((answer: any, index: number) => <li key={index} className="flex gap-3 py-4">{answer.isCorrect ? <CheckCircleIcon className="h-6 w-6 shrink-0 text-emerald-500" /> : <XCircleIcon className="h-6 w-6 shrink-0 text-rose-500" />}<div><p className="text-sm font-semibold text-ink-900">Question {index + 1}</p><p className="mt-1 text-sm text-ink-500">Your answer: <span className={answer.isCorrect ? 'text-emerald-700' : 'text-rose-700'}>{answer.selectedAnswer ?? answer.studentAnswer ?? 'No answer'}</span></p></div></li>)}</ul></>}
            <div className="mt-8 text-center"><Link to="/dashboard" className="inline-flex rounded-xl bg-primary-700 px-5 py-3 text-sm font-semibold text-white shadow-soft transition hover:bg-primary-800">Back to Dashboard</Link></div>
          </div>
        )}
      </div>
    </div>
  );
};

export default QuizResultsPage;
