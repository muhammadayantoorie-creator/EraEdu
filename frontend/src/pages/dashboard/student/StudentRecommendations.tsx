import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../services/api';
import {
  LightBulbIcon,
  BookOpenIcon,
  AcademicCapIcon,
  ArrowTrendingUpIcon,
  SparklesIcon,
  ArrowRightIcon,
} from '@heroicons/react/24/outline';

interface Recommendation {
  id: string;
  type: 'topic' | 'course' | 'quiz' | 'review';
  title: string;
  description: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  actionUrl?: string;
  actionLabel?: string;
  metadata?: {
    courseId?: string;
    topicId?: string;
    difficulty?: string;
    estimatedTime?: string;
  };
}

interface LearningInsight {
  type: 'strength' | 'weakness' | 'suggestion';
  title: string;
  description: string;
  topics?: string[];
}

const StudentRecommendations = () => {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [insights, setInsights] = useState<LearningInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchRecommendations();
  }, []);

  const fetchRecommendations = async () => {
    setLoading(true);
    setError(false);
    try {
      const [recsResponse, insightsResponse] = await Promise.all([
        api.get('/ai/recommendations'),
        api.get('/ai/insights'),
      ]);
      setRecommendations(Array.isArray(recsResponse.data.data) ? recsResponse.data.data : []);
      setInsights(Array.isArray(insightsResponse.data.data) ? insightsResponse.data.data : []);
      setUnavailable(recsResponse.data.available === false || insightsResponse.data.available === false);
    } catch {
      setRecommendations([]);
      setInsights([]);
      setUnavailable(false);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const getPriorityBadge = (priority: Recommendation['priority']) => {
    const styles = {
      high: 'bg-red-100 text-red-800',
      medium: 'bg-yellow-100 text-yellow-800',
      low: 'bg-primary-100 text-primary-800',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[priority]}`}>
        {priority.charAt(0).toUpperCase() + priority.slice(1)} Priority
      </span>
    );
  };

  const getTypeIcon = (type: Recommendation['type']) => {
    switch (type) {
      case 'topic':
        return <BookOpenIcon className="h-5 w-5" />;
      case 'course':
        return <AcademicCapIcon className="h-5 w-5" />;
      case 'quiz':
        return <LightBulbIcon className="h-5 w-5" />;
      case 'review':
        return <ArrowTrendingUpIcon className="h-5 w-5" />;
      default:
        return <SparklesIcon className="h-5 w-5" />;
    }
  };

  const getInsightIcon = (type: LearningInsight['type']) => {
    switch (type) {
      case 'strength':
        return <div className="p-2 bg-green-100 rounded-lg"><ArrowTrendingUpIcon className="h-5 w-5 text-green-600" /></div>;
      case 'weakness':
        return <div className="p-2 bg-red-100 rounded-lg"><ArrowTrendingUpIcon className="h-5 w-5 text-red-600 transform rotate-180" /></div>;
      case 'suggestion':
        return <div className="p-2 bg-primary-100 rounded-lg"><LightBulbIcon className="h-5 w-5 text-primary-700" /></div>;
      default:
        return <div className="p-2 bg-gray-100 rounded-lg"><SparklesIcon className="h-5 w-5 text-gray-600" /></div>;
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="bg-gradient-to-r from-primary-600 to-primary-700 rounded-xl p-6 text-white">
        <div className="flex items-center gap-3 mb-2">
          <SparklesIcon className="h-8 w-8" />
          <h1 className="text-2xl font-bold">Learning Recommendations</h1>
        </div>
        <p className="text-white/90">
          Recommendations and insights will appear here when they are available.
        </p>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          Recommendations could not be loaded. Please try again.
          <button type="button" onClick={fetchRecommendations} className="ml-3 font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
            Retry
          </button>
        </div>
      )}

      {unavailable && !error && (
        <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          Personalized recommendations and insights are not available yet. No exam scores or study plans are being inferred.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Recommendations */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Recommended for You</h2>
          
          {recommendations.length > 0 ? (
            recommendations.map((rec) => (
              <div
                key={rec.id}
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start gap-4">
                  <div className={`p-2 rounded-lg ${
                    rec.type === 'topic' ? 'bg-blue-100 text-blue-600' :
                    rec.type === 'quiz' ? 'bg-yellow-100 text-yellow-600' :
                    rec.type === 'course' ? 'bg-green-100 text-green-600' :
                    'bg-primary-100 text-primary-700'
                  }`}>
                    {getTypeIcon(rec.type)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-gray-900">{rec.title}</h3>
                          {getPriorityBadge(rec.priority)}
                        </div>
                        <p className="text-sm text-gray-600 mb-2">{rec.description}</p>
                        <p className="text-sm text-gray-500 italic">"{rec.reason}"</p>
                        {rec.metadata && (
                          <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                            {rec.metadata.difficulty && (
                              <span className="capitalize">{rec.metadata.difficulty}</span>
                            )}
                            {rec.metadata.estimatedTime && (
                              <span>⏱ {rec.metadata.estimatedTime}</span>
                            )}
                          </div>
                        )}
                      </div>
                      {rec.actionUrl && (
                        <Link
                          to={rec.actionUrl}
                          className="flex-shrink-0 inline-flex items-center gap-1 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
                        >
                          {rec.actionLabel || 'Start'}
                          <ArrowRightIcon className="h-4 w-4" />
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
              <SparklesIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">{error ? 'Recommendations unavailable' : 'No recommendations yet'}</h3>
              <p className="text-gray-500">
                {error ? 'Recommendations could not be loaded.' : unavailable ? 'Personalized recommendations are not available yet.' : 'No recommendations are available for your account yet.'}
              </p>
            </div>
          )}
        </div>

        {/* Learning Insights Sidebar */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Learning Insights</h2>
          
          {insights.length > 0 ? (
            insights.map((insight, index) => (
              <div
                key={index}
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-4"
              >
                <div className="flex items-start gap-3">
                  {getInsightIcon(insight.type)}
                  <div>
                    <h4 className="font-medium text-gray-900 text-sm">{insight.title}</h4>
                    <p className="text-xs text-gray-500 mt-1">{insight.description}</p>
                    {insight.topics && insight.topics.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {insight.topics.map((topic, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full"
                          >
                            {topic}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
              <LightBulbIcon className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">
                {error ? 'Learning insights could not be loaded.' : unavailable ? 'Personalized insights are not available yet.' : 'No learning insights are available for your account yet.'}
              </p>
            </div>
          )}

          {/* Quick Actions */}
          <div className="bg-gradient-to-br from-primary-50 to-primary-100 rounded-xl border border-primary-100 p-4">
            <h4 className="font-medium text-gray-900 mb-3">Quick Actions</h4>
            <div className="space-y-2">
              <Link
                to="/courses"
                className="flex items-center gap-2 p-2 bg-white rounded-lg hover:bg-gray-50 transition-colors"
              >
                <BookOpenIcon className="h-5 w-5 text-primary-700" />
                <span className="text-sm font-medium text-gray-700">Browse Courses</span>
              </Link>
              <Link
                to="/dashboard/student/quiz-history"
                className="flex items-center gap-2 p-2 bg-white rounded-lg hover:bg-gray-50 transition-colors"
              >
                <AcademicCapIcon className="h-5 w-5 text-green-600" />
                <span className="text-sm font-medium text-gray-700">View Exam History</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StudentRecommendations;
