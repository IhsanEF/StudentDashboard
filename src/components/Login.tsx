import { useState, useEffect } from 'react';
import { GraduationCap, AlertCircle, Loader2, Copy, Check, Info } from 'lucide-react';
import { googleSignIn, emailSignIn, resetPassword } from '../auth';
import PrivacyModal from './PrivacyModal';

export default function Login({ 
  onLogin,
  onDemoLogin
}: { 
  onLogin: (user: any) => void;
  onDemoLogin: () => void;
}) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const [isWebview, setIsWebview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingAction, setPendingAction] = useState<'google' | 'email' | 'reset' | null>(null);
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);

  useEffect(() => {
    // Detect embedded in-app webviews (e.g. Canvas app, Discord, Instagram, Messenger)
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      const ua = navigator.userAgent || '';
      const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
      const isEmbedded = !standalone && (/FBAN|FBAV|Instagram|Discord|Messenger|Line|MicroMessenger|Snapchat|BytedanceWebview/i.test(ua) || (/(iPhone|iPod|iPad).*AppleWebKit(?!.*Safari)/i.test(ua)) || (/Android.*Version\/[0-9].[0-9]/i.test(ua)));
      setIsWebview(isEmbedded);
    }
  }, []);

  const handleCopyLink = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const showAuthError = (err: any) => {
    console.error('Login error details:', err);
    if (err.code === 'auth/unauthorized-domain') {
      setError('Google sign-in is not configured for this address yet. Please use email sign-in while we resolve it.');
    } else if (err.code === 'auth/operation-not-allowed' || err.code === 'auth/password-login-disabled') {
      setError('This sign-in method is currently unavailable. Please try the other sign-in option.');
    } else if (err.code === 'auth/popup-blocked') {
      setError('Allow pop-ups for this site to sign in with Google, or sign in with email below.');
    } else if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
      setError('The sign-in window closed before finishing. Please try again, or sign in with email.');
    } else if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-login-credentials'].includes(err.code)) {
      setError('The email or password is incorrect. Try again or reset your password.');
    } else if (err.code === 'auth/invalid-email') {
      setError('Enter a valid email address.');
    } else if (err.code === 'auth/too-many-requests') {
      setError('Too many sign-in attempts. Please wait a few minutes and try again.');
    } else if (err.code === 'auth/user-disabled') {
      setError('This account is disabled. Please contact the dashboard owner.');
    } else if (err.code === 'auth/network-request-failed') {
      setError('Unable to connect. Check your internet connection and try again.');
    } else if (err.message?.includes('disallowed_useragent')) {
      setError('Open this page in Safari or Chrome to sign in with Google, or use email sign-in below.');
    } else {
      setError("Sign-in didn't finish. Please try again or use the other sign-in option.");
    }
  };

  const handleLogin = async () => {
    setLoading(true);
    setPendingAction('google');
    setError('');
    setNotice('');
    try {
      const user = await googleSignIn(false, keepSignedIn);
      if (user) {
        onLogin(user);
      }
    } catch (err: any) {
      showAuthError(err);
    } finally {
      setLoading(false);
      setPendingAction(null);
    }
  };

  const handleEmailLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setPendingAction('email');
    setError('');
    setNotice('');
    try {
      onLogin(await emailSignIn(email, password, keepSignedIn));
    } catch (err: any) {
      showAuthError(err);
    } finally {
      setPassword('');
      setLoading(false);
      setPendingAction(null);
    }
  };

  const handlePasswordReset = async () => {
    setError('');
    setNotice('');
    if (!email.trim()) {
      setError('Enter your email address above to reset your password.');
      return;
    }
    setLoading(true);
    setPendingAction('reset');
    try {
      await resetPassword(email);
      setNotice('If an account exists for this email, you will receive a password reset link. Check your inbox and spam folder.');
    } catch (err: any) {
      // Keep account existence private on projects without enumeration protection.
      if (err.code === 'auth/user-not-found') {
        setNotice('If an account exists for this email, you will receive a password reset link. Check your inbox and spam folder.');
      } else {
        showAuthError(err);
      }
    } finally {
      setLoading(false);
      setPendingAction(null);
    }
  };

  const isBusy = loading;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 space-y-6 border border-slate-100">
        <div className="text-center">
          <div className="bg-blue-600 text-white w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-200">
            <GraduationCap size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">UBC Student Dashboard</h1>
          <p className="mt-2 text-xs text-slate-600">Operated independently by this deployment's owner. Not affiliated with or endorsed by UBC.</p>
          <p className="text-slate-600 mt-2 text-sm">Manage your coursework, assignments, and deadlines in one place.</p>
        </div>

        {isWebview && (
          <div className="bg-amber-50 text-amber-900 p-4 rounded-xl text-xs space-y-2 border border-amber-200">
            <div className="flex items-center gap-2 font-bold text-amber-800">
              <Info size={16} className="shrink-0" />
              In-App Browser Detected
            </div>
            <p className="leading-relaxed">
              Google blocks sign-in inside Canvas, Instagram, and chat app browsers. Open this page in Safari or Chrome to sign in with your Google account.
            </p>
            <button
              type="button"
              onClick={handleCopyLink}
              className="inline-flex items-center gap-1.5 bg-amber-200/80 hover:bg-amber-300 text-amber-900 font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              {copied ? <Check size={14} className="text-green-700" /> : <Copy size={14} />}
              {copied ? 'Link Copied!' : 'Copy Page Link'}
            </button>
          </div>
        )}

        {error && (
          <div 
            role="alert" 
            aria-live="assertive" 
            className="bg-red-50 text-red-700 p-4 rounded-xl flex items-start gap-3 border border-red-100"
          >
            <AlertCircle className="shrink-0 mt-0.5" size={18} />
            <p className="text-xs font-medium leading-relaxed">{error}</p>
          </div>
        )}
        {notice && <p role="status" className="bg-blue-50 text-blue-800 p-4 rounded-xl text-sm">{notice}</p>}

        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={keepSignedIn}
              onChange={e => setKeepSignedIn(e.target.checked)}
              disabled={isBusy}
              className="w-4 h-4 rounded accent-blue-600"
            />
            Keep me signed in on this device
          </label>
          <button
            type="button"
            onClick={handleLogin}
            disabled={isBusy}
            className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-xl py-3.5 px-4 font-semibold flex items-center justify-center gap-3 transition-colors disabled:opacity-70 cursor-pointer shadow-md text-sm"
          >
            {pendingAction === 'google' ? (
              <Loader2 className="animate-spin" size={20} />
            ) : (
              <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5 bg-white rounded-full p-0.5" />
            )}
            {pendingAction === 'google' ? 'Signing in...' : 'Sign in with Google'}
          </button>

          <button type="button" onClick={() => { setShowEmailForm(!showEmailForm); setError(''); setNotice(''); setPassword(''); }}
            disabled={isBusy} aria-expanded={showEmailForm} aria-controls="email-sign-in"
            className="w-full border border-slate-300 text-slate-800 hover:bg-slate-50 rounded-xl py-3 px-4 font-semibold text-sm disabled:opacity-60">
            {showEmailForm ? 'Hide email sign-in' : 'Sign in with email'}
          </button>
          {showEmailForm && (
            <form id="email-sign-in" onSubmit={handleEmailLogin} className="space-y-3 pt-2">
              <div>
                <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 mb-1">Email address</label>
                <input id="login-email" type="email" autoComplete="username" required value={email}
                  onChange={e => setEmail(e.target.value)} disabled={isBusy}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm" />
              </div>
              <div>
                <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 mb-1">Password</label>
                <input id="login-password" type="password" autoComplete="current-password" required value={password}
                  onChange={e => setPassword(e.target.value)} disabled={isBusy}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm" />
              </div>
              <button type="submit" disabled={isBusy} className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-3 font-semibold text-sm disabled:opacity-60">
                {pendingAction === 'email' ? 'Signing in...' : 'Sign in'}
              </button>
              <button type="button" disabled={isBusy} onClick={handlePasswordReset}
                className="text-sm text-blue-700 underline disabled:opacity-60">
                {pendingAction === 'reset' ? 'Sending reset link...' : 'Forgot password?'}
              </button>
              <p className="text-xs text-slate-500">Use the email and password for your existing dashboard account.</p>
            </form>
          )}
        </div>

        <div className="relative flex items-center justify-center">
          <div className="border-t border-slate-200 w-full"></div>
          <span className="bg-white px-3 text-xs text-slate-500 font-bold uppercase">Or</span>
        </div>

        <button
          type="button"
          onClick={onDemoLogin}
          disabled={isBusy}
          className="w-full bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl py-3 px-4 font-semibold text-sm transition-colors cursor-pointer border border-blue-200 flex items-center justify-center gap-2 disabled:opacity-60"
        >
          Try it with sample data
        </button>
        
        <div className="text-center pt-1">
          <button
            type="button"
            onClick={() => setIsPrivacyModalOpen(true)}
            className="text-xs text-slate-500 hover:text-slate-800 underline transition-colors cursor-pointer"
          >
            Privacy & AI
          </button>
        </div>

        <p className="text-center text-xs text-slate-500 font-medium">
          Open to all students &bull; Google or email sign-in
        </p>
      </div>

      <PrivacyModal
        isOpen={isPrivacyModalOpen}
        onClose={() => setIsPrivacyModalOpen(false)}
      />
    </div>
  );
}
