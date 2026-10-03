import React, { useContext, useState } from 'react';
import { 
  Shield, 
  Lock, 
  Eye, 
  Server, 
  Sparkles, 
  X, 
  CheckCircle2, 
  Trash2, 
  Calendar, 
  WifiOff, 
  Users, 
  Clock, 
  AlertTriangle, 
  RefreshCw 
} from 'lucide-react';
import { useModalFocus } from '../hooks/useModalFocus';
import { TaskContext } from '../hooks/useTasks';
import { auth, db, logout as authLogout, getAuthHeader } from '../auth';
import { deleteUser } from 'firebase/auth';
import { collection, doc, getDocs, writeBatch, deleteDoc } from 'firebase/firestore';

interface PrivacyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PrivacyModal({ isOpen, onClose }: PrivacyModalProps) {
  const { modalRef, handleBackdropClick } = useModalFocus({
    isOpen,
    onClose
  });

  const taskContext = useContext(TaskContext);
  const [isRemovingFeedUrl, setIsRemovingFeedUrl] = useState(false);
  const [feedUrlRemovedNotice, setFeedUrlRemovedNotice] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const hasSavedFeedUrl = Boolean(taskContext?.notificationPrefs?.savedCalendarFeedUrl);

  const handleRemoveSavedCalendarFeedUrl = async () => {
    if (!taskContext) return;
    setIsRemovingFeedUrl(true);
    try {
      await taskContext.updateNotificationPrefs({
        ...taskContext.notificationPrefs,
        savedCalendarFeedUrl: ''
      });
      setFeedUrlRemovedNotice(true);
      taskContext.showToast({ message: 'Saved Canvas calendar feed URL removed from cloud profile.' });
      setTimeout(() => setFeedUrlRemovedNotice(false), 4000);
    } catch (e: any) {
      console.error('Failed to remove saved calendar feed URL:', e);
      taskContext.showToast({ message: `Failed to remove feed URL: ${e?.message || 'Unknown error'}` });
    } finally {
      setIsRemovingFeedUrl(false);
    }
  };

  const purgeUserDataCascade = async (uid: string) => {
    const subcollections = ['tasks', 'courses', 'classes', 'exams'];
    for (const sub of subcollections) {
      try {
        const colRef = collection(db, 'users', uid, sub);
        const snap = await getDocs(colRef);
        if (!snap.empty) {
          const batch = writeBatch(db);
          snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
          await batch.commit();
        }
      } catch (err) {
        console.warn(`Failed to clear subcollection ${sub}:`, err);
      }
    }

    try {
      await deleteDoc(doc(db, 'users', uid));
    } catch (err) {
      console.warn('Failed to delete users/{uid} root document:', err);
    }

    if (taskContext?.groups && taskContext.groups.length > 0 && taskContext.leaveGroup) {
      for (const g of taskContext.groups) {
        try {
          await taskContext.leaveGroup(g.id);
        } catch (gErr) {
          console.warn('Failed to leave group during purge:', gErr);
        }
      }
    }

    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
  };

  const handleDeleteAccountAndData = async () => {
    const confirmation = window.prompt(
      'Are you sure you want to permanently delete your account and all associated coursework data? This action cannot be undone. Type DELETE ACCOUNT to confirm:'
    );
    if (confirmation !== 'DELETE ACCOUNT') {
      return;
    }

    setIsDeletingAccount(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser || taskContext?.isDemoMode) {
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch {}
        taskContext?.showToast({ message: 'Demo account data cleared.' });
        onClose();
        window.location.reload();
        return;
      }

      await purgeUserDataCascade(currentUser.uid);

      try {
        const authHeaders = await getAuthHeader();
        if (authHeaders.Authorization) {
          await fetch('/api/account/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders }
          }).catch(() => {});
        }
      } catch {}

      try {
        await deleteUser(currentUser);
      } catch (authErr: any) {
        console.warn('deleteUser non-fatal error during purge:', authErr);
      }

      taskContext?.showToast({ message: 'Your account and all associated data have been permanently deleted.' });
      await authLogout();
      onClose();
      window.location.reload();
    } catch (err: any) {
      console.error('Failed to delete account and data:', err);
      taskContext?.showToast({ message: `Failed to delete account: ${err?.message || 'Unknown error'}` });
    } finally {
      setIsDeletingAccount(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-fade-in"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-modal-title"
    >
      <div 
        ref={modalRef}
        tabIndex={-1}
        className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
              <Shield size={22} />
            </div>
            <div>
              <h2 id="privacy-modal-title" className="text-lg font-bold text-slate-900">How your data is used</h2>
              <p className="text-xs text-slate-500 font-medium">How your coursework, calendar, and grades are protected</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close How your data is used"
            className="text-slate-400 hover:text-slate-600 p-2 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-sm text-slate-700 leading-relaxed">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 space-y-2">
            <h3 className="font-bold text-slate-900">About / Operator</h3>
            <p>This independently hosted dashboard is operated by the owner of this deployment. It is not affiliated with, endorsed by, or operated by the University of British Columbia (UBC).</p>
            <p><strong>Storage & Processing Locations:</strong> Google Cloud Firestore stores your cloud records, and Google Gemini processes content you send to AI features through this app's server. These services may store or process data outside Canada, including in the United States. This deployment's exact storage and processing regions have not been verified; Canadian-only data residency is not guaranteed.</p>
          </div>
          
          <div className="bg-blue-50/80 border border-blue-200 rounded-xl p-4 text-xs text-blue-900 flex items-start gap-3">
            <Sparkles className="shrink-0 text-blue-600 mt-0.5" size={16} />
            <div>
              <span className="font-bold block mb-0.5 text-blue-950">No Direct Canvas API Connection Needed</span>
              Your coursework comes only from what you give us: your Canvas calendar link, pasted Canvas emails, uploaded syllabi or spreadsheets, and screenshots. We never connect to Canvas directly or store your Canvas password.
            </div>
          </div>

          <div className="space-y-4">
            {/* AI Features (V3-125, V3-232) */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles size={16} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-slate-900 text-sm">AI-Powered Features (Google Gemini)</h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  When you use AI features, the full text, syllabus files (PDF/DOCX/TXT), timetable schedules, or uploaded screenshots (such as Canvas gradebooks, course portals, or assignment briefs) are transmitted to the Google Gemini API via secure server-side proxy routes. 
                </p>
                <div className="mt-2 p-2.5 rounded-lg bg-purple-50/60 border border-purple-200/60 text-[11px] text-purple-950 space-y-1">
                  <p className="font-semibold">Gemini-backed tools across the dashboard:</p>
                  <ul className="list-disc list-inside space-y-0.5 text-purple-900 ml-1">
                    <li><strong>Smart Import & Syllabus Parser:</strong> Extracts assignment deadlines, exam dates, and grade weightings.</li>
                    <li><strong>Image & Schedule Parser:</strong> Extracts timetable class blocks from screenshots or schedule images.</li>
                    <li><strong>Quick Add:</strong> Natural-language parsing of task titles, dates, and course codes.</li>
                    <li><strong>Task Step Breakdown:</strong> Generates actionable step-by-step milestones for complex assignments.</li>
                    <li><strong>Effort Estimation:</strong> Analyzes task types to estimate required study hours.</li>
                    <li><strong>Workload & Study Advice:</strong> Recommends pace adjustments based on weekly crunch periods.</li>
                  </ul>
                  <p className="pt-1 text-slate-600">
                    <strong>Third-Party Names & Sensitive Data:</strong> Uploaded documents and screenshots may contain classmates' names, instructor emails, or confidential assignment instructions. We strongly advise cropping or redacting sensitive third-party personal details before uploading.
                  </p>
                  <p className="text-slate-600">
                    <strong>Data Use & Retention:</strong> This deployment's Gemini billing tier has not been verified, so we cannot promise that uploads and responses are excluded from model improvement or retained only transiently. Google's treatment of content depends on the service tier and applicable terms. Avoid sending personal or confidential information. See the <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer" className="underline text-blue-700">Gemini API terms</a> for details.
                  </p>
                </div>
              </div>
            </div>

            {/* Canvas Calendar Feeds (.ics), Storage, and Background Polling (V4-067, V4-291) */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
                <Server size={16} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-slate-900 text-sm">Canvas Calendar Feeds (.ics), Storage & 6-Hourly Polling</h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  When you provide a Canvas Calendar Feed URL or upload an .ics file, our server securely parses calendar events directly without third-party tracking or advertising. If you save your Canvas feed URL in Settings, the URL (including its private feed token) is securely stored in your cloud profile and auto-polled server-side every 6 hours (or once daily according to your preferences) to detect newly posted assignments and announcements. The saved feed URL is also included in your exported dashboard backup files so it can be restored.
                </p>

                {/* Remove saved Canvas feed URL control (V4-291) */}
                {taskContext && (
                  <div className="mt-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div>
                      <span className="text-xs font-semibold text-slate-800 block">
                        Saved Canvas Feed URL:
                      </span>
                      <span className="text-[11px] text-slate-500 font-mono truncate max-w-xs block">
                        {hasSavedFeedUrl 
                          ? `${taskContext.notificationPrefs.savedCalendarFeedUrl?.slice(0, 36)}...` 
                          : 'No Canvas feed URL currently saved in profile.'}
                      </span>
                    </div>
                    {hasSavedFeedUrl ? (
                      <button
                        type="button"
                        onClick={handleRemoveSavedCalendarFeedUrl}
                        disabled={isRemovingFeedUrl}
                        className="px-3 py-1.5 text-xs font-semibold bg-white border border-amber-300 text-amber-900 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                      >
                        {isRemovingFeedUrl ? 'Removing...' : 'Remove saved Canvas feed URL'}
                      </button>
                    ) : feedUrlRemovedNotice ? (
                      <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                        <CheckCircle2 size={13} /> Feed URL Removed
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
            </div>

            {/* Cloud Storage & Security Rules */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0 mt-0.5">
                <Lock size={16} />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Cloud Storage & Private User Partitions</h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Your coursework, timetable, and grades are stored in Google Cloud Firestore with security rules ensuring only your authenticated account can access or modify your personal records.
                </p>
              </div>
            </div>

            {/* Local Storage & Plaintext Cache (V3-285, V3-125, V4-067, V4-117) */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 mt-0.5">
                <Eye size={16} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-slate-900 text-sm">Unencrypted Plaintext Cache & Shared Computers</h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Your coursework is also cached in your browser so the dashboard works offline. This cache is <strong>not encrypted</strong> — sign out on shared or public computers. It includes localStorage and Firestore IndexedDB data.
                </p>
                <p className="text-xs text-slate-600 mt-1.5">
                  <strong>Shared Computer Safety:</strong> Signing out does not clear all cached coursework. Firestore IndexedDB and other site data can remain after you close a normal browser window. On shared or campus lab computers, sign out and clear this site's data in your browser settings. For future sessions, use a Private / Incognito window and close all private windows when finished.
                </p>
              </div>
            </div>

            {/* Server Telemetry, Diagnostics & Profile Record (V3-232) */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                <Server size={16} />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Server Telemetry, Diagnostics & User Profile Record</h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  <strong>Server Telemetry & Diagnostics:</strong> When your client interacts with server proxy endpoints (such as calendar feed sync, syllabus parsing, or AI tools), our server logs request timestamps, error traces, and client IP addresses for security diagnostics, rate limiting, and system reliability. Diagnostic logs are purged on rolling cycles.
                </p>
                <p className="text-xs text-slate-600 mt-1">
                  <strong>User Profile Document:</strong> Your cloud account root record (<code className="bg-slate-100 px-1 py-0.5 rounded text-[11px]">users/{'{uid}'}</code>) stores your authenticated email, display name, account creation date, and notification preferences.
                </p>
              </div>
            </div>

            {/* Service Worker & Offline Cache (V4-291) */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center shrink-0 mt-0.5">
                <WifiOff size={16} />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Offline PWA Precache & Service Worker</h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  The dashboard uses a Progressive Web App (PWA) Service Worker cache to pre-cache the application shell, icons, and interface assets so you can open and run the dashboard even when disconnected from campus Wi-Fi. The service worker precache only holds application assets and does not store your grades or personal notes.
                </p>
              </div>
            </div>

            {/* Study Groups Visibility (V4-291) */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0 mt-0.5">
                <Users size={16} />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Study Groups & Team Visibility</h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  When you create or join a group project workspace, only shared group tasks, assignments, and member names are visible to other students in that group. Your personal coursework, individual grades, private timetable classes, study habits, and notes are never shared with group members.
                </p>
              </div>
            </div>

            {/* Data Retention Policy (V4-291) */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center shrink-0 mt-0.5">
                <Clock size={16} />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Data Retention Policy</h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  User-authored tasks, timetable entries, and course records are retained securely in your private user partition while your account remains active. Inactive accounts retain data for up to 12 months before being permanently expunged. You can delete specific coursework items or completely erase your account and all data at any time.
                </p>
              </div>
            </div>

            {/* Account & Data Deletion Controls (V3-125, V4-291) */}
            <div className="pt-2 border-t border-slate-100">
              <div className="p-4 rounded-xl border border-red-200 bg-red-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-bold text-red-950 flex items-center gap-1.5">
                    <Trash2 size={14} className="text-red-600" />
                    <span>Delete My Data and Account</span>
                  </h4>
                  <p className="text-[11px] text-red-800/80 mt-0.5 max-w-md">
                    Permanently delete your account login, profile record (<code className="bg-red-100/70 px-1 py-0.5 rounded text-[10px]">users/{'{uid}'}</code>), tasks, timetable schedules, courses, exams, group memberships, and revoke active calendar subscriptions.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDeleteAccountAndData}
                  disabled={isDeletingAccount}
                  className="px-3.5 py-2 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors shadow-xs flex items-center justify-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
                >
                  {isDeletingAccount ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete my data and account</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4 flex items-center gap-2 text-xs text-slate-500">
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            <span>No student data or grade information is ever sold, rented, or shared.</span>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
          >
            I Understand
          </button>
        </div>
      </div>
    </div>
  );
}
