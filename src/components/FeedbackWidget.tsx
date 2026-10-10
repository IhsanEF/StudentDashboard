import { useRef, useState } from 'react';
import { CheckCircle2, MessageSquare, Send, X } from 'lucide-react';
import { auth, getAuthHeader } from '../auth';
import { useModalFocus } from '../hooks/useModalFocus';
import { FEEDBACK_CATEGORIES, type FeedbackCategory, type FeedbackSeverity } from '../../shared/feedback';

export default function FeedbackWidget({ open, onOpen, onClose, hidden, section, isDemoMode }: {
  open: boolean; onOpen: () => void; onClose: () => void; hidden: boolean; section: string; isDemoMode: boolean;
}) {
  const [category, setCategory] = useState<FeedbackCategory>('improvement');
  const [message, setMessage] = useState('');
  const [steps, setSteps] = useState('');
  const [severity, setSeverity] = useState<FeedbackSeverity>('medium');
  const [includeContext, setIncludeContext] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');
  const pending = useRef<{ signature: string; id: string } | null>(null);
  const sendingRef = useRef(false);
  const { modalRef, handleBackdropClick } = useModalFocus({ isOpen: open, onClose });
  const fieldClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60';
  const reportDetails = category === 'bug' || category === 'usability';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sendingRef.current || isDemoMode) return;
    if (message.trim().length < 5) { setError('Please add a little more detail (at least 5 characters).'); return; }
    if (!auth.currentUser) { setError('Please sign in again before sending feedback.'); return; }
    const browser = /Edg\//.test(navigator.userAgent) ? 'Edge' : /Firefox\//.test(navigator.userAgent) ? 'Firefox'
      : /Chrome\//.test(navigator.userAgent) ? 'Chrome' : /Safari\//.test(navigator.userAgent) ? 'Safari' : 'Other';
    const body = { category, message: message.trim(), steps: reportDetails ? steps.trim() : '',
      severity: reportDetails ? severity : 'medium', ...(includeContext ? { context: { section, browser } } : {}) };
    const signature = JSON.stringify(body);
    if (pending.current?.signature !== signature) pending.current = { signature, id: crypto.randomUUID() };
    sendingRef.current = true; setSending(true); setError('');
    try {
      const response = await fetch('/api/feedback', { method: 'POST',
        headers: { ...await getAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, requestId: pending.current.id }), signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (!response.ok || result.ok !== true || typeof result.id !== 'string') {
        throw new Error(typeof result.error === 'string' ? result.error : 'Feedback could not be saved. Please try again.');
      }
      setReceipt(result.id.slice(0, 8)); setMessage(''); setSteps(''); pending.current = null;
    } catch (failure) {
      setError(failure instanceof Error && failure.name !== 'TimeoutError' && failure.name !== 'TypeError'
        ? failure.message : 'Could not connect. Your message is still here; please try again.');
    } finally { sendingRef.current = false; setSending(false); }
  }

  return <>
    {!hidden && !open && <button type="button" onClick={onOpen} aria-label="Feedback and support" title="Suggestions, issues and feature requests"
      className="fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] md:bottom-6 z-40 flex min-h-11 items-center gap-2 rounded-full border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 [body:has([role=dialog])_&]:hidden [body:has(#floating-focus-timer-host_aside)_&]:hidden">
      <MessageSquare size={17} aria-hidden="true" /><span className="hidden sm:inline">Feedback</span>
    </button>}
    <div className={open ? 'fixed inset-0 z-[70] flex items-end justify-end bg-slate-900/25 p-3 sm:p-6' : 'hidden'} onClick={handleBackdropClick}>
      <div ref={modalRef} role={open ? 'dialog' : undefined} aria-modal={open ? true : undefined} aria-labelledby="feedback-title" tabIndex={-1}
        className="flex w-full max-w-sm max-h-[85dvh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-xl outline-none">
        <div className="flex items-start justify-between border-b border-slate-100 p-4">
          <div><h2 id="feedback-title" className="text-base font-semibold">Feedback & support</h2><p className="mt-1 text-xs text-slate-600">Help make My LMS better for everyone.</p></div>
          <button type="button" onClick={onClose} aria-label="Close feedback" className="-mr-1 -mt-1 grid min-h-11 min-w-11 place-items-center rounded-lg hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-4">
          {receipt ? <div role="status" className="space-y-3 py-3">
            <CheckCircle2 className="text-emerald-700" size={28} /><h3 className="font-semibold">Thanks — your feedback is saved.</h3>
            <p className="text-sm text-slate-600">Reference: {receipt}. Status: New.</p>
            <button type="button" onClick={() => { setReceipt(''); setIncludeContext(false); }} className="min-h-11 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">Send another message</button>
          </div> : <form onSubmit={submit} className="space-y-4">
            {isDemoMode && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">You can preview this form. Sign in to send feedback.</p>}
            <div><label htmlFor="feedback-category" className="mb-1.5 block text-sm font-medium">What would you like to share?</label>
              <select id="feedback-category" value={category} onChange={e => setCategory(e.target.value as FeedbackCategory)} disabled={sending} className={fieldClass}>
                {FEEDBACK_CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select></div>
            <div><label htmlFor="feedback-message" className="mb-1.5 block text-sm font-medium">Your message</label>
              <textarea id="feedback-message" value={message} onChange={e => setMessage(e.target.value)} rows={4} maxLength={4000} required disabled={sending} aria-describedby="feedback-privacy"
                placeholder="What could work better?" className={fieldClass + ' resize-y'} />
              <p id="feedback-privacy" className="mt-1.5 text-xs leading-relaxed text-slate-600">Shared privately with the My LMS team and kept for up to 90 days. Please leave out passwords, grades and private student information.</p>
            </div>
            {reportDetails && <>
              <div><label htmlFor="feedback-steps" className="mb-1.5 block text-sm font-medium">What were you trying to do? <span className="font-normal text-slate-500">(optional)</span></label>
                <textarea id="feedback-steps" value={steps} onChange={e => setSteps(e.target.value)} rows={2} maxLength={2000} disabled={sending} className={fieldClass} /></div>
              <div><label htmlFor="feedback-severity" className="mb-1.5 block text-sm font-medium">How much does it affect you?</label>
                <select id="feedback-severity" value={severity} onChange={e => setSeverity(e.target.value as FeedbackSeverity)} disabled={sending} className={fieldClass}>
                  <option value="low">Minor inconvenience</option><option value="medium">Makes things difficult</option><option value="high">Stops me from using the feature</option>
                </select></div>
            </>}
            <label className="flex items-start gap-2 text-xs leading-relaxed text-slate-600"><input type="checkbox" checked={includeContext} onChange={e => setIncludeContext(e.target.checked)} disabled={sending} className="mt-0.5" />
              Include my browser, app version and current section to help investigate.</label>
            {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            <button type="submit" disabled={sending || isDemoMode || message.trim().length < 5} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
              <Send size={15} aria-hidden="true" />{sending ? 'Sending…' : 'Send feedback'}
            </button>
          </form>}
        </div>
      </div>
    </div>
  </>;
}
