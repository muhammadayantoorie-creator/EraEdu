import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';

type ViolationType = 'tab_change' | 'copy_attempt' | 'right_click' | 'screenshot_attempt' | 'keyboard_shortcut';

interface Violation {
  type: ViolationType;
  timestamp: Date;
}

interface UseQuizSecurityOptions {
  quizAttemptId: string;
  quizId?: string;
  teacherId?: string;
  onViolation?: (type: ViolationType, count: number) => void;
  enabled?: boolean;
}

export const useQuizSecurity = (options: UseQuizSecurityOptions) => {
  const { quizAttemptId, quizId, teacherId, onViolation, enabled = true } = options;
  const [violations, setViolations] = useState<Violation[]>([]);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [lastViolationType, setLastViolationType] = useState<ViolationType | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  const reportViolation = useCallback(async (type: ViolationType) => {
    const violation: Violation = { type, timestamp: new Date() };
    setViolations(prev => [...prev, violation]);
    setLastViolationType(type);
    
    // Show warning modal for tab changes
    if (type === 'tab_change') {
      setShowWarningModal(true);
    }

    const body = {
        event_id: typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        violationType: type,
        detectionMethod: 'browser_event',
        timestamp: new Date().toISOString(),
        quizId,
        teacherId
      };
    try {
      let response: any;
      let lastError: unknown;
      for (let retry = 0; retry < 3; retry += 1) {
        try { response = await api.post(`/quizzes/attempts/${quizAttemptId}/report-violation`, body); break; }
        catch (error) { lastError = error; if (retry < 2) await new Promise(resolve => setTimeout(resolve, 250 * (retry + 1))); }
      }
      if (!response) throw lastError;
      setWriteError(null);

      const count = response.data?.data?.violationCount || 1;
      const isAutoSubmitted = response.data?.data?.autoSubmitted || false;

      if (isAutoSubmitted) {
        const limit = response.data?.data?.violationLimit;
        toast.error(`Exam automatically submitted after reaching the ${limit}-violation limit.`, {
          duration: 5000,
          position: 'top-center',
        });
        window.location.href = `/quiz/results/${quizAttemptId}`;
      }

      onViolation?.(type, count);
    } catch (error) {
      console.error('Failed to report violation:', error);
      setWriteError('Monitoring event could not be saved; retry when connected.');
    }
  }, [quizAttemptId, quizId, teacherId, onViolation]);

  // Prevent right-click
  useEffect(() => {
    if (!enabled) return;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      reportViolation('right_click');
    };

    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, [enabled, reportViolation]);

  // Prevent copy
  useEffect(() => {
    if (!enabled) return;

    const handleCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      reportViolation('copy_attempt');
    };

    document.addEventListener('copy', handleCopy);
    return () => document.removeEventListener('copy', handleCopy);
  }, [enabled, reportViolation]);

  // Detect tab change (Visibility API)
  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        reportViolation('tab_change');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [enabled, reportViolation]);

  // Detect keyboard shortcuts
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent Ctrl+C, Ctrl+A, Ctrl+S, Ctrl+Shift+I, PrintScreen
      if ((e.ctrlKey || e.metaKey) && ['c', 'a', 's', 'i'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        reportViolation('keyboard_shortcut');
      }
      
      // PrintScreen detection
      if (e.key === 'PrintScreen') {
        e.preventDefault();
        reportViolation('screenshot_attempt');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled, reportViolation]);

  const dismissWarning = useCallback(() => {
    setShowWarningModal(false);
  }, []);

  return {
    violations,
    violationCount: violations.length,
    showWarningModal,
    lastViolationType,
    writeError,
    dismissWarning,
    reportViolation
  };
};

export default useQuizSecurity;
