import { useState, useCallback, useRef } from 'react';
import api from '../services/api';
import { Course, Topic } from '../types';
import toast from 'react-hot-toast';

export const useCourses = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [currentCourse, setCurrentCourse] = useState<Course | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const enrollmentPending = useRef(false);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });

  const fetchCourses = useCallback(async (params?: any) => {
    setLoading(true);
    try {
      const response = await api.get('/courses', { params });
      setCourses(response.data.data);
      setPagination(response.data.pagination);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to fetch courses');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCourseById = useCallback(async (id: string, preserveCurrent = false) => {
    setLoading(true);
    setError(null);
    if (!preserveCurrent) {
      setCurrentCourse(null);
      setTopics([]);
    }
    try {
      const response = await api.get(`/courses/${id}`);
      const course: Course = response.data.data;
      if (typeof course.isEnrolled !== 'boolean' || typeof course.canViewTopics !== 'boolean') {
        throw new Error('Course enrollment state is unavailable. Please retry.');
      }
      setCurrentCourse(course);
      if (course.canViewTopics) {
        const topicsResponse = await api.get(`/courses/${id}/topics`);
        setTopics(topicsResponse.data.data);
      } else {
        setTopics([]);
      }
      
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.message || err.response?.data?.error?.message || err.message || 'Failed to fetch course details');
    } finally {
      setLoading(false);
    }
  }, []);

  const enrollInCourse = useCallback(async (courseId: string) => {
    if (enrollmentPending.current) return;
    enrollmentPending.current = true;
    setEnrolling(true);
    setError(null);
    try {
      const response = await api.post(`/courses/${courseId}/enroll`);
      if (response.data.data?.isEnrolled !== true) throw new Error('Enrollment confirmation is unavailable. Please retry.');
      setCurrentCourse(previous => previous ? { ...previous, isEnrolled: true } : previous);
      toast.success(response.data.data.alreadyEnrolled ? 'Already enrolled' : 'Enrolled successfully!');
      await fetchCourseById(courseId, true);
    } catch (err: any) {
      const message = err.response?.data?.message || err.response?.data?.error?.message || err.message || 'Failed to enroll';
      toast.error(message);
      setError(message);
    } finally {
      enrollmentPending.current = false;
      setEnrolling(false);
    }
  }, [fetchCourseById]);

  const fetchEnrolledCourses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/courses/my/enrolled');
      const rows: Course[] = response.data.data;
      if (!Array.isArray(rows) || rows.some(row => !Number.isSafeInteger(row.topicsCount) || row.topicsCount! < 0)) {
        throw new Error('The enrolled-course response is missing topic counts. Please retry.');
      }
      setCourses(rows);
      setPagination(response.data.pagination);
      setError(null);
    } catch (err: any) {
      setCourses([]);
      setError(err.response?.data?.message || err.response?.data?.error?.message || err.message || 'Failed to fetch enrolled courses');
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    courses,
    currentCourse,
    topics,
    loading,
    error,
    enrolling,
    pagination,
    fetchCourses,
    fetchCourseById,
    enrollInCourse,
    fetchEnrolledCourses,
  };
};
