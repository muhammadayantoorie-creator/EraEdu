import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable } from '../../../components/shared';
import api from '../../../services/api';
import {
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  AcademicCapIcon,
} from '@heroicons/react/24/outline';

interface QuizHistoryItem {
  _id: string;
  quizId: string;
  score: number | null;
  totalQuestions: number;
  correctAnswers: number | null;
  timeTaken: number;
  isCompleted: boolean;
  attemptedAt: string;
  quizTitle?: string;
  topicTitle?: string;
  courseTitle?: string;
  teacherGrade?: number | null;
  teacherFeedback?: string;
  reviewStatus?: 'pending' | 'reviewed';
}

const StudentQuizHistory = () => {
  const [attempts, setAttempts] = useState<QuizHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<'all' | 'passed' | 'failed'>('all');

  useEffect(() => {
    fetchQuizHistory();
  }, []);

  const fetchQuizHistory = async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await api.get('/quizzes/history');
      if (!Array.isArray(response.data?.data)) throw new Error('Invalid exam history response');
      setAttempts(response.data.data);
    } catch {
      setAttempts([]);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const visibleGrade = (attempt: QuizHistoryItem): number | null => {
    if (attempt.reviewStatus !== 'reviewed') return null;
    if (typeof attempt.teacherGrade === 'number') return attempt.teacherGrade;
    return typeof attempt.score === 'number' ? attempt.score : null;
  };

  const filteredAttempts = attempts.filter((attempt) => {
    const finalGrade = visibleGrade(attempt);
    if (filter === 'passed') return finalGrade !== null && finalGrade >= 70;
    if (filter === 'failed') return finalGrade !== null && finalGrade < 70;
    return true;
  });

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600 bg-green-100';
    if (score >= 60) return 'text-yellow-600 bg-yellow-100';
    return 'text-red-600 bg-red-100';
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  };

  const columns = [
    {
      key: 'quizTitle' as keyof QuizHistoryItem,
      header: 'Exam',
      render: (attempt: QuizHistoryItem) => (
        <div>
          <p className="font-medium text-gray-900">{attempt.quizTitle || 'Untitled Exam'}</p>
          <p className="text-sm text-gray-500">{attempt.topicTitle}</p>
        </div>
      ),
    },
    {
      key: 'courseTitle' as keyof QuizHistoryItem,
      header: 'Course',
    },
    {
      key: 'score' as keyof QuizHistoryItem,
      header: 'Auto Score',
      render: (attempt: QuizHistoryItem) => (
        <div className="flex items-center gap-2">
          {attempt.reviewStatus === 'reviewed' && attempt.score !== null ? (
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium ${getScoreColor(
                attempt.score
              )}`}
            >
              {attempt.score}%
            </span>
          ) : (
            <span className="text-sm text-gray-400">Hidden until review</span>
          )}
        </div>
      ),
    },
    {
      key: 'teacherGrade' as keyof QuizHistoryItem,
      header: 'Teacher Grade',
      render: (attempt: QuizHistoryItem) => (
        <div className="flex items-center gap-2">
          {attempt.reviewStatus === 'reviewed' && typeof attempt.teacherGrade === 'number' ? (
            <>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium ${getScoreColor(attempt.teacherGrade)}`}>
                {attempt.teacherGrade}%
              </span>
              {attempt.teacherGrade >= 70 ? (
                <CheckCircleIcon className="h-5 w-5 text-green-500" />
              ) : (
                <XCircleIcon className="h-5 w-5 text-red-500" />
              )}
            </>
          ) : (
            <span className="text-sm text-gray-400">{attempt.reviewStatus === 'reviewed' ? 'Not teacher graded' : 'Pending'}</span>
          )}
        </div>
      ),
    },
    {
      key: 'correctAnswers' as keyof QuizHistoryItem,
      header: 'Correct',
      render: (attempt: QuizHistoryItem) => (
        <span className="text-gray-600">
          {attempt.reviewStatus === 'reviewed' && attempt.correctAnswers !== null
            ? `${attempt.correctAnswers}/${attempt.totalQuestions}`
            : 'Pending review'}
        </span>
      ),
    },
    {
      key: 'attemptedAt' as keyof QuizHistoryItem,
      header: 'Completed',
      render: (attempt: QuizHistoryItem) => (
        <div className="text-sm">
          <p className="text-gray-900">{formatDate(attempt.attemptedAt)}</p>
          <p className="text-gray-500 flex items-center gap-1">
            <ClockIcon className="h-3 w-3" />
            {formatDuration(attempt.timeTaken)}
          </p>
        </div>
      ),
    },
    {
      key: '_id' as keyof QuizHistoryItem,
      header: 'Actions',
      render: (attempt: QuizHistoryItem) => (
        <div className="flex gap-2">
          <Link
            to={`/quiz/teacher-results/${attempt._id}`}
            className="text-primary-700 hover:text-primary-900 text-sm font-medium"
          >
            View Details
          </Link>
        </div>
      ),
    },
  ];

  // Calculate stats
  const totalAttempts = attempts.length;
  const reviewedAttempts = attempts.filter((a) => visibleGrade(a) !== null);
  const passedAttempts = reviewedAttempts.filter((a) => visibleGrade(a)! >= 70).length;
  const failedAttempts = reviewedAttempts.length - passedAttempts;
  const avgScore = reviewedAttempts.length > 0
    ? Math.round(reviewedAttempts.reduce((sum, a) => sum + visibleGrade(a)!, 0) / reviewedAttempts.length)
    : null;

  if (loading) return <div role="status" className="p-8 text-center text-gray-600">Loading exam history...</div>;
  if (error) return (
    <div role="alert" className="mx-auto max-w-xl rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
      Exam history could not be loaded. Please retry.
      <button type="button" onClick={fetchQuizHistory} className="ml-3 font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Retry</button>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Exam History</h1>
        <p className="text-sm text-gray-500 mt-1">Review your past exam attempts and track your progress.</p>
      </header>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-100 rounded-lg">
              <AcademicCapIcon className="h-6 w-6 text-primary-700" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Attempts</p>
              <p className="text-2xl font-bold text-gray-900">{totalAttempts}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <CheckCircleIcon className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Passed</p>
              <p className="text-2xl font-bold text-gray-900">
                {passedAttempts} <span className="text-sm font-normal text-gray-500">({reviewedAttempts.length > 0 ? Math.round((passedAttempts / reviewedAttempts.length) * 100) : 0}% of graded)</span>
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-100 rounded-lg">
              <ClockIcon className="h-6 w-6 text-primary-700" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Average Score</p>
              <p className="text-2xl font-bold text-gray-900">{avgScore === null ? '—' : `${avgScore}%`}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px">
            {(['all', 'passed', 'failed'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={`px-6 py-3 text-sm font-medium border-b-2 ${
                  filter === tab
                    ? 'border-primary-500 text-primary-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                  {tab === 'all'
                    ? totalAttempts
                    : tab === 'passed'
                    ? passedAttempts
                    : failedAttempts}
                </span>
              </button>
            ))}
          </nav>
        </div>

        {/* Quiz Table */}
        <div className="p-4">
          <DataTable
            columns={columns}
            data={filteredAttempts}
            isLoading={loading}
            emptyMessage="No exam attempts found"
          />
        </div>
      </div>
    </div>
  );
};

export default StudentQuizHistory;
