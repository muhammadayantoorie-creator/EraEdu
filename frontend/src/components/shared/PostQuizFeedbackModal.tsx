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

const PostQuizFeedbackModal = ({ attemptId }: Props) => {
  const { user } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [category, setCategory] = useState<Category>('overall');
  const [liked, setLiked] = useState('');
  const [improvements, setImprovements] = useState('');
  const [wouldRecommend, setWouldRecommend] = useState<boolean | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!attemptId || user?.role !== 'student') return;
    if (localStorage.getItem(`eraedu-feedback-submitted:${attemptId}`)) return;
    const timer = window.setTimeout(() => setOpen(true), 700);
    return () => window.clearTimeout(timer);
  }, [attemptId, user?.role]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!attemptId || rating === 0) return toast.error('Please select a rating.');
    if (improvements.trim().length < 5) return toast.error('Please tell us briefly how we can improve.');
    setSubmitting(true);
    try {
      await api.post('/feedback', { attemptId, rating, category, liked, improvements, wouldRecommend });
      localStorage.setItem(`eraedu-feedback-submitted:${attemptId}`, 'true');
      toast.success('Thank you—your feedback was sent privately to the EraEdu admins.');
      setOpen(false);
    } catch (error: any) {
      const message = error.response?.data?.error?.message || 'Unable to send feedback. Please try again.';
      if (error.response?.status === 409) localStorage.setItem(`eraedu-feedback-submitted:${attemptId}`, 'true');
      toast.error(message);
    } finally { setSubmitting(false); }
  };

  return <AnimatePresence>{open && <motion.div className="fixed inset-0 z-[120] flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <button type="button" aria-label="Close feedback form" className="absolute inset-0 bg-ink-950/60 backdrop-blur-md" onClick={() => setOpen(false)} />
    <motion.div role="dialog" aria-modal="true" aria-labelledby="feedback-title" initial={{ opacity: 0, y: 24, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: .97 }} className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[2rem] border border-white/30 bg-white/95 p-6 shadow-[0_30px_100px_-20px_rgba(5,7,11,.65)] backdrop-blur-2xl sm:p-8 dark:border-white/10 dark:bg-ink-950/95">
      <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label="Close" className="absolute right-5 top-5 rounded-full p-2 text-ink-400 transition hover:bg-ink-100 hover:text-ink-900 dark:hover:bg-white/10 dark:hover:text-white"><XMarkIcon className="h-5 w-5" /></button>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-400 to-accent-500 text-white shadow-glow-emerald"><SparklesIcon className="h-6 w-6" /></div>
      <h2 id="feedback-title" className="mt-5 text-2xl font-display text-ink-950 dark:text-white">Help us improve EraEdu</h2>
      <p className="mt-2 text-sm leading-6 text-ink-500 dark:text-white/60">Your feedback is private and visible only to platform administrators—not your teacher.</p>
      <form onSubmit={submit} className="mt-6 space-y-5">
        <fieldset><legend className="text-sm font-semibold text-ink-800 dark:text-white">How was your quiz experience?</legend><div className="mt-2 flex gap-2" aria-label="Rating out of five">{[1,2,3,4,5].map((value) => <button key={value} type="button" onClick={() => setRating(value)} aria-label={`${value} star${value > 1 ? 's' : ''}`} aria-pressed={rating === value} className={`flex h-11 w-11 items-center justify-center rounded-xl text-xl transition ${rating >= value ? 'bg-amber-400 text-white shadow-md' : 'bg-ink-50 text-ink-300 ring-1 ring-ink-900/10 dark:bg-white/[.06] dark:text-white/30'}`}>★</button>)}</div></fieldset>
        <label className="block"><span className="text-sm font-semibold text-ink-800 dark:text-white">What should we improve?</span><select value={category} onChange={(e) => setCategory(e.target.value as Category)} className="input-field mt-2 dark:bg-white/[.06] dark:text-white"><option value="overall">Overall experience</option><option value="content">Questions and content</option><option value="usability">Ease of use</option><option value="performance">Speed and reliability</option><option value="security">Camera and quiz security</option></select></label>
        <label className="block"><span className="text-sm font-semibold text-ink-800 dark:text-white">What worked well? <span className="font-normal text-ink-400">Optional</span></span><textarea value={liked} onChange={(e) => setLiked(e.target.value)} maxLength={1000} rows={2} className="input-field mt-2 resize-none dark:bg-white/[.06] dark:text-white" placeholder="Tell us what you liked..." /></label>
        <label className="block"><span className="text-sm font-semibold text-ink-800 dark:text-white">How can we improve?</span><textarea required value={improvements} onChange={(e) => setImprovements(e.target.value)} minLength={5} maxLength={2000} rows={4} className="input-field mt-2 resize-none dark:bg-white/[.06] dark:text-white" placeholder="Share a specific suggestion or problem..." /></label>
        <fieldset><legend className="text-sm font-semibold text-ink-800 dark:text-white">Would you recommend EraEdu?</legend><div className="mt-2 flex gap-2">{recommendationOptions.map(({ value, label }) => <button key={label} type="button" onClick={() => setWouldRecommend(value)} className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${wouldRecommend === value ? 'bg-primary-600 text-white' : 'bg-ink-50 text-ink-600 ring-1 ring-ink-900/10 dark:bg-white/[.06] dark:text-white/70'}`}>{label}</button>)}</div></fieldset>
        <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setOpen(false)} className="rounded-xl px-5 py-2.5 text-sm font-semibold text-ink-500 transition hover:bg-ink-50 dark:hover:bg-white/10">Not now</button><button disabled={submitting} type="submit" className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink-950 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 disabled:opacity-50 dark:bg-primary-500 dark:text-ink-950"><CheckCircleIcon className="h-5 w-5" />{submitting ? 'Sending...' : 'Send feedback'}</button></div>
      </form>
    </motion.div>
  </motion.div>}</AnimatePresence>;
};

export default PostQuizFeedbackModal;
