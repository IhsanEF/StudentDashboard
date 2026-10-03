import React, { useState } from 'react';
import { Download, Smartphone, X, Share2, PlusSquare, Sparkles } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useModalFocus } from '../hooks/useModalFocus';

interface PWAInstallButtonProps {
  variant?: 'primary' | 'outline' | 'compact';
  className?: string;
  onInstalled?: () => void;
  showDismissibleHint?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ 
  variant = 'primary', 
  className = '',
  onInstalled,
  showDismissibleHint = false
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const isIOSDevice = /iPad|iPhone|iPod/.test(ua) ||
    (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isWebview = /FBAN|FBAV|Instagram|Discord|Messenger|Line|MicroMessenger|Snapchat|BytedanceWebview|; wv\)/i.test(ua) ||
    (/AppleWebKit/.test(ua) && !/Safari/.test(ua));
  const isIOSSafari = isIOS && isIOSDevice && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) && !isWebview;
  const { modalRef, handleBackdropClick } = useModalFocus({
    isOpen: showIOSGuide && isIOSSafari && !isInstalled && !isInstallable,
    onClose: () => setShowIOSGuide(false)
  });
  const [isInstalling, setIsInstalling] = useState(false);
  const [hintDismissed, setHintDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('pwa_install_hint_dismissed') === 'true';
    } catch {
      return false;
    }
  });

  const dismissHint = () => {
    setHintDismissed(true);
    try {
      localStorage.setItem('pwa_install_hint_dismissed', 'true');
    } catch {}
  };

  // If already running in standalone PWA mode, hide the button
  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    setIsInstalling(true);
    const success = await install();
    setIsInstalling(false);
    if (success && onInstalled) {
      onInstalled();
    }
  };

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    if (variant === 'compact') {
      return (
        <button
          type="button"
          onClick={handleInstallClick}
          disabled={isInstalling}
          aria-label="Install app"
          title="Install app"
          className={`inline-flex items-center justify-center p-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-xs hover:from-blue-700 hover:to-indigo-700 transition cursor-pointer min-h-[36px] min-w-[36px] ${className}`}
        >
          <Smartphone size={16} />
        </button>
      );
    }

    if (variant === 'outline') {
      return (
        <div className="space-y-1.5 w-full">
          {showDismissibleHint && !hintDismissed && (
            <div className="flex items-center justify-between p-2 rounded-lg bg-blue-50/80 border border-blue-100 text-[11px] text-blue-800">
              <span>Install for fast offline access and fullscreen mode.</span>
              <button
                type="button"
                onClick={dismissHint}
                aria-label="Dismiss install hint"
                className="text-blue-500 hover:text-blue-700 p-0.5 cursor-pointer"
              >
                <X size={12} />
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={handleInstallClick}
            disabled={isInstalling}
            aria-label="Install app"
            className={`flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50/70 hover:bg-blue-100/70 px-3.5 py-2.5 text-xs font-bold text-blue-700 transition cursor-pointer min-h-[44px] ${className}`}
          >
            <Download size={15} />
            <span>Install app</span>
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-1.5 w-full">
        {showDismissibleHint && !hintDismissed && (
          <div className="flex items-center justify-between p-2 rounded-lg bg-blue-50/80 border border-blue-100 text-[11px] text-blue-800">
            <span>Install for fast offline access and fullscreen mode.</span>
            <button
              type="button"
              onClick={dismissHint}
              aria-label="Dismiss install hint"
              className="text-blue-500 hover:text-blue-700 p-0.5 cursor-pointer"
            >
              <X size={12} />
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={handleInstallClick}
          disabled={isInstalling}
          aria-label="Install app"
          className={`flex items-center justify-center gap-2 rounded-xl bg-[#002145] hover:bg-blue-950 px-4 py-2 text-xs font-bold text-white shadow-sm transition cursor-pointer min-h-[36px] ${className}`}
        >
          <Smartphone size={14} className="text-amber-400" />
          <span>Install app</span>
        </button>
      </div>
    );
  }

  // iOS Safari flow (beforeinstallprompt is not natively supported by WebKit)
  if (isIOSSafari) {
    return (
      <>
        {variant === 'compact' ? (
          <button
            type="button"
            onClick={() => setShowIOSGuide(true)}
            aria-label="Install app"
            title="Install app"
            className={`inline-flex items-center justify-center p-2 rounded-xl bg-[#002145] text-white hover:bg-blue-950 transition cursor-pointer min-h-[36px] min-w-[36px] ${className}`}
          >
            <Smartphone size={16} />
          </button>
        ) : (
          <div className="space-y-1.5 w-full">
            {showDismissibleHint && !hintDismissed && (
              <div className="flex items-center justify-between p-2 rounded-lg bg-blue-50/80 border border-blue-100 text-[11px] text-blue-800">
                <span>Add to Home Screen for a fullscreen view.</span>
                <button
                  type="button"
                  onClick={dismissHint}
                  aria-label="Dismiss install hint"
                  className="text-blue-500 hover:text-blue-700 p-0.5 cursor-pointer"
                >
                  <X size={12} />
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowIOSGuide(true)}
              aria-label="Install app"
              className={`flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50/70 hover:bg-blue-100/70 px-3.5 py-2 text-xs font-bold text-blue-800 transition cursor-pointer min-h-[36px] ${className}`}
            >
              <Smartphone size={14} className="text-blue-600" />
              <span>Install app</span>
            </button>
          </div>
        )}

        {showIOSGuide && (
          <div 
            ref={modalRef}
            onClick={handleBackdropClick}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in"
          >
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 text-slate-800">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#002145] text-amber-400 flex items-center justify-center shrink-0">
                    <Smartphone size={20} />
                  </div>
                  <div>
                    <h3 id="ios-install-title" className="text-base font-bold text-slate-900">Install app</h3>
                    <p className="text-xs text-slate-500">Run fullscreen like a native mobile app</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Close installation guide"
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="mt-5 space-y-3.5 text-xs text-slate-600">
                <div className="flex items-start gap-3 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="p-1.5 rounded-lg bg-blue-100 text-blue-700 shrink-0">
                    <Share2 size={16} />
                  </div>
                  <div>
                    <span className="font-bold text-slate-800 block">1. Tap the Share button</span>
                    <span>Open Safari's Share menu; its location depends on your browser layout.</span>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700 shrink-0">
                    <PlusSquare size={16} />
                  </div>
                  <div>
                    <span className="font-bold text-slate-800 block">2. Tap "Add to Home Screen"</span>
                    <span>Scroll down the action sheet and select <strong>Add to Home Screen</strong>.</span>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="p-1.5 rounded-lg bg-amber-100 text-amber-700 shrink-0">
                    <Sparkles size={16} />
                  </div>
                  <div>
                    <span className="font-bold text-slate-800 block">3. Launch from Home Screen</span>
                    <span>Tap Add, then open the app from your Home Screen. Offline access depends on what your browser has cached; some features need a connection.</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white hover:bg-slate-800 transition cursor-pointer min-h-[44px]"
              >
                Got It
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  if (variant === 'compact') return null;
  return (
    <p className={`text-xs text-slate-600 ${className}`}>
      {isWebview
        ? 'Open this page in Safari or Chrome to see installation options.'
        : isIOSDevice
          ? "Use your browser's Share / Add to Home Screen option if available, or open this page in Safari."
          : 'Use your browser menu → Install app (or Add to Home Screen), if available.'}
    </p>
  );
};
