import { useState } from 'react';
import { checkEmailVerification, sendVerificationEmail } from '../auth';
import type { AppUser } from '../types';

export default function EmailVerification({ email, verificationSent, onVerified, onSignOut }: {
  email?: string | null;
  verificationSent?: boolean;
  onVerified: (user: AppUser) => void;
  onSignOut: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const run = async (action: 'send' | 'check' | 'signout') => {
    setBusy(true); setError(''); setMessage('');
    try {
      if (action === 'send') {
        await sendVerificationEmail();
        setMessage('Verification email sent. Check your inbox and spam folder.');
      } else if (action === 'check') {
        const user = await checkEmailVerification();
        if (user) onVerified(user);
        else setError('Your email is not verified yet. Open the link in your email, then try again.');
      } else {
        await onSignOut();
      }
    } catch (err: any) {
      setError(err.code === 'auth/too-many-requests'
        ? 'Please wait a few minutes before trying again.'
        : 'Unable to finish. Check your connection and try again, or sign out and sign in again.');
    } finally { setBusy(false); }
  };

  return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
    <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 space-y-5 border border-slate-100">
      <h1 className="text-2xl font-bold text-slate-900">Verify your email</h1>
      <p className="text-sm text-slate-700">Open the verification link sent to <strong>{email}</strong>, then return here to continue to your dashboard.</p>
      {verificationSent === false && <p className="text-sm text-amber-800">Your account was created, but the email could not be sent. Request a verification email below.</p>}
      <p className="text-sm text-slate-600">Check your spam folder if you don’t see it. You can request another link below.</p>
      {message && <p role="status" className="text-sm text-blue-800">{message}</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button type="button" disabled={busy} onClick={() => run('check')}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-3 font-semibold text-sm disabled:opacity-60">{busy ? 'Please wait...' : 'I’ve verified my email'}</button>
      <button type="button" disabled={busy} onClick={() => run('send')}
        className="w-full border border-slate-300 rounded-xl py-3 text-sm font-semibold text-blue-700 disabled:opacity-60">Resend verification email</button>
      <button type="button" disabled={busy} onClick={() => run('signout')}
        className="w-full text-sm text-slate-700 underline disabled:opacity-60">Sign out and use another account</button>
    </div>
  </div>;
}
