import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../services/api';
import { Topic } from '../../types';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import { useAuthStore } from '../../store/authStore';

const TopicPage: React.FC = () => {
  const { courseId, topicId } = useParams<{ courseId: string; topicId: string }>();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const role = useAuthStore(state => state.user?.role);
  const coursesPath = `/dashboard/${role || 'student'}/courses`;

  useEffect(() => {
    if (!courseId || !topicId) {
      setError('A course and topic are required to open study material.');
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setTopic(null);
    const fetchTopic = async () => {
      try {
        const response = await api.get(`/courses/${courseId}/topics/${topicId}`, { signal: controller.signal });
        setTopic(response.data.data);
      } catch (err: any) {
        if (controller.signal.aborted) return;
        const status = err.response?.status;
        setError(status === 404 ? 'This topic was not found in the course.'
          : status === 403 ? 'You do not have access to this topic. Enroll in the course or contact your teacher.'
          : err.response?.data?.error?.message || 'Failed to load study material. Please try again.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void fetchTopic();
    return () => controller.abort();
  }, [courseId, topicId]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (error || !topic) {
    return (
      <div className="bg-red-50 border-l-4 border-red-400 p-4">
        <div className="flex">
          <div className="ml-3">
            <p className="text-sm text-red-700">{error || 'Topic not found'}</p>
            <Link to={courseId ? `/courses/${courseId}` : coursesPath} className="text-sm font-medium text-red-700 hover:text-red-600 mt-2 inline-block">
              &larr; Back to {courseId ? 'Course' : 'Courses'}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
          <h1 className="text-3xl font-bold text-gray-900">{topic.title}</h1>
          {topic.difficulty && <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Difficulty: <span className="font-medium text-indigo-600">{topic.difficulty}</span>
          </p>}
        </div>
        
        <div className="px-4 py-5 sm:px-6 prose prose-indigo max-w-none">
          <div className="text-gray-700 whitespace-pre-wrap">
            {topic.content || topic.description || 'No study material has been added to this topic yet.'}
          </div>
        </div>

        <div className="px-4 py-5 sm:px-6 bg-gray-50 border-t border-gray-200 flex justify-end">
          <Link
            to={`/quiz/start/${topic._id}`}
            className="inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <CheckCircleIcon className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
            Take Exam for this Topic
          </Link>
        </div>
      </div>
    </div>
  );
};

export default TopicPage;
