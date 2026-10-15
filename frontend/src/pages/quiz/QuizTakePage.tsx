import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { ClockIcon, CheckCircleIcon, ExclamationTriangleIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';

// Face models are large. Load them only for quizzes where monitoring is on,
// so normal quizzes become ready without downloading ML code.
const FaceDetectionCamera = lazy(() => import('../../components/shared/FaceDetectionCamera'));

interface Question {
  _id: string;
  text: string;
  options: string[];
  difficulty: string;
  timeLimit: number;
  questionType?: 'multipleChoice' | 'shortAnswer';
  answerText?: string;
}

interface QuizData {
  attemptId: string;
  quiz: {
    _id: string;
    title: string;
    description: string;
    timeLimit: number;
    cameraMonitoring?: boolean;
    violationLimit?: number;
    questions: Question[];
  };
  code: string;
}

interface QuestionDeadline {
  activatedAt?: string;
  deadlineAt?: string;
}

interface ActiveTeacherAttempt {
  attemptId: string;
  status: string;
  serverNow?: string;
  quiz?: QuizData['quiz'];
  questionStates?: Record<string, QuestionDeadline>;
  savedAnswers?: Record<string, number | string>;
  autoSubmitted?: boolean;
  submissionReason?: string | null;
}

interface PendingAnswer {
  questionId: string;
  questionIndex: number;
  selectedAnswer: number | string;
}

const isShortAnswerQuestion = (question: Question) =>
  question.questionType === 'shortAnswer' || !question.options?.length;

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const apiErrorMessage = (error: any, fallback: string) =>
  error?.response?.data?.error?.message || error?.response?.data?.message || fallback;

type ViolationType =
  | 'TAB_SWITCH'
  | 'SYSTEM_FOCUS_LOST'
  | 'RESTRICTED_KEY'
  | 'FACE_AWAY'
  | 'NO_FACE'
  | 'WINDOW_RESIZE'
  | 'FULLSCREEN_EXIT'
  | 'PICTURE_IN_PICTURE'
  | 'CLIPBOARD_ATTEMPT'
  | 'AUTOMATION_DETECTED';

interface ViolationPayload {
  event_id: string;
  violation_type: ViolationType;
  alert_message: string;
  event_timestamp: string;
  duration_seconds?: number;
  meta_data: {
    ip: string;
    user_agent: string;
    key_name?: string;
    focus_state?: string;
    viewport?: string;
    screen_extended?: boolean;
  };
}

const QuizTakePage = () => {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();

  const [quizData,             setQuizData]             = useState<QuizData | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswers,      setSelectedAnswers]      = useState<Record<number, number | string>>({});
  const [timeLeft,             setTimeLeft]             = useState<number>(0);
  const [questionDeadlines,    setQuestionDeadlines]    = useState<Record<string, QuestionDeadline>>({});
  const [serverClockOffsetMs,  setServerClockOffsetMs]  = useState(0);
  const [activatingQuestion,   setActivatingQuestion]   = useState(false);
  const [savingQuestionId,     setSavingQuestionId]     = useState<string | null>(null);
  const [loadError,            setLoadError]            = useState<string | null>(null);
  const [activationError,      setActivationError]      = useState<string | null>(null);
  const [activationRetry,      setActivationRetry]      = useState(0);
  const [answerWriteError,     setAnswerWriteError]     = useState<string | null>(null);
  const [loadRetry,            setLoadRetry]            = useState(0);
  const [submitting,           setSubmitting]           = useState(false);
  const [showWarning,          setShowWarning]          = useState(false);
  const [warningMessage,       setWarningMessage]       = useState('');
  const [violationWriteError,  setViolationWriteError]  = useState<string | null>(null);
  const [secureModeReady,      setSecureModeReady]      = useState(
    () => typeof document === 'undefined' || !document.documentElement.requestFullscreen || !!document.fullscreenElement,
  );

  // Anti-cheating state
  const violations             = useRef<ViolationPayload[]>([]);
  const tabHiddenStartRef      = useRef<number | null>(null);
  // Prevents blur + visibilitychange from double-counting the same event
  const violationCooldownRef   = useRef(false);
  const lastViolationAtRef     = useRef<Record<string, number>>({});
  const focusLossEpisodeRef    = useRef(false);
  const resizeEpisodeRef       = useRef(false);
  // Face monitoring can be delivered by a remount or a delayed detector frame;
  // submit an attempt at most once from that source.
  const faceAutoSubmitRef      = useRef(false);
  const submittingRef          = useRef(false);
  const autoAdvancedDeadlineRef = useRef(new Set<string>());
  const previousTimerRef = useRef<{ questionId: string; remaining: number } | null>(null);
  const shortAnswerSaveRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedAnswersRef     = useRef<Record<number, number | string>>({});
  const quizDataRef            = useRef<QuizData | null>(null);
  const currentQuestionIndexRef = useRef(0);
  const answerWriteQueueRef    = useRef<Promise<void>>(Promise.resolve());
  const failedAnswersRef       = useRef(new Map<string, PendingAnswer>());
  const savedAnswersRef        = useRef<Record<number, number | string>>({});
  const fullscreenEnteredRef   = useRef(!!document.fullscreenElement);
  const viewportBaselineRef    = useRef({
    width: window.innerWidth,
    height: window.innerHeight,
    area: window.innerWidth * window.innerHeight,
  });

  // -----------------------------------------------------------------------
  // Prevent accidental navigation away from quiz
  // -----------------------------------------------------------------------
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!submitting) {
        e.preventDefault();
        e.returnValue = 'Your exam is in progress. Leaving will not submit your answers.';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [submitting]);

  useEffect(() => {
    selectedAnswersRef.current = selectedAnswers;
  }, [selectedAnswers]);

  useEffect(() => {
    quizDataRef.current = quizData;
  }, [quizData]);

  useEffect(() => {
    currentQuestionIndexRef.current = currentQuestionIndex;
  }, [currentQuestionIndex]);

  useEffect(() => () => {
    if (shortAnswerSaveRef.current) clearTimeout(shortAnswerSaveRef.current);
  }, []);

  // -----------------------------------------------------------------------
  // Build a violation payload
  // -----------------------------------------------------------------------
  const createViolationPayload = useCallback((
    violationType: ViolationType,
    alertMessage: string,
    options?: { durationSeconds?: number; keyName?: string; focusState?: string },
  ): ViolationPayload => ({
    event_id: typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    violation_type: violationType,
    alert_message: alertMessage,
    event_timestamp: new Date().toISOString(),
    ...(typeof options?.durationSeconds === 'number' ? { duration_seconds: options.durationSeconds } : {}),
    meta_data: {
      ip: 'N/A',
      user_agent: navigator.userAgent,
      ...(options?.keyName    ? { key_name:    options.keyName    } : {}),
      ...(options?.focusState ? { focus_state: options.focusState } : {}),
    },
  }), []);

  // -----------------------------------------------------------------------
  // Report a violation to backend
  // -----------------------------------------------------------------------
  const reportViolation = useCallback(async (payload: ViolationPayload) => {
    if (!quizData || submittingRef.current) return;
    const now = Date.now();
    const lastReportedAt = lastViolationAtRef.current[payload.violation_type] || 0;
    if (now - lastReportedAt < 1_200) return;
    lastViolationAtRef.current[payload.violation_type] = now;

    violations.current = [...violations.current, payload];
    setWarningMessage(payload.alert_message);
    setShowWarning(true);
    setTimeout(() => setShowWarning(false), 2000);

    // Map frontend enum to backend violation_type string
    const backendViolationType =
      payload.violation_type === 'TAB_SWITCH'       ? 'tab_change'        :
      payload.violation_type === 'SYSTEM_FOCUS_LOST' ? 'focus_loss'        :
      payload.violation_type === 'FACE_AWAY'         ? 'face_away'         :
      payload.violation_type === 'NO_FACE'           ? 'no_face'           :
      payload.violation_type === 'WINDOW_RESIZE'     ? 'window_resize'     :
      payload.violation_type === 'FULLSCREEN_EXIT'   ? 'fullscreen_exit'   :
      payload.violation_type === 'PICTURE_IN_PICTURE'? 'picture_in_picture':
      payload.violation_type === 'CLIPBOARD_ATTEMPT' ? 'copy_attempt'      :
      payload.violation_type === 'AUTOMATION_DETECTED' ? 'automation_detected' :
      'keyboard_shortcut';

    try {
      const requestBody = {
        event_id: payload.event_id,
        violation_type: backendViolationType,
        violationType:  backendViolationType,
        alert_message:   payload.alert_message,
        event_timestamp: payload.event_timestamp,
        duration_seconds: payload.duration_seconds,
        meta_data: payload.meta_data,
        detectionMethod:
          payload.violation_type === 'FACE_AWAY' || payload.violation_type === 'NO_FACE'
            ? 'camera_face_detection'
            : 'browser_event',
        quizId: quizData?.quiz._id,
      };
      let response: any;
      let lastError: unknown;
      for (let retry = 0; retry < 3; retry += 1) {
        try {
          response = await api.post(`/quizzes/attempts/${attemptId}/report-violation`, requestBody);
          break;
        } catch (error) {
          lastError = error;
          if (retry < 2) await new Promise(resolve => setTimeout(resolve, 250 * (retry + 1)));
        }
      }
      if (!response) throw lastError;

      setViolationWriteError(null);

      if (response.data?.data?.autoSubmitted) {
        if (submittingRef.current) return;
        submittingRef.current = true;
        setSubmitting(true);
        const limit = response.data.data.violationLimit;
        // The server reports and finalizes under one attempt lock. Do not send
        // a shorter browser-memory answer list afterward: it could overwrite
        // saved answers from this or another tab.
        sessionStorage.removeItem('currentQuiz');
        toast.error(`Exam automatically submitted after reaching the ${limit}-violation limit.`, { duration: 5000 });
        navigate(`/quiz/teacher-results/${attemptId}`);
      } else if (response.data?.data?.remainingViolations !== undefined) {
        const remaining = response.data.data.remainingViolations;
        toast.error(`${remaining} violation${remaining === 1 ? '' : 's'} remaining before automatic submission.`, { duration: 3000 });
      }
    } catch {
      setViolationWriteError('Monitoring event could not be saved. It will not be counted until the connection is restored.');
    }
  }, [attemptId, navigate, quizData]);

  const enterSecureMode = useCallback(async () => {
    if (typeof document.documentElement.requestFullscreen !== 'function') {
      setSecureModeReady(true);
      return;
    }
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      fullscreenEnteredRef.current = true;
      viewportBaselineRef.current = {
        width: window.innerWidth,
        height: window.innerHeight,
        area: window.innerWidth * window.innerHeight,
      };
      setSecureModeReady(true);
    } catch {
      toast.error('Secure fullscreen is required to continue this exam.');
    }
  }, []);

  // -----------------------------------------------------------------------
  // Browser anti-cheat event listeners
  // -----------------------------------------------------------------------
  useEffect(() => {
    // Tab visibility — tracks how long tab was hidden
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        violationCooldownRef.current = true; // block blur handler
        tabHiddenStartRef.current = Date.now();
        return;
      }
      if (document.visibilityState === 'visible' && tabHiddenStartRef.current) {
        const durationSeconds = Math.max(1, Math.round((Date.now() - tabHiddenStartRef.current) / 1000));
        tabHiddenStartRef.current = null;
        reportViolation(createViolationPayload(
          'TAB_SWITCH',
          'Tab Switch Violation',
          { durationSeconds },
        ));
        setTimeout(() => { violationCooldownRef.current = false; }, 500);
      }
    };

    // Window blur is a focus signal, not evidence of any particular app.
    // A 300 ms debounce avoids double-counting with visibilitychange
    let blurTimer: ReturnType<typeof setTimeout>;
    const handleBlur = () => {
      if (violationCooldownRef.current) return;
      blurTimer = setTimeout(() => {
        if (document.visibilityState === 'visible' && !violationCooldownRef.current && !focusLossEpisodeRef.current) {
          focusLossEpisodeRef.current = true;
          reportViolation(createViolationPayload(
            'SYSTEM_FOCUS_LOST',
            'Browser window focus changed',
            { focusState: 'window_blur' },
          ));
        }
      }, 300);
    };
    const handleFocus = () => {
      clearTimeout(blurTimer);
      focusLossEpisodeRef.current = false;
    };

    // Restricted keys
    const handleRestrictedKeys = (e: KeyboardEvent) => {
      let keyName = '';
      if (e.key === 'Meta' || e.key === 'OS') keyName = 'Windows/Meta key';
      else if (e.altKey && e.key === 'Tab')    keyName = 'Alt+Tab';
      else if (e.key === 'PrintScreen')         keyName = 'PrintScreen';
      else if (e.key === 'F12')                  keyName = 'F12 developer tools';
      else if ((e.ctrlKey || e.metaKey) && ['l', 't', 'n', 'w', 'r', 'u'].includes(e.key.toLowerCase())) {
        keyName = `${e.ctrlKey ? 'Ctrl' : 'Meta'}+${e.key.toUpperCase()}`;
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c', 'n'].includes(e.key.toLowerCase())) {
        keyName = `${e.ctrlKey ? 'Ctrl' : 'Meta'}+Shift+${e.key.toUpperCase()}`;
      }
      if (!keyName) return;
      e.preventDefault();
      reportViolation(createViolationPayload('RESTRICTED_KEY', 'Restricted Key Violation', { keyName }));
    };

    const handleClipboard = (event: ClipboardEvent) => {
      event.preventDefault();
      reportViolation(createViolationPayload('CLIPBOARD_ATTEMPT', 'Clipboard access blocked'));
    };

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      reportViolation(createViolationPayload('RESTRICTED_KEY', 'Right-click menu blocked', { keyName: 'Context menu' }));
    };

    const handleFullscreenChange = () => {
      if (document.fullscreenElement) {
        fullscreenEnteredRef.current = true;
        setSecureModeReady(true);
        viewportBaselineRef.current = {
          width: window.innerWidth,
          height: window.innerHeight,
          area: window.innerWidth * window.innerHeight,
        };
        return;
      }
      if (fullscreenEnteredRef.current && !submitting) {
        setSecureModeReady(false);
        reportViolation(createViolationPayload('FULLSCREEN_EXIT', 'Secure fullscreen exited'));
      }
    };

    let resizeTimer: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const baseline = viewportBaselineRef.current;
        const currentArea = window.innerWidth * window.innerHeight;
        const compactViewport =
          window.innerWidth < baseline.width * 0.85 ||
          window.innerHeight < baseline.height * 0.85 ||
          currentArea < baseline.area * 0.75 ||
          window.outerWidth < window.screen.availWidth * 0.82 ||
          window.outerHeight < window.screen.availHeight * 0.82;

        if (compactViewport && !resizeEpisodeRef.current) {
          resizeEpisodeRef.current = true;
          reportViolation(createViolationPayload(
            'WINDOW_RESIZE',
            'Suspicious small or side-by-side window detected',
            { focusState: 'viewport_compromised' },
          ));
        } else if (!compactViewport) {
          resizeEpisodeRef.current = false;
        }
      }, 600);
    };

    const handlePictureInPicture = () => {
      reportViolation(createViolationPayload('PICTURE_IN_PICTURE', 'Document Picture-in-Picture entered'));
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('keydown', handleRestrictedKeys);
    document.addEventListener('copy', handleClipboard);
    document.addEventListener('cut', handleClipboard);
    document.addEventListener('paste', handleClipboard);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('enterpictureinpicture', handlePictureInPicture as EventListener);
    window.addEventListener('resize', handleResize);

    if ((window.screen as Screen & { isExtended?: boolean }).isExtended) {
      reportViolation(createViolationPayload(
        'WINDOW_RESIZE',
        'Multiple-display environment detected',
        { focusState: 'extended_display' },
      ));
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('keydown', handleRestrictedKeys);
      document.removeEventListener('copy', handleClipboard);
      document.removeEventListener('cut', handleClipboard);
      document.removeEventListener('paste', handleClipboard);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('enterpictureinpicture', handlePictureInPicture as EventListener);
      window.removeEventListener('resize', handleResize);
      clearTimeout(blurTimer);
      clearTimeout(resizeTimer);
    };
  }, [createViolationPayload, reportViolation, submitting]);

  // Extensions cannot be reliably identified by a web page (and attempting
  // to do so causes false positives). We do record clear browser automation
  // signals, which a teacher can review alongside the other integrity events.
  useEffect(() => {
    const userAgent = navigator.userAgent;
    if (navigator.webdriver || /HeadlessChrome|PhantomJS|selenium/i.test(userAgent)) {
      reportViolation(createViolationPayload(
        'AUTOMATION_DETECTED',
        'Automated or modified browser environment detected',
        { focusState: 'automation_signal' },
      ));
    }
  }, [createViolationPayload, reportViolation]);

  // Disable text selection during quiz
  useEffect(() => {
    document.body.style.userSelect = 'none';
    (document.body.style as any).webkitUserSelect = 'none';
    return () => {
      document.body.style.userSelect = '';
      (document.body.style as any).webkitUserSelect = '';
    };
  }, []);

  // -----------------------------------------------------------------------
  // Teacher-code attempts are always recovered from the server. Session
  // storage only remembers the currently viewed question as a convenience;
  // it never supplies questions, answers, or a new timer.
  // -----------------------------------------------------------------------
  const updateServerClock = useCallback((serverNow?: string) => {
    const serverTime = serverNow ? Date.parse(serverNow) : Number.NaN;
    if (!Number.isNaN(serverTime)) setServerClockOffsetMs(serverTime - Date.now());
  }, []);

  const navigateToResults = useCallback(() => {
    if (!attemptId) return;
    submittingRef.current = true;
    setSubmitting(true);
    sessionStorage.removeItem('currentQuiz');
    sessionStorage.removeItem(`currentExamQuestion:${attemptId}`);
    navigate(`/quiz/teacher-results/${attemptId}`);
  }, [attemptId, navigate]);

  const setAnswerAt = useCallback((questionIndex: number, selectedAnswer: number | string) => {
    const next = { ...selectedAnswersRef.current, [questionIndex]: selectedAnswer };
    selectedAnswersRef.current = next;
    setSelectedAnswers(next);
  }, []);

  const persistAnswer = useCallback(async (pending: PendingAnswer): Promise<boolean> => {
    if (!attemptId) return false;

    const runWrite = async () => {
      setSavingQuestionId(pending.questionId);
      try {
        let response: any;
        let lastError: unknown;
        for (let retry = 0; retry < 3; retry += 1) {
          try {
            response = await api.post(`/quizzes/attempt/${attemptId}/answer`, {
              questionId: pending.questionId,
              selectedAnswer: pending.selectedAnswer,
            });
            break;
          } catch (error: any) {
            lastError = error;
            const status = error?.response?.status;
            if (status && status >= 400 && status < 500 && status !== 429) break;
            if (retry < 2) await new Promise(resolve => setTimeout(resolve, 250 * (retry + 1)));
          }
        }
        if (!response) throw lastError || new Error('Answer request failed');

        const result = response.data?.data || {};
        if (result.status && result.status !== 'in-progress') {
          navigateToResults();
          return;
        }
        if (result.expired) setTimeLeft(0);
        savedAnswersRef.current[pending.questionIndex] = pending.selectedAnswer;
        failedAnswersRef.current.delete(pending.questionId);
        setAnswerWriteError(failedAnswersRef.current.size ? 'Some answers have not been saved. Retry or reload the saved answers.' : null);
      } catch (error: any) {
        const message = apiErrorMessage(error, 'Your answer could not be saved. Retry before finishing the exam.');
        const isFinished = error?.response?.status === 409 && /already submitted|no longer active/i.test(message);
        if (isFinished) {
          navigateToResults();
          return;
        }
        failedAnswersRef.current.set(pending.questionId, pending);
        setAnswerWriteError(message);
        throw error;
      } finally {
        setSavingQuestionId(current => current === pending.questionId ? null : current);
      }
    };

    const task = answerWriteQueueRef.current
      .catch(() => undefined)
      .then(runWrite);
    answerWriteQueueRef.current = task.catch(() => undefined);
    try {
      await task;
      return true;
    } catch {
      return false;
    }
  }, [attemptId, navigateToResults]);

  const flushShortAnswer = useCallback(async (questionIndex = currentQuestionIndexRef.current) => {
    if (shortAnswerSaveRef.current) {
      clearTimeout(shortAnswerSaveRef.current);
      shortAnswerSaveRef.current = null;
    }
    const data = quizDataRef.current;
    const question = data?.quiz.questions[questionIndex];
    const selectedAnswer = selectedAnswersRef.current[questionIndex];
    if (!question || !isShortAnswerQuestion(question) || typeof selectedAnswer !== 'string'
      || savedAnswersRef.current[questionIndex] === selectedAnswer) {
      return true;
    }
    return persistAnswer({ questionId: question._id, questionIndex, selectedAnswer });
  }, [persistAnswer]);

  const flushPendingAnswerWrites = useCallback(async () => {
    const currentSaved = await flushShortAnswer();
    await answerWriteQueueRef.current;
    return currentSaved && failedAnswersRef.current.size === 0;
  }, [flushShortAnswer]);

  useEffect(() => {
    if (!attemptId) {
      navigate('/dashboard/student/join-quiz');
      return;
    }
    let cancelled = false;
    const loadAttempt = async () => {
      setLoadError(null);
      setQuizData(null);
      try {
        const response = await api.get(`/quizzes/attempt/${attemptId}/active`);
        const active = response.data?.data as ActiveTeacherAttempt | undefined;
        if (cancelled) return;
        if (!active?.attemptId || !active.status) throw new Error('Invalid exam response');
        if (active.status !== 'in-progress') {
          navigateToResults();
          return;
        }
        if (!active.quiz?.questions?.length) throw new Error('The exam has no usable questions');

        updateServerClock(active.serverNow);
        const restoredAnswers: Record<number, number | string> = {};
        active.quiz.questions.forEach((question, index) => {
          const saved = active.savedAnswers?.[question._id];
          if (saved !== undefined) restoredAnswers[index] = saved;
        });
        selectedAnswersRef.current = restoredAnswers;
        savedAnswersRef.current = { ...restoredAnswers };
        failedAnswersRef.current.clear();
        setAnswerWriteError(null);
        setSelectedAnswers(restoredAnswers);
        setQuestionDeadlines(active.questionStates || {});
        const storedIndex = Number(sessionStorage.getItem(`currentExamQuestion:${attemptId}`));
        const initialIndex = Number.isInteger(storedIndex) && storedIndex >= 0 && storedIndex < active.quiz.questions.length
          ? storedIndex
          : 0;
        currentQuestionIndexRef.current = initialIndex;
        setCurrentQuestionIndex(initialIndex);
        setQuizData({ attemptId: active.attemptId, quiz: active.quiz, code: '' });
      } catch (error: any) {
        if (!cancelled) setLoadError(apiErrorMessage(error, 'Could not load this exam. Please retry.'));
      }
    };
    void loadAttempt();
    return () => { cancelled = true; };
  }, [attemptId, loadRetry, navigate, navigateToResults, updateServerClock]);

  useEffect(() => {
    if (!quizData || !attemptId) return;
    sessionStorage.setItem(`currentExamQuestion:${attemptId}`, String(currentQuestionIndex));
  }, [attemptId, currentQuestionIndex, quizData]);

  const activeQuestion = quizData?.quiz.questions[currentQuestionIndex];
  const activeQuestionId = activeQuestion?._id;
  const activeDeadline = activeQuestionId ? questionDeadlines[activeQuestionId]?.deadlineAt : undefined;

  // Activating a question is idempotent. The server returns its original
  // deadline after a refresh, question switch, or second-tab request.
  useEffect(() => {
    if (!attemptId || !activeQuestionId || !quizData || !secureModeReady || submitting) return;
    let cancelled = false;
    const activate = async () => {
      setActivatingQuestion(true);
      setActivationError(null);
      try {
        const response = await api.post(`/quizzes/attempt/${attemptId}/activate`, { questionId: activeQuestionId });
        const result = response.data?.data;
        if (cancelled) return;
        updateServerClock(result?.serverNow);
        if (!result || result.status !== 'in-progress') {
          navigateToResults();
          return;
        }
        if (result.questionId !== activeQuestionId || typeof result.deadlineAt !== 'string') {
          throw new Error('The server did not return a valid question deadline.');
        }
        setQuestionDeadlines(current => ({
          ...current,
          [activeQuestionId]: { activatedAt: result.activatedAt, deadlineAt: result.deadlineAt },
        }));
      } catch (error: any) {
        if (!cancelled) setActivationError(apiErrorMessage(error, 'Could not activate this question. Retry to continue.'));
      } finally {
        if (!cancelled) setActivatingQuestion(false);
      }
    };
    void activate();
    return () => { cancelled = true; };
  }, [activeQuestionId, activationRetry, attemptId, navigateToResults, quizData, secureModeReady, submitting, updateServerClock]);

  // Derive elapsed time from the server deadline on every tick. A background
  // tab can delay this interval, but it cannot grant extra time on return.
  useEffect(() => {
    if (!activeDeadline) {
      setTimeLeft(0);
      return;
    }
    const updateRemaining = () => {
      const deadline = Date.parse(activeDeadline);
      const remaining = Number.isNaN(deadline)
        ? 0
        : Math.max(0, Math.ceil((deadline - (Date.now() + serverClockOffsetMs)) / 1000));
      setTimeLeft(remaining);
    };
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 500);
    return () => window.clearInterval(timer);
  }, [activeDeadline, serverClockOffsetMs]);

  const handleSubmitQuiz = useCallback(async (automatic = false) => {
    const data = quizDataRef.current;
    if (!data || !attemptId || submittingRef.current) return;

    submittingRef.current = true;
    setSubmitting(true);
    let completed = false;
    try {
      const currentSaved = await flushPendingAnswerWrites();
      if (!automatic && !currentSaved) {
        toast.error('Your latest answer could not be saved. Retry it before submitting.');
        return;
      }
      await api.post(`/quizzes/${attemptId}/submit-all`, { answers: [] });
      completed = true;
      toast.success(automatic ? 'Exam submitted because time expired.' : 'Exam submitted successfully!');
      navigateToResults();
    } catch (error: any) {
      const message = apiErrorMessage(error, 'Failed to submit exam. Please try again or contact your teacher.');
      if (error?.response?.status === 409 && /already submitted|no longer active/i.test(message)) {
        completed = true;
        navigateToResults();
        return;
      }
      toast.error(message);
    } finally {
      if (!completed) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  }, [attemptId, flushPendingAnswerWrites, navigateToResults]);

  const handleAutoNext = useCallback(async () => {
    const data = quizDataRef.current;
    const index = currentQuestionIndexRef.current;
    const question = data?.quiz.questions[index];
    const deadline = question ? questionDeadlines[question._id]?.deadlineAt : undefined;
    const deadlineKey = `${question?._id}:${deadline}`;
    if (!data || !question || !deadline || autoAdvancedDeadlineRef.current.has(deadlineKey) || submittingRef.current) return;
    autoAdvancedDeadlineRef.current.add(deadlineKey);

    // Flush a typed short response if possible, but a server deadline remains
    // authoritative and an unanswered short answer must never prevent timeout.
    await flushShortAnswer(index);
    if (index === data.quiz.questions.length - 1) {
      toast.error('Time is up for the last question. Submitting exam...', { duration: 3000 });
      await handleSubmitQuiz(true);
      return;
    }
    toast.error('Time is up. Moving to the next question.', { duration: 2000 });
    setCurrentQuestionIndex(index + 1);
  }, [flushShortAnswer, handleSubmitQuiz, questionDeadlines]);

  useEffect(() => {
    if (!activeQuestionId || !activeDeadline || activatingQuestion) return;
    const previous = previousTimerRef.current;
    // A revisit/refresh of an expired question stays at zero for review. Only
    // a visible countdown crossing the deadline automatically advances it.
    const expired = Date.parse(activeDeadline) <= Date.now() + serverClockOffsetMs;
    if (expired && previous?.questionId === activeQuestionId && previous.remaining > 0 && timeLeft === 0) {
      void handleAutoNext();
    }
    previousTimerRef.current = { questionId: activeQuestionId, remaining: expired ? 0 : timeLeft };
  }, [activeDeadline, activeQuestionId, activatingQuestion, handleAutoNext, serverClockOffsetMs, timeLeft]);

  const handleSelectAnswer = (questionIndex: number, optionIndex: number) => {
    const question = quizDataRef.current?.quiz.questions[questionIndex];
    if (!question || submittingRef.current || timeLeft === 0 || activatingQuestion) return;
    setAnswerAt(questionIndex, optionIndex);
    void persistAnswer({ questionId: question._id, questionIndex, selectedAnswer: optionIndex });
  };

  const handleTextAnswer = (questionIndex: number, value: string) => {
    const question = quizDataRef.current?.quiz.questions[questionIndex];
    if (!question || submittingRef.current || timeLeft === 0 || activatingQuestion) return;
    setAnswerAt(questionIndex, value);
    if (shortAnswerSaveRef.current) clearTimeout(shortAnswerSaveRef.current);
    shortAnswerSaveRef.current = setTimeout(() => {
      void flushShortAnswer(questionIndex);
    }, 500);
  };

  const moveToQuestion = useCallback(async (targetIndex: number) => {
    const data = quizDataRef.current;
    if (!data || submittingRef.current || activatingQuestion) return;
    const nextIndex = Math.min(data.quiz.questions.length - 1, Math.max(0, targetIndex));
    if (nextIndex === currentQuestionIndexRef.current) return;
    await flushShortAnswer(currentQuestionIndexRef.current);
    setCurrentQuestionIndex(nextIndex);
  }, [activatingQuestion, flushShortAnswer]);

  const handleNextQuestion = () => {
    void moveToQuestion(currentQuestionIndexRef.current + 1);
  };

  const handleJumpToQuestion = (targetIndex: number) => {
    void moveToQuestion(targetIndex);
  };

  const retryFailedAnswer = () => {
    for (const failed of failedAnswersRef.current.values()) {
      void persistAnswer({ ...failed, selectedAnswer: selectedAnswersRef.current[failed.questionIndex] ?? failed.selectedAnswer });
    }
  };

  const handleFaceViolation = useCallback((kind: 'face_away' | 'no_face') => {
    void reportViolation(createViolationPayload(
      kind === 'face_away' ? 'FACE_AWAY' : 'NO_FACE',
      kind === 'face_away' ? 'Face Away Violation' : 'No Face Detected Violation',
    ));
  }, [createViolationPayload, reportViolation]);

  const handleFaceAutoSubmit = useCallback(async () => {
    if (faceAutoSubmitRef.current || submittingRef.current) return;
    faceAutoSubmitRef.current = true;
    toast.error('Exam auto-submitted: You looked away for more than 60 seconds.', { duration: 5000 });
    await handleSubmitQuiz(true);
    if (!submittingRef.current) faceAutoSubmitRef.current = false;
  }, [handleSubmitQuiz]);

  if (!quizData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-lg p-6">
          {loadError ? <>
            <p role="alert" className="text-red-700">{loadError}</p>
            <button type="button" onClick={() => setLoadRetry(value => value + 1)} className="mt-4 rounded bg-indigo-600 px-4 py-2 text-white focus-visible:ring-4">Retry loading exam</button>
          </> : <>
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500 mx-auto" />
            <p className="mt-4 text-gray-600 text-sm">Loading exam...</p>
          </>}
        </div>
      </div>
    );
  }

  const currentQuestion = quizData.quiz.questions[currentQuestionIndex];
  const totalQuestions  = quizData.quiz.questions.length;
  const answeredCount   = Object.values(selectedAnswers).filter(answer => typeof answer === 'number' ? answer >= 0 : answer.trim().length > 0).length;
  const canAnswer = !submitting && !activatingQuestion && !activationError && secureModeReady
    && !!activeDeadline && Date.parse(activeDeadline) > Date.now() + serverClockOffsetMs && timeLeft > 0;

  return (
    <div className="min-h-screen bg-gray-50 select-none">
      {!secureModeReady && typeof document.documentElement.requestFullscreen === 'function' && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-xl">
          <div role="dialog" aria-modal="true" aria-labelledby="secure-mode-title" className="w-full max-w-md rounded-3xl border border-white/15 bg-white p-8 text-center shadow-2xl">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              <ShieldCheckIcon className="h-9 w-9" />
            </div>
            <h2 id="secure-mode-title" className="mt-5 text-2xl font-bold text-slate-950">Secure exam mode required</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Continue in fullscreen. Exiting fullscreen, opening system overlays, shrinking the window, or using another app is recorded as a violation.
            </p>
            <button type="button" onClick={enterSecureMode} className="mt-6 w-full rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white shadow-lg transition hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-200">
              Enter secure fullscreen
            </button>
          </div>
        </div>
      )}

      {/* Face Detection Camera — only when the teacher enabled monitoring for this quiz */}
      {quizData?.quiz.cameraMonitoring !== false && (
        <Suspense fallback={null}>
          <FaceDetectionCamera
            enabled
            onViolation={handleFaceViolation}
            onAutoSubmit={handleFaceAutoSubmit}
          />
        </Suspense>
      )}

      {/* Violation Warning Banner */}
      {showWarning && (
        <div className="fixed top-0 left-0 right-0 bg-red-500 text-white py-3 px-4 z-50 flex items-center justify-center gap-2 animate-pulse">
          <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0" />
          <span className="font-medium">{warningMessage}</span>
        </div>
      )}
      {violationWriteError && (
        <div className="fixed top-14 left-0 right-0 bg-amber-600 text-white py-2 px-4 z-50 text-center text-sm">
          {violationWriteError}
        </div>
      )}

      {/* Header */}
      <div className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-gray-900">{quizData.quiz.title}</h1>
              <p className="text-sm text-gray-500">
                Question {currentQuestionIndex + 1} of {totalQuestions}
              </p>
            </div>
            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
              timeLeft < 10 ? 'bg-red-100 text-red-700 animate-pulse' : 'bg-indigo-100 text-indigo-700'
            }`}>
              <ClockIcon className="h-5 w-5" />
              <span className="font-mono font-bold text-lg">{formatTime(timeLeft)}</span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-4 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-600 transition-all duration-300"
              style={{ width: `${((currentQuestionIndex + 1) / totalQuestions) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Question Card */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {activationError && <div role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-4 text-red-800">
          <p>{activationError}</p>
          <button type="button" onClick={() => setActivationRetry(value => value + 1)} className="mt-2 underline focus-visible:ring-2">Retry question activation</button>
        </div>}
        {answerWriteError && <div role="alert" className="mb-4 rounded border border-amber-300 bg-amber-50 p-4 text-amber-900">
          <p>{answerWriteError} Expired answers cannot be changed; only saved answers will be graded.</p>
          <button type="button" disabled={!!savingQuestionId || submitting} onClick={retryFailedAnswer} className="mt-2 mr-4 underline focus-visible:ring-2 disabled:opacity-50">Retry unsaved answers</button>
          <button type="button" disabled={!!savingQuestionId || submitting} onClick={() => setLoadRetry(value => value + 1)} className="mt-2 underline focus-visible:ring-2 disabled:opacity-50">Discard unsaved edits and reload</button>
        </div>}
        <p role="status" className="mb-3 text-sm text-gray-700">
          {activatingQuestion ? 'Loading the original question deadline…' : savingQuestionId ? 'Saving answer…' : activeDeadline && timeLeft === 0 ? 'This question has expired. Its saved answer is locked.' : 'Answers are saved to the server as you answer.'}
        </p>
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="mb-6">
            <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
              currentQuestion.difficulty === 'Easy'   ? 'bg-green-100 text-green-700'  :
              currentQuestion.difficulty === 'Medium' ? 'bg-yellow-100 text-yellow-700':
                                                        'bg-red-100 text-red-700'
            }`}>
              {currentQuestion.difficulty}
            </span>
          </div>

          <h2 className="text-xl font-medium text-gray-900 mb-6">
            {currentQuestion.text}
          </h2>

          {isShortAnswerQuestion(currentQuestion) ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Your Answer</label>
              <textarea
                disabled={!canAnswer}
                value={String(selectedAnswers[currentQuestionIndex] ?? '')}
                onChange={e => handleTextAnswer(currentQuestionIndex, e.target.value)}
                rows={4}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="Type your answer here"
              />
            </div>
          ) : (
            <div className="space-y-3">
              {currentQuestion.options.map((option, index) => (
                <button
                  key={index}
                  disabled={!canAnswer}
                  onClick={() => handleSelectAnswer(currentQuestionIndex, index)}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                    selectedAnswers[currentQuestionIndex] === index
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                      selectedAnswers[currentQuestionIndex] === index
                        ? 'bg-indigo-500 text-white'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {String.fromCharCode(65 + index)}
                    </span>
                    <span className="text-gray-900">{option}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Proctoring notice */}
        <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
          <ExclamationTriangleIcon className="h-4 w-4 inline mr-1" />
          This exam is monitored. All violations are recorded and shared with your teacher.
        </div>

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={() => void moveToQuestion(currentQuestionIndex - 1)}
            disabled={currentQuestionIndex === 0 || submitting || activatingQuestion}
            className="px-4 py-2 text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>

          {/* Question jump dots */}
          <div className="flex items-center gap-2 flex-wrap justify-center">
            {quizData.quiz.questions.map((_, index) => (
              <button
                key={index}
                disabled={submitting || activatingQuestion}
                onClick={() => handleJumpToQuestion(index)}
                className={`w-8 h-8 rounded-full text-sm font-medium transition-all ${
                  index === currentQuestionIndex
                    ? 'bg-indigo-600 text-white'
                    : selectedAnswers[index] !== undefined
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {index + 1}
              </button>
            ))}
          </div>

          {currentQuestionIndex === totalQuestions - 1 ? (
            <button
              onClick={() => void handleSubmitQuiz()}
              disabled={submitting}
              className="px-6 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                  Submitting...
                </>
              ) : (
                <>
                  <CheckCircleIcon className="h-5 w-5" />
                  Submit ({answeredCount}/{totalQuestions})
                </>
              )}
            </button>
          ) : (
            <button
              onClick={handleNextQuestion}
              disabled={submitting || activatingQuestion}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuizTakePage;
