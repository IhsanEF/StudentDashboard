import { useState, useEffect } from 'react';
import { GraduationCap, AlertCircle, Loader2, Copy, Check, Info } from 'lucide-react';
import { googleSignIn } from '../auth';
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
  const [showRedirectFallback, setShowRedirectFallback] = useState(false);
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

  // Detect standalone home-screen PWA mode (iOS WebKit standalone / display-mode: standalone)
  const isStandalone = typeof window !== 'undefined' && (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );

  const handleLogin = async (useRedirect = isStandalone) => {
    setLoading(true);
    setError('');
    try {
      const user = await googleSignIn(useRedirect, keepSignedIn);
      if (user) {
        onLogin(user);
      }
    } catch (err: any) {
      console.error('Login error details:', err);
      
      const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'current domain';

      // If popup fails, reveal the redirect fallback
      if (!useRedirect) {
        setShowRedirectFallback(true);
      }

      if (err.code === 'auth/unauthorized-domain') {
        console.error(`Operator note: This domain (${currentHost}) is not authorized in Firebase Auth. Add it to Authorized domains in Firebase Console.`);
        setError("Sign-in isn't set up for this address yet. This is a problem on our side, not yours — try again later, or use Enter as Demo Student to look around in the meantime.");
      } else if (err.code === 'auth/operation-not-allowed') {
        console.error('Operator note: Google provider is disabled in Firebase Console Authentication.', err);
        setError("Sign-in isn't set up for this address yet. This is a problem on our side, not yours — try again later, or use Enter as Demo Student to look around in the meantime.");
      } else if (err.code === 'auth/popup-blocked') {
        setError('Sign-in pop-up was blocked. Use the link below to sign in on this page.');
      } else if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        setError('Sign-in pop-up was closed before completing. Please try again or sign in on this page.');
      } else if (err.message && err.message.includes('disallowed_useragent')) {
        setError('Google blocks sign-in inside in-app browsers. Please tap the menu (...) and choose "Open in Chrome/Safari".');
      } else {
        console.error('Login error details:', err);
        setError("Sign-in didn't finish. Please try again.");
      }
    } finally {
      setLoading(false);
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
            onClick={() => handleLogin(false)}
            disabled={isBusy}
            className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-xl py-3.5 px-4 font-semibold flex items-center justify-center gap-3 transition-colors disabled:opacity-70 cursor-pointer shadow-md text-sm"
          >
            {isBusy ? (
              <Loader2 className="animate-spin" size={20} />
            ) : (
              <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5 bg-white rounded-full p-0.5" />
            )}
            {isBusy ? 'Checking session...' : 'Sign in with Google'}
          </button>

          {showRedirectFallback && (
            <button
              type="button"
              onClick={() => handleLogin(true)}
              disabled={isBusy}
              className="w-full text-slate-600 hover:text-slate-900 text-xs font-medium py-1 transition-colors cursor-pointer text-center underline"
            >
              Pop-up blocked? Sign in on this page instead
            </button>
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
          Open to all students &bull; Sign in with any Google account
        </p>
      </div>

      <PrivacyModal
        isOpen={isPrivacyModalOpen}
        onClose={() => setIsPrivacyModalOpen(false)}
      />
    </div>
  );
}
