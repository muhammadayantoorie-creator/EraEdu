import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircleIcon, SparklesIcon, XMarkIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';

interface Props { attemptId?: string; }
type Category = 'overall' | 'content' | 'usability' | 'performance' | 'security';
const recommendationOptions: Array<{ value: boolean; label: string }> = [
  { value: true, label: 'Yes' },
  { value: false, label: 'Not yet' },
];
const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700';
const schemaMessage = 'Student feedback storage is unavailable. An administrator must apply or reconcile backend/migrations/009_add_student_feedback.sql.';

const PostQuizFeedbackModal = ({ attemptId }: Props) => {
  const { user } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [category, setCategory] = useState<Category>('overall');
  const [liked, setLiked] = useState('');
  const [improvements, setImprovements] = useState('');
  const [wouldRecommend, setWouldRecommend] = useState<boolean | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const firstStarRef = useRef<HTMLButtonElement>(null);
  const improvementsRef = useRef<HTMLTextAreaElement>(null);
  const submitLock = useRef(false);
  const storageKey = attemptId && user?._id ? `eraedu-feedback-submitted:${user._id}:${attemptId}` : null;

  useEffect(() => {
    setOpen(false);
    setRating(0);
    setCategory('overall');
    setLiked('');
    setImprovements('');
    setWouldRecommend(undefined);
    setAlreadySubmitted(false);
    setFormError(null);
    if (!attemptId || user?.role !== 'student') return;
    try {
      if ((storageKey && localStorage.getItem(storageKey)) || localStorage.getItem(`eraedu-feedback-submitted:${attemptId}`)) return;
    } catch { /* Private browsing may disable storage; the database uniqueness guard still applies. */ }
    const timer = window.setTimeout(() => setOpen(true), 700);
    return () => window.clearTimeout(timer);
  }, [attemptId, user?._id, user?.role, storageKey]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), select, textarea') || []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !modalRef.current?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !modalRef.current?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, [open]);

  const rememberSubmission = () => {
    try { if (storageKey) localStorage.setItem(storageKey, 'true'); }
    catch { /* Successful server persistence is authoritative. */ }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitLock.current || alreadySubmitted) return;
    if (!attemptId || rating === 0) { setFormError('Please select a rating from 1 to 5.'); firstStarRef.current?.focus(); return; }
    if (improvements.trim().length < 5) { setFormError('Please enter at least 5 characters about what we can improve.'); improvementsRef.current?.focus(); return; }
    submitLock.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post('/feedback', { attemptId, rating, category, liked, improvements, wouldRecommend });
      rememberSubmission();
      toast.success('Thank you—your feedback was sent privately to the EraEdu admins.');
      setOpen(false);
    } catch (error: any) {
      const status = error.response?.status;
      const payload = error.response?.data?.error;
      const message = typeof payload?.message === 'string' ? payload.message : '';
      if (status === 409 && message === 'Feedback has already been submitted for this attempt') {
        rememberSubmission();
        setAlreadySubmitted(true);
        setFormError('Feedback has already been submitted for this exam. No second response was saved.');
      } else if (status === 400 && Array.isArray(payload?.fields) && payload.fields.length) {
        setFormError(`${payload.fields[0].field}: ${payload.fields[0].message}`);
      } else if (status === 400 || status === 403 || status === 404 || status === 409) {
        setFormError(message || 'This exam cannot accept feedback.');
      } else if (status === 503 && message === schemaMessage) {
        setFormError(message);
      } else {
        setFormError('Feedback could not be sent right now. Your entries are still here; please retry.');
      }
    } finally { submitLock.current = false; setSubmitting(false); }
  };

  return <AnimatePresence>{open && <motion.div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <div aria-hidden="true" className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
    <motion.div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="feedback-title" aria-describedby="feedback-description" initial={{ opacity: 0, y: 24, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: .97 }} className="relative max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-ink-900/10 bg-white p-5 text-ink-900 shadow-[0_30px_100px_-20px_rgba(5,7,11,.65)] sm:rounded-[2rem] sm:p-8">
      <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label="Close feedback form" className={`absolute right-4 top-4 rounded-full p-2 text-ink-700 transition hover:bg-ink-100 ${focusRing}`}><XMarkIcon className="h-5 w-5" /></button>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-700 text-white"><SparklesIcon className="h-6 w-6" /></div>
      <h2 id="feedback-title" className="mt-5 pr-8 font-display text-2xl text-ink-950">Rate your EraEdu experience</h2>
      <p id="feedback-description" className="mt-2 text-sm leading-6 text-ink-700">Your feedback is private and visible only to platform administrators—not your teacher.</p>
      <form onSubmit={submit} className="mt-6 space-y-5" noValidate>
        {formError && <p id="feedback-error" role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800">{formError}</p>}
        <fieldset><legend className="text-sm font-semibold text-ink-900">How was your exam experience?</legend><div className="mt-2 flex flex-wrap gap-2">{[1, 2, 3, 4, 5].map(value => <button key={value} ref={value === 1 ? firstStarRef : undefined} type="button" onClick={() => { setRating(value); setFormError(null); }} aria-label={`${value} star${value > 1 ? 's' : ''} out of five`} aria-pressed={rating === value} className={`flex h-11 w-11 items-center justify-center rounded-xl text-xl transition ${focusRing} ${rating >= value ? 'bg-amber-400 text-ink-950 shadow-sm' : 'bg-amber-50 text-amber-800 ring-1 ring-amber-300'}`}>★</button>)}</div></fieldset>
        <label className="block"><span className="text-sm font-semibold text-ink-900">What should we improve?</span><select value={category} onChange={event => { setCategory(event.target.value as Category); setFormError(null); }} className={`input-field mt-2 ${focusRing}`}><option value="overall">Overall experience</option><option value="content">Questions and content</option><option value="usability">Ease of use</option><option value="performance">Speed and reliability</option><option value="security">Camera and exam security</option></select></label>
        <label className="block"><span className="text-sm font-semibold text-ink-900">What worked well? <span className="font-normal text-ink-600">Optional</span></span><textarea value={liked} onChange={event => { setLiked(event.target.value); setFormError(null); }} maxLength={1000} rows={2} className={`input-field mt-2 resize-y ${focusRing}`} placeholder="Tell us what you liked..." /></label>
        <label className="block"><span className="text-sm font-semibold text-ink-900">How can we improve?</span><textarea ref={improvementsRef} required value={improvements} onChange={event => { setImprovements(event.target.value); setFormError(null); }} minLength={5} maxLength={2000} rows={4} className={`input-field mt-2 resize-y ${focusRing}`} placeholder="Share a specific suggestion or problem..." /></label>
        <fieldset><legend className="text-sm font-semibold text-ink-900">Would you recommend EraEdu?</legend><div className="mt-2 flex flex-wrap gap-2">{recommendationOptions.map(({ value, label }) => <button key={label} type="button" aria-pressed={wouldRecommend === value} onClick={() => { setWouldRecommend(value); setFormError(null); }} className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${focusRing} ${wouldRecommend === value ? 'bg-primary-700 text-white' : 'bg-ink-50 text-ink-800 ring-1 ring-ink-900/15'}`}>{label}</button>)}</div></fieldset>
        <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setOpen(false)} className={`rounded-xl px-5 py-2.5 text-sm font-semibold text-ink-800 transition hover:bg-ink-50 ${focusRing}`}>Not now</button><button disabled={submitting || alreadySubmitted} type="submit" className={`inline-flex items-center justify-center gap-2 rounded-xl bg-primary-700 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-primary-800 disabled:opacity-50 ${focusRing}`}><CheckCircleIcon className="h-5 w-5" />{submitting ? 'Sending...' : alreadySubmitted ? 'Already submitted' : 'Send feedback'}</button></div>
      </form>
    </motion.div>
  </motion.div>}</AnimatePresence>;
};

export default PostQuizFeedbackModal;
