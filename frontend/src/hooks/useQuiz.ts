import { useState, useCallback, useRef } from 'react';
import api from '../services/api';
import { QuizAttempt, Question } from '../types';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

export const useQuiz = () => {
  const [currentAttempt, setCurrentAttempt] = useState<QuizAttempt | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const starting = useRef(false);
  const submitting = useRef(false);

  const startQuiz = useCallback(async (topicId: string) => {
    if (starting.current) return;
    starting.current = true;
    setLoading(true);
    try {
      const response = await api.post('/quizzes/generate', { topicId });
      const { quizId, attemptId, question } = response.data.data;
      if (!quizId || !attemptId || !question) throw new Error('No questions are available for this topic exam');
      navigate(`/quiz/${quizId}/attempt/${attemptId}`);

      setError(null);
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.message || 'Failed to start exam';
      setError(msg);
    } finally {
      setLoading(false);
      starting.current = false;
    }
  }, [navigate]);

  const getCurrentTopicQuestion = useCallback(async (attemptId: string) => {
    setLoading(true);
    try {
      const response = await api.get(`/quizzes/topic-attempt/${attemptId}/current`);
      if (response.data.data.isComplete) {
        navigate(`/quiz/results/${attemptId}`);
      } else {
        setCurrentQuestion(response.data.data.question);
      }
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to load exam question');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  const submitAnswer = useCallback(async (_quizId: string, attemptId: string, questionId: string, answer: number) => {
    if (submitting.current) return null;
    submitting.current = true;
    setLoading(true);
    try {
      const response = await api.post(`/quizzes/topic-attempt/${attemptId}/answer`, {
        questionId,
        selectedAnswer: answer
      });

      const result = response.data.data;
      
      // If quiz is completed
      if (result.isComplete) {
        toast.success('Exam completed!');
        navigate(`/quiz/results/${attemptId}`);
        return null;
      }

      // If not complete, fetch next question
      const nextQResponse = await api.get(`/quizzes/topic-attempt/${attemptId}/current`);
      if (nextQResponse.data.data.question) setCurrentQuestion(nextQResponse.data.data.question);
      else if (nextQResponse.data.data.isComplete) navigate(`/quiz/results/${attemptId}`);

      return result; // Return result for immediate feedback if needed
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || 'Failed to submit answer';
      setError(msg);
      toast.error(msg);
      return null;
    } finally {
      setLoading(false);
      submitting.current = false;
    }
  }, [navigate]);

  const getAttemptResults = useCallback(async (attemptId: string) => {
    setLoading(true);
    try {
      const response = await api.get(`/quizzes/attempt/${attemptId}/results`);
      setCurrentAttempt(response.data.data);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to fetch results');
    } finally {
      setLoading(false);
    }
  }, []);

  const getHint = useCallback(async (_questionId: string) => {
    // This would ideally call an endpoint to get a hint if not already present
    // For now, we assume the hint might be in the question object or fetched separately
    // Implementing a placeholder fetch
    try {
        // In a real app, you might have a specific endpoint for hints to avoid spoiling it in the initial payload
        // const response = await api.get(`/questions/${questionId}/hint`);
        // return response.data.hint;
        return "Think about the core concepts discussed in the topic.";
    } catch (error) {
        console.error(error);
        return "No hint available.";
    }
  }, []);

  return {
    currentAttempt,
    currentQuestion,
    loading,
    error,
    startQuiz,
    getCurrentTopicQuestion,
    submitAnswer,
    getAttemptResults,
    getHint
  };
};
