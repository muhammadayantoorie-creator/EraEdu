import { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';
import { IntegrityOutbox, INTEGRITY_QUEUED, INTEGRITY_SAVED } from '../../services/integrityOutbox';

// App-scoped so navigating to results or refreshing does not abandon reports.
export default function IntegrityReportSync() {
  const { user, isAuthenticated, isAuthChecking } = useAuthStore();
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);
  const userId = isAuthenticated && !isAuthChecking && user?.role === 'student' ? user._id : null;
  useEffect(() => {
    setMessage('');
    if (!userId) return;
    let active = true;
    let outbox: IntegrityOutbox;
    try { outbox = new IntegrityOutbox(window.localStorage, userId); }
    catch { setMessage('Local monitoring storage is unavailable. Keep the exam tab open and enable browser storage.'); return; }
    const flush = async () => {
      if (!active) return;
      try {
        await outbox.flush(async event => {
          const current = useAuthStore.getState();
          if (current.user?._id !== userId || !current.isAuthenticated || current.isAuthChecking) throw new Error('Session changed');
          const response = await api.post(`/quizzes/attempts/${encodeURIComponent(event.attemptId)}/report-violation`, event.body);
          if (response.data?.success !== true || !response.data?.data?.violationId) throw new Error('Report was not confirmed');
          if (active) window.dispatchEvent(new CustomEvent(INTEGRITY_SAVED, { detail: { attemptId: event.attemptId, result: response.data.data } }));
        }, () => active && useAuthStore.getState().user?._id === userId);
        if (active) setMessage(outbox.pending().length ? 'Monitoring reports are queued on this device, not yet confirmed by the server. We will retry while you are signed in.' : '');
      } catch {
        if (active) setMessage('Monitoring reports could not be read or saved locally. Keep this tab open and retry; contact support if this continues.');
      }
    };
    const trigger = () => { void flush(); };
    trigger();
    const timer = window.setInterval(trigger, 15_000);
    window.addEventListener('online', trigger);
    window.addEventListener('storage', trigger);
    window.addEventListener(INTEGRITY_QUEUED, trigger);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('online', trigger);
      window.removeEventListener('storage', trigger);
      window.removeEventListener(INTEGRITY_QUEUED, trigger);
    };
  }, [userId, retry]);
  if (!userId || !message) return null;
  return <div role="status" className="fixed bottom-3 left-3 right-3 z-[110] rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 shadow-lg">
    {message} <button type="button" className="ml-2 font-semibold underline focus-visible:ring-2" onClick={() => setRetry(value => value + 1)}>Retry reports</button>
  </div>;
}
