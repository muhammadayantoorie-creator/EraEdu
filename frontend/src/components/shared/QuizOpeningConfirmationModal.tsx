import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AcademicCapIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ClockIcon,
  EyeIcon,
  PencilSquareIcon,
  ShieldCheckIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

export interface QuizOpeningDetails {
  title: string;
  course?: string;
  className?: string;
  section?: string;
  questionCount: number;
  totalMarks?: number;
  timeLimit?: number;
  passingPercentage?: number;
  attemptsAllowed?: number;
  startTime?: string;
  endTime?: string;
  shuffleQuestions?: boolean;
  randomOptions?: boolean;
  negativeMarking?: boolean;
  aiGenerated?: boolean;
  status?: 'Draft' | 'Scheduled' | 'Published' | string;
  violationLimit?: number;
  questions?: Array<{ text: string; options?: string[]; correctAnswer?: number }>;
}

interface Props {
  isOpen: boolean;
  quiz: QuizOpeningDetails | null;
  onClose: () => void;
  onEdit: () => void;
  onOpen: () => void;
}

const warnings = [
  'Verify every question carefully.',
  'Verify every option.',
  'Ensure the correct answers are marked.',
  'Check quiz duration.',
  'Verify marks distribution.',
  'Ensure the correct class and section are selected.',
  'Review scheduling settings.',
  'Confirm anti-cheating settings.',
  'Confirm browser security settings.',
  'Confirm AI-generated questions if applicable.',
];

const formatDate = (value?: string) => {
  if (!value) return 'Not configured';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not configured' : date.toLocaleString();
};

const boolLabel = (value?: boolean, positive = 'Enabled', negative = 'Disabled') =>
  value === undefined ? 'Not configured' : value ? positive : negative;

const QuizOpeningConfirmationModal = ({ isOpen, quiz, onClose, onEdit, onOpen }: Props) => {
  const [confirmed, setConfirmed] = useState(false);
  const [showQuestions, setShowQuestions] = useState(false);
  const [showFinalConfirmation, setShowFinalConfirmation] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [preparationStep, setPreparationStep] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    previousFocus.current = document.activeElement as HTMLElement;
    setConfirmed(false);
    setShowQuestions(false);
    setShowFinalConfirmation(false);
    setIsPreparing(false);
    setPreparationStep(0);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => closeButtonRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      previousFocus.current?.focus();
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (showFinalConfirmation) requestAnimationFrame(() => continueButtonRef.current?.focus());
  }, [showFinalConfirmation]);

  useEffect(() => {
    if (!isPreparing) return;
    const timers = [0, 1, 2, 3, 4].map((step) => window.setTimeout(() => setPreparationStep(step + 1), 450 + step * 520));
    const openTimer = window.setTimeout(onOpen, 450 + 5 * 520 + 350);
    return () => {
      timers.forEach(window.clearTimeout);
      window.clearTimeout(openTimer);
    };
  }, [isPreparing, onOpen]);

  const handleOpen = () => {
    if (confirmed) setShowFinalConfirmation(true);
  };

  const facts = quiz ? [
    ['Quiz title', quiz.title],
    ['Course', quiz.course || 'General'],
    ['Class', quiz.className || 'Not configured'],
    ['Section', quiz.section || 'Not configured'],
    ['Number of questions', String(quiz.questionCount)],
    ['Marks', quiz.totalMarks === undefined ? 'Not configured' : String(quiz.totalMarks)],
    ['Time limit', quiz.timeLimit ? `${quiz.timeLimit} minutes` : 'Not configured'],
    ['Passing percentage', quiz.passingPercentage === undefined ? 'Not configured' : `${quiz.passingPercentage}%`],
    ['Attempts allowed', quiz.attemptsAllowed === undefined ? 'Not configured' : String(quiz.attemptsAllowed)],
    ['Violation limit', quiz.violationLimit === undefined ? '3 violations' : `${quiz.violationLimit} violations`],
    ['Shuffle questions', boolLabel(quiz.shuffleQuestions)],
    ['Random options', boolLabel(quiz.randomOptions)],
    ['Negative marking', boolLabel(quiz.negativeMarking, 'Yes', 'No')],
    ['AI generated', boolLabel(quiz.aiGenerated, 'Yes', 'No')],
    ['Status', quiz.status || 'Draft'],
  ] : [];

  return (
    <AnimatePresence>
      {isOpen && quiz && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.button
            type="button"
            aria-label="Close quiz confirmation"
            className="absolute inset-0 cursor-default bg-slate-950/60 backdrop-blur-md"
            onClick={onClose}
          />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="quiz-preview-title"
            aria-describedby={isPreparing ? 'quiz-preparing-status' : showFinalConfirmation ? 'final-confirmation-warning' : 'quiz-preview-warning'}
            initial={{ opacity: 0, scale: 0.94, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="quiz-opening-modal relative flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/30 bg-white/90 shadow-[0_32px_100px_-20px_rgba(2,6,23,0.65)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/90"
          >
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-cyan-400 via-indigo-500 to-violet-500" />
            <header className="flex items-start justify-between border-b border-slate-200/70 px-5 py-5 sm:px-7 dark:border-white/10">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/25">
                  <AcademicCapIcon className="h-7 w-7" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-300">{isPreparing ? 'Secure launch' : showFinalConfirmation ? 'Final checkpoint' : 'Pre-launch review'}</p>
                  <h2 id="quiz-preview-title" className="mt-1 text-xl font-bold text-slate-950 sm:text-2xl dark:text-white">{isPreparing ? 'Preparing Quiz...' : showFinalConfirmation ? 'Final Confirmation' : 'Quiz Preview'}</h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{isPreparing ? 'Please wait while EraEdu completes its launch checks.' : showFinalConfirmation ? 'You are about to open this quiz.' : 'Review the assessment before opening it.'}</p>
                </div>
              </div>
              <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close dialog" className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:hover:bg-white/10 dark:hover:text-white">
                <XMarkIcon className="h-6 w-6" />
              </button>
            </header>

            {isPreparing ? (
              <motion.div
                key="preparing"
                id="quiz-preparing-status"
                role="status"
                aria-live="polite"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex min-h-[390px] items-center justify-center overflow-y-auto px-5 py-8 sm:px-7"
              >
                <section className="w-full max-w-xl rounded-3xl border border-indigo-200/70 bg-gradient-to-br from-indigo-50/90 via-white/80 to-cyan-50/80 p-6 shadow-inner sm:p-8 dark:border-indigo-400/20 dark:from-indigo-400/[0.10] dark:via-white/[0.04] dark:to-cyan-400/[0.06]">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-xl shadow-indigo-500/25">
                    {preparationStep >= 5 ? <CheckCircleIcon className="h-9 w-9" /> : <SparklesIcon className="h-8 w-8 animate-pulse" />}
                  </div>
                  <h3 className="mt-5 text-center text-xl font-bold text-slate-950 dark:text-white">Preparing Quiz...</h3>
                  <div className="mt-6 space-y-3">
                    {[
                      'Loading Questions',
                      'Verifying Configuration',
                      'Initializing Security',
                      'Loading Student Rules',
                      'Ready',
                    ].map((label, index) => {
                      const complete = preparationStep > index;
                      const active = preparationStep === index;
                      return (
                        <motion.div
                          key={label}
                          initial={{ opacity: 0.45 }}
                          animate={{ opacity: complete || active ? 1 : 0.45 }}
                          className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${complete ? 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-400/20 dark:bg-emerald-400/[0.08]' : active ? 'border-indigo-200 bg-indigo-50 dark:border-indigo-400/20 dark:bg-indigo-400/[0.08]' : 'border-slate-200 bg-white/50 dark:border-white/10 dark:bg-white/[0.03]'}`}
                        >
                          {complete ? (
                            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white"><CheckCircleIcon className="h-4 w-4" /></motion.span>
                          ) : active ? (
                            <span className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" aria-hidden="true" />
                          ) : (
                            <span className="h-5 w-5 rounded-full border-2 border-slate-300 dark:border-slate-600" aria-hidden="true" />
                          )}
                          <span className={`text-sm font-semibold ${complete ? 'text-emerald-900 dark:text-emerald-100' : 'text-slate-700 dark:text-slate-200'}`}>{label}</span>
                        </motion.div>
                      );
                    })}
                  </div>
                  <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                    <motion.div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500" animate={{ width: `${(preparationStep / 5) * 100}%` }} transition={{ duration: 0.35 }} />
                  </div>
                </section>
              </motion.div>
            ) : showFinalConfirmation ? (
              <motion.div
                key="final-confirmation"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                className="overflow-y-auto px-5 py-6 sm:px-7 sm:py-8"
              >
                <section className="mx-auto max-w-2xl rounded-3xl border border-amber-300/70 bg-gradient-to-br from-amber-50/95 to-orange-50/80 p-5 shadow-inner sm:p-7 dark:border-amber-400/20 dark:from-amber-400/[0.10] dark:to-orange-400/[0.05]">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-lg shadow-amber-500/25" aria-hidden="true">
                      <ShieldCheckIcon className="h-7 w-7" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-amber-950 dark:text-amber-100">You are about to open this quiz.</h3>
                      <p className="mt-1 text-sm text-amber-900/70 dark:text-amber-100/70">Please ensure:</p>
                    </div>
                  </div>

                  <ul className="mt-6 grid gap-3 sm:grid-cols-2" aria-label="Final quiz checks">
                    {[
                      'Questions are correct',
                      'Answers are correct',
                      'Time limit is correct',
                      'Students are assigned correctly',
                      'Anti-cheating is enabled',
                      'Browser security is enabled',
                    ].map((item) => (
                      <li key={item} className="flex items-center gap-3 rounded-xl border border-amber-200/80 bg-white/65 px-4 py-3 text-sm font-medium text-slate-800 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-100">
                        <CheckCircleIcon className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                        {item}
                      </li>
                    ))}
                  </ul>

                  <div id="final-confirmation-warning" className="mt-6 rounded-2xl border border-rose-200 bg-rose-50/80 p-4 dark:border-rose-400/20 dark:bg-rose-400/[0.08]">
                    <p className="text-sm font-semibold leading-6 text-rose-900 dark:text-rose-100">Once students begin the quiz, editing may affect their results.</p>
                  </div>
                  <p className="mt-6 text-center text-base font-bold text-slate-950 dark:text-white">Are you sure you want to continue?</p>
                </section>
              </motion.div>
            ) : (
            <div className="overflow-y-auto px-5 py-5 sm:px-7">
              <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
                <section aria-label="Quiz details" className="rounded-2xl border border-slate-200/80 bg-white/55 p-4 sm:p-5 dark:border-white/10 dark:bg-white/[0.04]">
                  <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                    {facts.map(([label, value]) => (
                      <div key={label} className="flex items-start justify-between gap-4 border-b border-slate-200/70 py-3 last:border-0 sm:block dark:border-white/10">
                        <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</dt>
                        <dd className="mt-0.5 text-right text-sm font-semibold text-slate-900 sm:text-left dark:text-slate-100">{value}</dd>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 grid gap-3 rounded-2xl bg-slate-100/80 p-4 sm:grid-cols-2 dark:bg-slate-900/80">
                    <div className="flex gap-3"><ClockIcon className="h-5 w-5 shrink-0 text-emerald-600" /><div><p className="text-xs text-slate-500 dark:text-slate-400">Start time</p><p className="text-sm font-medium text-slate-900 dark:text-white">{formatDate(quiz.startTime)}</p></div></div>
                    <div className="flex gap-3"><ClockIcon className="h-5 w-5 shrink-0 text-rose-500" /><div><p className="text-xs text-slate-500 dark:text-slate-400">End time</p><p className="text-sm font-medium text-slate-900 dark:text-white">{formatDate(quiz.endTime)}</p></div></div>
                  </div>
                </section>

                <section id="quiz-preview-warning" className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
                  <div className="flex items-center gap-3"><ShieldCheckIcon className="h-6 w-6 text-amber-700" /><h3 className="text-base font-bold text-amber-950">Before Opening</h3></div>
                  <ul className="mt-4 space-y-2.5">
                    {warnings.map((warning) => <li key={warning} className="flex gap-2 text-sm leading-5 text-amber-950"><CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />{warning}</li>)}
                  </ul>
                </section>
              </div>

              <AnimatePresence initial={false}>
                {showQuestions && (
                  <motion.section initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div className="mt-5 rounded-2xl border border-slate-200 bg-white/60 p-5 dark:border-white/10 dark:bg-white/[0.04]">
                      <h3 className="font-bold text-slate-900 dark:text-white">Question preview</h3>
                      <div className="mt-3 max-h-56 space-y-3 overflow-y-auto pr-2">
                        {(quiz.questions || []).map((question, index) => <div key={index} className="rounded-xl bg-slate-100/80 p-3 dark:bg-slate-900/80"><p className="text-sm font-semibold text-slate-900 dark:text-white">{index + 1}. {question.text}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{question.options?.length || 0} options · Correct answer {question.correctAnswer === undefined ? 'not set' : `option ${question.correctAnswer + 1}`}</p></div>)}
                      </div>
                    </div>
                  </motion.section>
                )}
              </AnimatePresence>

              <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 transition hover:border-indigo-300 dark:border-indigo-400/20 dark:bg-indigo-400/[0.08]">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" aria-describedby="confirmation-help" />
                <span><span className="block text-sm font-semibold text-slate-900 dark:text-white">I have reviewed this quiz and confirm it is ready.</span><span id="confirmation-help" className="mt-1 block text-xs text-slate-500 dark:text-slate-400">Required before the quiz can be opened.</span></span>
              </label>
            </div>
            )}

            {!isPreparing && <footer className="quiz-opening-footer flex flex-col-reverse gap-3 border-t border-slate-200/70 bg-white/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7 dark:border-white/10 dark:bg-white/[0.03]">
              {showFinalConfirmation ? (
                <>
                  <button type="button" onClick={() => setShowFinalConfirmation(false)} className="quiz-secondary-action rounded-xl px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-200/70 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-slate-300 dark:hover:bg-white/10">Go Back</button>
                  <button ref={continueButtonRef} type="button" onClick={() => setIsPreparing(true)} className="quiz-primary-action inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/20 transition hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">Continue<ArrowRightIcon className="h-4 w-4" /></button>
                </>
              ) : (
              <>
                <button type="button" onClick={onClose} className="quiz-secondary-action rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-200/70 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-slate-300 dark:hover:bg-white/10">Cancel</button>
                <div className="grid grid-cols-1 gap-2 sm:flex">
                <button type="button" onClick={onEdit} className="quiz-secondary-action inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white/70 px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-white/15 dark:bg-white/[0.06] dark:text-white"><PencilSquareIcon className="h-4 w-4" />Edit Quiz</button>
                <button type="button" onClick={() => setShowQuestions((value) => !value)} aria-expanded={showQuestions} className="quiz-secondary-action inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white/70 px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-white/15 dark:bg-white/[0.06] dark:text-white"><EyeIcon className="h-4 w-4" />{showQuestions ? 'Hide Preview' : 'Preview Quiz'}</button>
                <button type="button" onClick={handleOpen} disabled={!confirmed} aria-disabled={!confirmed} className="quiz-primary-action inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/20 transition hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:text-slate-500 disabled:shadow-none disabled:hover:translate-y-0 dark:disabled:from-slate-800 dark:disabled:to-slate-800 dark:disabled:text-slate-500"><SparklesIcon className="h-4 w-4" />Open Quiz<ArrowRightIcon className="h-4 w-4" /></button>
                </div>
              </>
              )}
            </footer>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default QuizOpeningConfirmationModal;
