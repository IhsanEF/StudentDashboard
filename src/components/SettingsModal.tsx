import React, { useState, useEffect, useRef } from 'react';
import { deleteUser } from 'firebase/auth';
import { doc, deleteDoc, writeBatch, collection, getDocs } from 'firebase/firestore';
import { auth, db, getAuthHeader, logout as authLogout, googleSignIn } from '../auth';
import { useTasksContext } from '../hooks/useTasks';
import { isTaskAnnouncement } from '../utils';
import { useViewMode } from '../hooks/useViewMode';
import { NotificationPrefs, AppUser, DashboardBackup } from '../types';
import { useModalFocus } from '../hooks/useModalFocus';
import { ViewModeToggle } from './ViewModeToggle';
import {
  X,
  Bell,
  Clock,
  Moon,
  Sliders,
  Sparkles,
  Calendar as CalendarIcon,
  Check,
  AlertCircle,
  RefreshCw,
  User as UserIcon,
  CheckCircle2,
  Volume2,
  VolumeX,
  Smartphone,
  Copy,
  ExternalLink,
  RotateCw,
  Download,
  Upload,
  Database,
  Archive,
  History,
  AlertTriangle,
  FileSpreadsheet,
  Trash2,
  ShieldAlert
} from 'lucide-react';
import DigestPreviewModal from './DigestPreviewModal';
import { PWAInstallButton } from './PWAInstallButton';
import { generateDigestPreview } from '../services/notificationService';
import { formatInTimeZone, TIMEZONE, parseLocalDate } from '../utils';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: AppUser | null;
}

const AVAILABLE_LEAD_TIMES = [
  { minutes: 15, label: '15 min before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 180, label: '3 hours before' },
  { minutes: 1440, label: '1 day before' },
  { minutes: 2880, label: '2 days before' },
  { minutes: 10080, label: '1 week before' }
];

export default function SettingsModal({ isOpen, onClose, user }: SettingsModalProps) {
  const {
    notificationPrefs,
    updateNotificationPrefs,
    triggerTestReminder,
    triggerDigest,
    tasks,
    courses,
    classes,
    exams,
    groups,
    leaveGroup,
    isDemoMode,
    isOnline,
    lastSync,
    refreshTasks,
    hasPendingWrites,
    exportToCSV,
    downloadFullBackup,
    importFullBackup,
    getLatestCheckpoint,
    restoreFromCheckpoint,
    showToast
  } = useTasksContext();

  const { isDetailed } = useViewMode();

  const [activeTab, setActiveTab] = useState<'reminders' | 'calendar' | 'backup' | 'account'>('reminders');
  const [prefs, setPrefs] = useState<NotificationPrefs>(notificationPrefs);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission | 'unsupported'>(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const [showDigestPreview, setShowDigestPreview] = useState(false);
  const [showDigestModal, setShowDigestModal] = useState(false);
  const [inlineDigestType, setInlineDigestType] = useState<'daily' | 'weekly'>('daily');
  const inlinePreview = generateDigestPreview(inlineDigestType, tasks);
  const [testSentNotice, setTestSentNotice] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDeletingData, setIsDeletingData] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isDownloadingCodebase, setIsDownloadingCodebase] = useState(false);

  const handleSyncNow = async () => {
    setIsSyncing(true);
    try {
      await refreshTasks();
    } finally {
      setIsSyncing(false);
    }
  };

  // Calendar Sync State
  const [calendarToken, setCalendarToken] = useState<string | null>(null);
  const [loadingCalendarToken, setLoadingCalendarToken] = useState(false);
  const [calendarTokenError, setCalendarTokenError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Backup & Restore State
  const [pendingRestoreBackup, setPendingRestoreBackup] = useState<DashboardBackup | null>(null);
  const [restoreMode, setRestoreMode] = useState<'merge' | 'replace'>('merge');
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreSuccessNotice, setRestoreSuccessNotice] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [downloadSuccessNotice, setDownloadSuccessNotice] = useState<string | null>(null);
  const [latestCheckpointDate, setLatestCheckpointDate] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previousNotificationPrefs = useRef(notificationPrefs);

  useEffect(() => {
    const previous = previousNotificationPrefs.current;
    previousNotificationPrefs.current = notificationPrefs;
    setPrefs(draft => JSON.stringify(draft) === JSON.stringify(previous) || isRestoring
      ? notificationPrefs : draft);
  }, [notificationPrefs, isRestoring]);

  // Reset local prefs when modal opens or closes (reset preview flags so preview never reopens on top)
  useEffect(() => {
    if (isOpen) {
      setPrefs(notificationPrefs);
      setSaveMessage(null);
      setShowDigestPreview(false);
      setShowDigestModal(false);
    } else {
      setShowDigestPreview(false);
      setShowDigestModal(false);
    }
  }, [isOpen]);

  const hasUnsavedChanges = JSON.stringify(prefs) !== JSON.stringify(notificationPrefs);

  const handleRequestClose = () => {
    if (showDigestModal) {
      setShowDigestModal(false);
      setShowDigestPreview(false);
      return;
    }
    if (showDigestPreview) {
      setShowDigestPreview(false);
      return;
    }
    if (hasUnsavedChanges) {
      if (!window.confirm('You have unsaved changes. Discard changes and close?')) {
        return;
      }
      setPrefs(notificationPrefs);
    }
    setShowDigestPreview(false);
    setShowDigestModal(false);
    onClose();
  };

  const handleCancel = () => {
    if (hasUnsavedChanges) {
      if (!window.confirm('Discard unsaved preference changes?')) {
        return;
      }
    }
    setPrefs(notificationPrefs);
    setShowDigestPreview(false);
    setShowDigestModal(false);
    onClose();
  };

  // Topmost modal escape handling (V3-158):
  // Capture-phase keydown listener intercepts Escape when Digest Preview is active,
  // preventing it from closing SettingsModal and cleanly resetting preview flags.
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showDigestModal) {
          e.stopImmediatePropagation();
          e.stopPropagation();
          setShowDigestModal(false);
          setShowDigestPreview(false);
          return;
        }
        if (showDigestPreview) {
          e.stopImmediatePropagation();
          e.stopPropagation();
          setShowDigestPreview(false);
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDownCapture, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDownCapture, true);
    };
  }, [isOpen, showDigestModal, showDigestPreview]);

  const { modalRef, handleBackdropClick } = useModalFocus({
    isOpen: isOpen && !showDigestModal,
    onClose: handleRequestClose
  });

  // Cascade purge all user data across collections, calendar feed tokens, and local cache (V3-233)
  const purgeUserDataCascade = async (uid: string) => {
    // 1. Batch delete user subcollections
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

    // 2. Delete public calendar token document if active
    if (calendarToken) {
      try {
        await deleteDoc(doc(db, 'calendar_feed_tokens', calendarToken));
      } catch (calErr) {
        console.warn('Failed to delete calendar feed token doc:', calErr);
      }
    }

    // 3. Delete user profile root document
    try {
      await deleteDoc(doc(db, 'users', uid));
    } catch (err) {
      console.warn('Failed to delete users/{uid} root document:', err);
    }

    // 4. Leave any shared group project memberships
    if (groups && groups.length > 0 && leaveGroup) {
      for (const g of groups) {
        try {
          await leaveGroup(g.id);
        } catch (gErr) {
          console.warn('Failed to leave group during purge:', gErr);
        }
      }
    }

    // 5. Revoke calendar token state
    setCalendarToken(null);

    // 6. Clear local storage checkpoints, notifications, and offline caches
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
  };

  const handleDeleteAllData = async () => {
    const confirmation = window.prompt(
      'This will permanently delete all your tasks, courses, timetable schedules, exams, group memberships, and revoke your calendar subscription feed. Type DELETE to confirm:'
    );
    if (confirmation !== 'DELETE') {
      return;
    }

    setIsDeletingData(true);
    try {
      const currentUser = auth.currentUser;
      if (currentUser && !isDemoMode) {
        await purgeUserDataCascade(currentUser.uid);
      } else {
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch {}
      }

      showToast({ message: 'All student data, schedule items, and calendar tokens have been permanently deleted.' });
      await refreshTasks();
    } catch (err: any) {
      console.error('Failed to delete all data:', err);
      showToast({ message: `Failed to delete data: ${err.message || 'Unknown error'}` });
    } finally {
      setIsDeletingData(false);
    }
  };

  const handleDeleteAccount = async () => {
    const confirmation = window.prompt(
      'Are you sure you want to permanently delete your account and all associated data? This action cannot be undone. Type DELETE ACCOUNT to confirm:'
    );
    if (confirmation !== 'DELETE ACCOUNT') {
      return;
    }

    setIsDeletingAccount(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser || isDemoMode) {
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch {}
        showToast({ message: 'Demo account data cleared.' });
        setShowDigestPreview(false);
        setShowDigestModal(false);
        onClose();
        window.location.reload();
        return;
      }

      // 1. Cascade delete all data in Firestore and revoke calendar tokens
      await purgeUserDataCascade(currentUser.uid);

      // 2. Call server-side cascade delete endpoint if present
      try {
        const authHeaders = await getAuthHeader();
        if (authHeaders.Authorization) {
          await fetch('/api/account/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders }
          }).catch(() => {});
        }
      } catch {}

      // 3. Delete Firebase Auth user account with re-auth fallback
      try {
        await deleteUser(currentUser);
      } catch (authErr: any) {
        if (authErr?.code === 'auth/requires-recent-login') {
          const proceed = window.confirm(
            'For security, deleting your account requires recent authentication. Please sign in with Google to confirm your identity and complete deletion.'
          );
          if (proceed) {
            const reauthedUser = await googleSignIn();
            if (reauthedUser) {
              await deleteUser(reauthedUser);
            } else {
              setIsDeletingAccount(false);
              return;
            }
          } else {
            setIsDeletingAccount(false);
            return;
          }
        } else {
          throw authErr;
        }
      }

      showToast({ message: 'Your account and all associated data have been permanently deleted.' });
      await authLogout();
      setShowDigestPreview(false);
      setShowDigestModal(false);
      onClose();
      window.location.reload();
    } catch (err: any) {
      console.error('Failed to delete account:', err);
      showToast({ message: `Failed to delete account: ${err.message || 'Unknown error'}` });
      setIsDeletingAccount(false);
    }
  };

  // Check browser Notification API permission & load checkpoint
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setBrowserPermission(Notification.permission);
    } else {
      setBrowserPermission('unsupported');
    }
    const cp = getLatestCheckpoint();
    setLatestCheckpointDate(cp && (cp.exportedAt || cp.timestamp)
      ? new Date(cp.exportedAt || cp.timestamp).toLocaleString() : null);
  }, [isOpen, getLatestCheckpoint]);

  if (!isOpen) return null;

  const fetchCalendarToken = async () => {
    setLoadingCalendarToken(true);
    setCalendarTokenError(null);

    // Skip network request in demo mode with an explanatory note
    if (isDemoMode) {
      setCalendarTokenError('Calendar feed synchronization is not available in demo mode. Sign in to your account to generate a live calendar feed link.');
      setLoadingCalendarToken(false);
      return;
    }

    try {
      const authHeaders = await getAuthHeader();
      if (!authHeaders.Authorization) {
        setCalendarTokenError('Please sign in with your account to create your calendar link.');
        setLoadingCalendarToken(false);
        return;
      }

      const res = await fetch('/api/calendar/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        }
      });
      if (!res.headers.get('content-type')?.toLowerCase().includes('application/json')) {
        setCalendarTokenError('Calendar feed is unavailable right now: the server returned an unexpected response. Please try again later.');
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errorMsg = data?.error || (res.status === 503 ? 'Calendar feed service unavailable' : 'Calendar feed is unavailable right now');
        setCalendarTokenError(errorMsg);
        return;
      }
      const data = await res.json();
      const token = data.feedToken || data.token;
      if (typeof token === 'string' && token.trim()) {
        setCalendarToken(token);
      } else {
        setCalendarTokenError(data?.error || 'Calendar feed is unavailable right now');
      }
    } catch (e: any) {
      console.error('Failed to fetch calendar token:', e);
      setCalendarTokenError('Calendar feed is unavailable right now');
    } finally {
      setLoadingCalendarToken(false);
    }
  };

  const handleRevokeCalendarToken = async () => {
    if (!window.confirm('Are you sure you want to regenerate your live calendar link? Old calendar subscriptions will stop syncing until updated.')) {
      return;
    }
    if (isDemoMode) {
      setCalendarTokenError('Calendar feed synchronization is not available in demo mode.');
      return;
    }
    setLoadingCalendarToken(true);
    setCalendarTokenError(null);
    setCalendarToken(null); // Clear the token on revoke!
    try {
      const authHeaders = await getAuthHeader();
      if (!authHeaders.Authorization) {
        setCalendarTokenError('Please sign in to regenerate your calendar link.');
        setLoadingCalendarToken(false);
        return;
      }

      const res = await fetch('/api/calendar/token/revoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        }
      });
      if (!res.headers.get('content-type')?.toLowerCase().includes('application/json')) {
        setCalendarTokenError('Calendar feed is unavailable right now: the server returned an unexpected response. Please try again later.');
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setCalendarToken(null);
        setCalendarTokenError(data?.error || 'Failed to regenerate calendar link.');
        return;
      }
      const data = await res.json();
      const token = data.feedToken || data.token;
      if (typeof token === 'string' && token.trim()) {
        setCalendarToken(token);
      } else {
        setCalendarToken(null);
        setCalendarTokenError(data?.error || 'Failed to regenerate calendar link.');
      }
    } catch (e: any) {
      console.error('Failed to regenerate token:', e);
      setCalendarToken(null);
      setCalendarTokenError('Calendar feed is unavailable right now');
    } finally {
      setLoadingCalendarToken(false);
    }
  };

  const calendarFeedUrl = typeof window !== 'undefined' && calendarToken
    ? `${window.location.origin}/api/calendar/feed/${calendarToken}.ics`
    : '';

  const webcalUrl = typeof window !== 'undefined' && calendarToken
    ? `${window.location.origin.replace(/^https?:\/\//, 'webcal://')}/api/calendar/feed/${calendarToken}.ics`
    : '';
  const googleCalendarSubscribeUrl = calendarFeedUrl
    ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl || calendarFeedUrl)}`
    : '';

  const handleCopyCalendarUrl = () => {
    if (!calendarFeedUrl) return;
    navigator.clipboard.writeText(calendarFeedUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleToggleMaster = () => {
    setPrefs(prev => ({ ...prev, enabled: !prev.enabled }));
  };

  const handleToggleChannel = (channel: keyof NotificationPrefs['channels']) => {
    setPrefs(prev => ({
      ...prev,
      channels: {
        ...prev.channels,
        [channel]: !prev.channels[channel]
      }
    }));
  };

  const handleRequestPushPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setBrowserPermission('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setBrowserPermission('denied');
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setBrowserPermission(permission);
      if (permission === 'granted') {
        setPrefs(prev => ({
          ...prev,
          channels: { ...prev.channels, push: true }
        }));
      }
    } catch (e) {
      console.warn('Failed to request notification permission:', e);
    }
  };

  const handleToggleLeadTime = (minutes: number) => {
    setPrefs(prev => {
      const current = prev.leadTimes || [];
      const exists = current.includes(minutes);
      const updated = exists ? current.filter(m => m !== minutes) : [...current, minutes].sort((a, b) => a - b);
      return { ...prev, leadTimes: updated };
    });
  };

  const handleToggleDigest = (digestType: keyof NotificationPrefs['digests']) => {
    setPrefs(prev => ({
      ...prev,
      digests: {
        ...prev.digests,
        [digestType]: !prev.digests[digestType]
      }
    }));
  };

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveFailed(false);
    setSaveMessage(isDemoMode ? 'Saving demo preferences…' : 'Saving preferences — waiting for cloud confirmation…');
    const pendingTimer = setTimeout(() => {
      setSaveMessage('Still waiting for cloud confirmation. If offline, reconnect to finish saving.');
    }, 10000);
    try {
      await updateNotificationPrefs(prefs);
      showToast({ message: 'Saved' });
      onClose();
    } catch (err: any) {
      console.error('Failed to save notification preferences:', err);
      setSaveFailed(true);
      setSaveMessage(err?.code === 'permission-denied'
        ? 'Preferences were rejected by validation or account permissions. Check the settings and try again.'
        : 'Error saving preferences: ' + (err.message || 'Please try again.'));
    } finally {
      clearTimeout(pendingTimer);
      setIsSaving(false);
    }
  };

  const handleTestInApp = (leadMin = 60) => {
    triggerTestReminder(leadMin);
    setTestSentNotice('Test reminder sent to your notification bell. Saved browser notification settings also apply.');
    setTimeout(() => setTestSentNotice(null), 3500);
  };

  // Backup handlers
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (!json.version || !json.data) {
          throw new Error('Invalid My LMSboard backup file structure');
        }
        setPendingRestoreBackup(json as DashboardBackup);
        setRestoreError(null);
      } catch (err: any) {
        setRestoreError('Failed to parse backup file: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };


  const handleDownloadCodebase = async (format: 'zip' | 'tar' = 'zip') => {
    try {
      setIsDownloadingCodebase(true);
      showToast({ message: `Preparing codebase download (${format.toUpperCase()})...` });
      const url = format === 'tar' ? '/api/export-app-package?format=tar' : '/api/export-app-package';
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Export failed with HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = format === 'tar' ? 'my-lms-codebase.tar.gz' : 'my-lms-codebase.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      showToast({ message: `Full codebase package downloaded successfully (.${format === 'tar' ? 'tar.gz' : 'zip'})` });
    } catch (err: any) {
      window.location.href = format === 'tar' ? '/api/export-app-package?format=tar' : '/api/export-app-package';
    } finally {
      setIsDownloadingCodebase(false);
    }
  };

  const handleDownloadBackup = async () => {
    try {
      setRestoreError(null);
      setDownloadSuccessNotice('Preparing full snapshot download...');
      const result = await downloadFullBackup();
      const msg = `Backup downloaded: ${result.fileName}`;
      setDownloadSuccessNotice(msg);
      showToast({ message: msg });
    } catch (err: any) {
      const errMsg = err.message || 'Failed to export backup snapshot.';
      setRestoreError(errMsg);
      setDownloadSuccessNotice(null);
      showToast({ message: errMsg });
    }
  };

  const handleExportCSV = () => {
    setRestoreError(null);
    setDownloadSuccessNotice(null);
    try {
      const result = exportToCSV();
      setDownloadSuccessNotice(result
        ? `Exported ${result.taskCount} tasks to ${result.fileName}`
        : 'No tasks to export yet. Add a task or upload a course outline first.');
    } catch (err: any) {
      setRestoreError(`CSV export failed: ${err.message || 'Please try again.'}`);
    }
  };

  const handleExecuteRestore = async () => {
    if (!pendingRestoreBackup) return;
    if (restoreMode === 'replace') {
      const response = window.prompt('This deletes everything not in the backup. Type REPLACE to continue.');
      if (response !== 'REPLACE') {
        return;
      }
    }
    setIsRestoring(true);
    setRestoreError(null);
    try {
      await importFullBackup(pendingRestoreBackup, restoreMode);
      const msg = `Successfully restored ${pendingRestoreBackup?.data?.tasks?.filter(t => !isTaskAnnouncement(t)).length ?? 0} tasks and ${pendingRestoreBackup?.data?.classes?.length || 0} classes!`;
      setRestoreSuccessNotice(msg);
      showToast({ message: msg });
      setPendingRestoreBackup(null);
      setTimeout(() => setRestoreSuccessNotice(null), 4000);
    } catch (err: any) {
      const errMsg = 'Restore failed: ' + err.message;
      setRestoreError(errMsg);
      showToast({ message: errMsg });
    } finally {
      setIsRestoring(false);
    }
  };

  const handleRestoreLatestCheckpoint = async () => {
    const cp = getLatestCheckpoint();
    const timeStr = cp && (cp.exportedAt || cp.timestamp)
      ? new Date(cp.exportedAt || cp.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : (latestCheckpointDate ? new Date(latestCheckpointDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'recent auto-save');

    if (!window.confirm(`Replace current data with the automatic backup from ${timeStr}?`)) {
      return;
    }
    setIsRestoring(true);
    setRestoreError(null);
    try {
      const restored = await restoreFromCheckpoint();
      if (restored) {
        const msg = `Restored your automatic backup from ${timeStr}.`;
        setRestoreSuccessNotice(msg);
        showToast({ message: msg });
        setTimeout(() => setRestoreSuccessNotice(null), 4000);
      } else {
        const errMsg = 'No valid automatic backup found in this browser.';
        setRestoreError(errMsg);
        showToast({ message: errMsg });
      }
    } catch (e: any) {
      const errMsg = 'Failed to restore automatic backup: ' + e.message;
      setRestoreError(errMsg);
      showToast({ message: errMsg });
    } finally {
      setIsRestoring(false);
    }
  };

  const tabs = ['reminders', 'calendar', 'backup', 'account'] as const;
  const tabIds = ['tab-notifications-btn', 'tab-calendar-btn', 'tab-backup-btn', 'tab-profile-btn'];
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.indexOf(activeTab);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setActiveTab(tabs[next]);
    document.getElementById(tabIds[next])?.focus();
  };
  const pushUnavailable = browserPermission === 'denied' || browserPermission === 'unsupported';
  const pushPermissionMessage = browserPermission === 'denied'
    ? 'Blocked in browser settings. Allow notifications for this site in your browser’s site settings, then reopen Settings.'
    : browserPermission === 'unsupported' ? 'Browser notifications are not supported in this browser.'
    : browserPermission === 'granted' ? 'Native desktop/tab notifications' : 'Click to enable browser permissions';


  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto"
        onClick={handleBackdropClick}
      >
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-modal-title"
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
                <Sliders className="w-5 h-5" />
              </div>
              <div>
                <h2 id="settings-modal-title" className="font-bold text-lg text-slate-900 dark:text-white">
                  Settings
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Reminders, calendar feed, backups
                </p>
              </div>
            </div>
            <button
              id="close-settings-modal-btn"
              onClick={handleRequestClose}
              aria-label="Close settings"
              title="Close settings"
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tab Navigation */}
          <div role="tablist" aria-label="Settings sections" onKeyDown={handleTabKeyDown} className="grid grid-cols-2 sm:flex border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 pt-2 gap-x-4 gap-y-2">
            <button
              id="tab-notifications-btn"
              role="tab"
              aria-selected={activeTab === 'reminders'}
              aria-controls="settings-tab-panel"
              tabIndex={activeTab === 'reminders' ? 0 : -1}
              onClick={() => setActiveTab('reminders')}
              className={`pb-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'reminders'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Bell className="w-4 h-4" />
              Reminders
            </button>
            <button
              id="tab-calendar-btn"
              role="tab"
              aria-selected={activeTab === 'calendar'}
              aria-controls="settings-tab-panel"
              tabIndex={activeTab === 'calendar' ? 0 : -1}
              onClick={() => setActiveTab('calendar')}
              className={`pb-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'calendar'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <CalendarIcon className="w-4 h-4" />
              Calendar
            </button>
            <button
              id="tab-backup-btn"
              role="tab"
              aria-selected={activeTab === 'backup'}
              aria-controls="settings-tab-panel"
              tabIndex={activeTab === 'backup' ? 0 : -1}
              onClick={() => setActiveTab('backup')}
              className={`pb-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'backup'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Database className="w-4 h-4" />
              Backup & export
            </button>
            <button
              id="tab-profile-btn"
              role="tab"
              aria-selected={activeTab === 'account'}
              aria-controls="settings-tab-panel"
              tabIndex={activeTab === 'account' ? 0 : -1}
              onClick={() => setActiveTab('account')}
              className={`pb-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'account'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <UserIcon className="w-4 h-4" />
              Account
            </button>
          </div>

          {/* Modal Body */}
          <div id="settings-tab-panel" role="tabpanel" aria-labelledby={tabIds[tabs.indexOf(activeTab)]} tabIndex={0} className="p-6 overflow-y-auto space-y-6 flex-1 text-sm bg-slate-50/40 dark:bg-slate-950/30">
            {/* 1. Reminders Tab */}
            {activeTab === 'reminders' && (
              <div className="space-y-6">
                {/* Master Switch */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between shadow-xs">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${prefs.enabled ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                      {prefs.enabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                    </div>
                    <div>
                      <h3 id="master-notif-label" className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                        Deadline Reminders System
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {isDemoMode ? 'Demo preview — automatic reminders are paused' : prefs.enabled ? 'Active — tracking course deadlines in America/Vancouver' : 'Paused — no reminder alerts will trigger'}
                      </p>
                    </div>
                  </div>

                  <button
                    id="master-notif-toggle"
                    type="button"
                    role="switch"
                    aria-checked={prefs.enabled}
                    aria-labelledby="master-notif-label"
                    aria-label="Deadline Reminders System"
                    onClick={handleToggleMaster}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer ${
                      prefs.enabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        prefs.enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Delivery Channels on Main Panel (In-App & Browser Push) */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Delivery Channels
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* In-App */}
                    <div
                      onClick={() => handleToggleChannel('inApp')}
                      className={`cursor-pointer border rounded-xl p-3.5 transition-all flex flex-col justify-between ${
                        prefs.channels.inApp
                          ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-800'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 opacity-60'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <Bell className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        <input
                          type="checkbox"
                          checked={prefs.channels.inApp}
                          onChange={() => {}}
                          className="rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">In-App Alerts</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Bell badge & history</p>
                      </div>
                    </div>

                    {/* Browser Push */}
                    <div
                      onClick={pushUnavailable ? undefined : browserPermission === 'granted' ? () => handleToggleChannel('push') : handleRequestPushPermission}
                      className={`cursor-pointer border rounded-xl p-3.5 transition-all flex flex-col justify-between ${
                        prefs.channels.push && browserPermission === 'granted'
                          ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-800'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 opacity-60'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <Smartphone className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                        <input
                          type="checkbox"
                          aria-label="Browser Push"
                          disabled={pushUnavailable}
                          checked={prefs.channels.push && browserPermission === 'granted'}
                          onChange={() => {}}
                          className="rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Browser Push</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {pushPermissionMessage}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Try a reminder</h4>
                  <button
                    id="test-reminder-btn"
                    type="button"
                    onClick={() => handleTestInApp()}
                    className="px-3 py-1.5 text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Bell className="w-3.5 h-3.5" />
                    Send me a 1-hour test reminder
                  </button>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Uses your saved delivery settings. Save any changes before sending a test.</p>
                  {testSentNotice && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400">{testSentNotice}</p>}
                </div>

                {/* Lead Times on Main Panel */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Reminder Timings (Before Deadline)
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {AVAILABLE_LEAD_TIMES.map(lt => {
                      const isSelected = prefs.leadTimes?.includes(lt.minutes) ?? false;
                      return (
                        <button
                          key={lt.minutes}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => handleToggleLeadTime(lt.minutes)}
                          className={`p-2.5 rounded-lg border text-xs font-medium text-left flex items-center justify-between transition-all cursor-pointer ${
                            isSelected
                              ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-semibold'
                              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                          }`}
                        >
                          <span>{lt.label}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-blue-600" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Two Digest Toggles on Main Panel */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold text-xs text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                        Automated Daily & Weekly Digests
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Consolidated summaries grouped by course and upcoming deadlines
                      </p>
                    </div>
                    <button
                      id="preview-digest-btn"
                      type="button"
                      onClick={() => {
                        setShowDigestModal(true);
                      }}
                      aria-expanded={showDigestModal}
                      title="Preview daily and weekly digests"
                      className="px-3 py-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Sparkles className="w-3 h-3" />
                      Preview Digest
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={prefs.digests?.dailyMorning ?? false}
                        onChange={() => handleToggleDigest('dailyMorning')}
                        className="rounded text-blue-600 focus:ring-blue-500 mt-0.5"
                      />
                      <div>
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                          Morning summary
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          Shown in your notification bell at 8:00 AM Vancouver time while the dashboard is open.
                        </p>
                      </div>
                    </label>

                    <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={prefs.digests?.weeklySunday ?? false}
                        onChange={() => handleToggleDigest('weeklySunday')}
                        className="rounded text-blue-600 focus:ring-blue-500 mt-0.5"
                      />
                      <div>
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                          Week Ahead summary
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          Shown in your notification bell Sunday at 6:00 PM Vancouver time while the dashboard is open.
                        </p>
                      </div>
                    </label>
                  </div>

                  {/* Inline Digest Preview */}
                  {showDigestPreview && (
                    <div
                      id="digest-preview-container"
                      className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-lg">
                            <Sparkles className="w-4 h-4" />
                          </div>
                          <div>
                            <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                              Digest Preview (America/Vancouver)
                            </h5>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              In-app notification and summary briefing format
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            id="digest-inline-daily-btn"
                            type="button"
                            onClick={() => setInlineDigestType('daily')}
                            className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer ${
                              inlineDigestType === 'daily'
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                            }`}
                          >
                            Morning (8 AM)
                          </button>
                          <button
                            id="digest-inline-weekly-btn"
                            type="button"
                            onClick={() => setInlineDigestType('weekly')}
                            className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer ${
                              inlineDigestType === 'weekly'
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                            }`}
                          >
                            Week Ahead (Sunday)
                          </button>
                        </div>
                      </div>

                      {/* Preview Box */}
                      <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 space-y-2">
                        <div className="border-b border-slate-200/60 dark:border-slate-800 pb-2">
                          <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                            Subject
                          </span>
                          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                            {inlinePreview.subject.replace(/deliverables?/gi, 'deadlines')}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                            {inlinePreview.title}
                          </p>
                          <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                            {inlinePreview.summaryText.replace(/deliverables?/gi, 'tasks')}
                          </p>
                        </div>

                        {inlinePreview.tasks.length === 0 ? (
                          <div className="py-3 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-md">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto mb-1" />
                            <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                              All clear! No pending tasks due in this window.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-1.5 max-h-48 overflow-y-auto">
                            {inlinePreview.tasks.slice(0, 5).map(task => (
                              <div
                                key={task.task_id}
                                className="p-2 bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 rounded flex items-center justify-between text-xs"
                              >
                                <div className="min-w-0 flex-1 truncate mr-2">
                                  <span className="font-semibold text-blue-600 dark:text-blue-400 mr-1.5">
                                    {task.course || 'Task'}
                                  </span>
                                  <span className="text-slate-800 dark:text-slate-200">
                                    {task.title}
                                  </span>
                                </div>
                                <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                                  {task.due_at ? formatInTimeZone(parseLocalDate(task.due_at) || new Date(), TIMEZONE, 'MMM d • h:mm a') : 'No date'}
                                </span>
                              </div>
                            ))}
                            {inlinePreview.tasks.length > 5 && (
                              <p className="text-[10px] text-slate-400 text-center pt-1">
                                + {inlinePreview.tasks.length - 5} more tasks
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
                        <div className="text-xs">
                          {testSentNotice && (
                            <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {testSentNotice}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            id="inline-dispatch-digest-btn"
                            type="button"
                            onClick={() => {
                              triggerDigest(inlineDigestType);
                              setTestSentNotice(`Sent test ${inlineDigestType === 'daily' ? 'Morning Briefing' : 'Week Ahead Digest'} to Notification Center!`);
                              setTimeout(() => setTestSentNotice(null), 3500);
                            }}
                            className="px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <Bell className="w-3 h-3" />
                            Send test to Notification Bell
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowDigestPreview(false)}
                            className="px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                          >
                            Close Preview
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Advanced Details: Browser Notifications, Quiet Hours, Max-per-day */}
                <details open={isDetailed} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
                  <summary className="font-semibold text-xs text-slate-800 dark:text-slate-200 uppercase tracking-wider cursor-pointer select-none">
                    Advanced
                  </summary>
                  <div className="space-y-4 pt-4 mt-2 border-t border-slate-100 dark:border-slate-800">
                    {/* Browser Notifications */}
                    <div>
                      <h5 className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                        Browser notifications
                      </h5>
                      <div className="flex items-center justify-between p-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-800/30">
                        <div className="flex items-center gap-2.5">
                          <Smartphone className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                          <div>
                            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Browser Push</p>
                            {browserPermission === 'granted' ? (
                              <span className="text-[10px] text-emerald-600 font-medium">Enabled</span>
                            ) : (
                              <button
                                type="button"
                                onClick={handleRequestPushPermission}
                                disabled={pushUnavailable}
                                className="text-[11px] text-blue-600 hover:underline block text-left"
                              >
                                {browserPermission === 'unsupported' ? 'Browser notifications unavailable' : browserPermission === 'denied' ? 'Browser access blocked' : 'Grant browser access'}
                              </button>
                            )}
                            {pushUnavailable && (
                              <p aria-live="polite" className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{pushPermissionMessage}</p>
                            )}
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          aria-label="Browser Push enabled"
                          disabled={browserPermission !== 'granted'}
                          checked={prefs.channels.push && browserPermission === 'granted'}
                          onChange={() => handleToggleChannel('push')}
                          className="rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* Quiet Hours */}
                    <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${(prefs.quietHours?.enabled ?? true) ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                            <Moon className="w-4 h-4" />
                          </div>
                          <div>
                            <h5 className="font-semibold text-xs text-slate-800 dark:text-slate-200">
                              Quiet hours
                            </h5>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              {(prefs.quietHours?.enabled ?? true) ? 'Pause non-urgent reminders; delayed reminders appear when quiet hours end' : 'Disabled — reminders send at all hours'}
                            </p>
                          </div>
                        </div>

                        <button
                          id="quiet-hours-toggle"
                          type="button"
                          role="switch"
                          aria-checked={prefs.quietHours?.enabled ?? true}
                          aria-label="Quiet hours"
                          onClick={() => {
                            setPrefs(prev => ({
                              ...prev,
                              quietHours: {
                                ...prev.quietHours,
                                enabled: !(prev.quietHours?.enabled ?? true),
                                start: prev.quietHours?.start || '23:00',
                                end: prev.quietHours?.end || '08:00'
                              }
                            }));
                          }}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer ${
                            (prefs.quietHours?.enabled ?? true) ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              (prefs.quietHours?.enabled ?? true) ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>

                      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 ${!(prefs.quietHours?.enabled ?? true) ? 'opacity-50 pointer-events-none' : ''}`}>
                        <div>
                          <label htmlFor="quiet-hours-start" className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            Quiet hours start
                          </label>
                          <input
                            id="quiet-hours-start"
                            type="time"
                            value={prefs.quietHours?.start || '23:00'}
                            onChange={e => {
                              const val = e.target.value;
                              setPrefs(prev => ({
                                ...prev,
                                quietHours: {
                                  ...prev.quietHours,
                                  enabled: prev.quietHours?.enabled ?? true,
                                  start: val,
                                  end: prev.quietHours?.end || '08:00'
                                }
                              }));
                            }}
                            className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>

                        <div>
                          <label htmlFor="quiet-hours-end" className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            Quiet hours end
                          </label>
                          <input
                            id="quiet-hours-end"
                            type="time"
                            value={prefs.quietHours?.end || '08:00'}
                            onChange={e => {
                              const val = e.target.value;
                              setPrefs(prev => ({
                                ...prev,
                                quietHours: {
                                  ...prev.quietHours,
                                  enabled: prev.quietHours?.enabled ?? true,
                                  start: prev.quietHours?.start || '23:00',
                                  end: val
                                }
                              }));
                            }}
                            className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Max per day */}
                    <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <label htmlFor="max-per-day-input" className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                            Most reminders per day
                          </label>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Choose 1 to 20 reminders per day. Delayed reminders count when they appear.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            id="max-per-day-input"
                            type="number"
                            min={1}
                            max={20}
                            value={prefs.maxPerDay ?? 5}
                            onChange={e => {
                              const parsed = parseInt(e.target.value, 10);
                              const clamped = isNaN(parsed) ? 1 : Math.max(1, Math.min(20, parsed));
                              setPrefs(prev => ({
                                ...prev,
                                maxPerDay: clamped
                              }));
                            }}
                            className="w-20 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 text-center"
                          />
                          <span className="text-xs text-slate-500 dark:text-slate-400">/ day</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </details>
              </div>
            )}

            {/* 2. Calendar Tab */}
            {activeTab === 'calendar' && (
              <div className="space-y-5">
                {/* Section 2: Add my deadlines to my calendar app */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl shrink-0">
                      <CalendarIcon className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                        Add my deadlines to my calendar app
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Create a private link to subscribe to your assignment deadlines in your calendar app.
                      </p>
                    </div>
                  </div>

                  {/* Timetable & Exam Scope Clarification Note */}
                  <div id="calendar-feed-scope-note" className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-600 dark:text-slate-400 flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">Calendar feed scope (Timetable & Exams):</span> This subscription feed exports assignment deadlines and task items from your active tasks list. Weekly class schedules and exam blocks created strictly within the Timetable view remain local to the timetable and are not included in this .ics feed or notification reminders.
                    </div>
                  </div>

                  {loadingCalendarToken ? (
                    <div className="flex items-center justify-center p-6 text-slate-400 gap-2 text-xs">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Fetching calendar link...</span>
                    </div>
                  ) : calendarToken ? (
                    <div className="space-y-4">
                      {/* Subscription URL Field */}
                      <div>
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                          Private iCal URL
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            readOnly
                            value={calendarFeedUrl}
                            className="flex-1 text-xs px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono select-all"
                          />
                          <button
                            type="button"
                            onClick={handleCopyCalendarUrl}
                            className="px-3.5 py-2.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer shadow-xs"
                          >
                            {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            {copiedLink ? 'Copied!' : 'Copy Link'}
                          </button>
                        </div>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                          🔒 Keep this URL private. Anyone with this link can view your scheduled tasks and deadlines.
                        </p>
                      </div>

                      {/* 1-Click Subscribe Buttons */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                        <a
                          href={googleCalendarSubscribeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-3 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl transition-all flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200 group"
                        >
                          <span className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                            Subscribe with Google Calendar
                          </span>
                          <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 transition-colors" />
                        </a>

                        <a
                          href={webcalUrl}
                          className="p-3 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl transition-all flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200 group"
                        >
                          <span className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                            Subscribe with Apple / Outlook (Webcal)
                          </span>
                          <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-rose-600 transition-colors" />
                        </a>
                      </div>

                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        Once you've subscribed, your calendar app checks for changes every few hours — so a new deadline here shows up on your phone within a few hours, not instantly.
                      </p>

                      {/* Token Revocation / Rotation */}
                      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                        <div className="text-[11px] text-slate-500">
                          Need to invalidate existing links?
                        </div>
                        <button
                          type="button"
                          id="regenerate-calendar-token-btn"
                          onClick={handleRevokeCalendarToken}
                          disabled={loadingCalendarToken || isDemoMode}
                          className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-red-600 hover:bg-red-50 dark:text-slate-400 dark:hover:bg-red-950/30 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <RotateCw className={`w-3.5 h-3.5 ${loadingCalendarToken ? 'animate-spin' : ''}`} />
                          {loadingCalendarToken ? 'Regenerating…' : 'Regenerate Secure Token'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {isDemoMode ? (
                        <div className="p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-800 dark:text-amber-300">
                          <p className="font-semibold">Demo Mode</p>
                          <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                            Calendar feed synchronization is not available in demo mode. Sign in to your account to generate a live calendar feed link.
                          </p>
                        </div>
                      ) : (
                        <button
                          type="button"
                          id="generate-calendar-token-btn"
                          onClick={fetchCalendarToken}
                          disabled={loadingCalendarToken || isDemoMode}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
                        >
                          <Sparkles className="w-4 h-4" />
                          {calendarTokenError ? 'Retry' : 'Create my calendar link'}
                        </button>
                      )}
                    </div>
                  )}

                  {calendarTokenError && (
                    <div role="alert" id="calendar-token-error-notice" className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 p-3 rounded-lg border border-amber-200 dark:border-amber-800 font-medium flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>{calendarTokenError}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 3. Backup & Export Tab */}
            {activeTab === 'backup' && (
              <div className="space-y-5">
                {/* Export Section */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-xl shrink-0">
                      <Archive className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                        Export data
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Download your tasks, courses, timetable entries, and scheduled exams. JSON snapshots also include reminder and display settings; private legacy integration settings and reminder email are excluded.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3 pt-1">
                    <button
                      type="button"
                      onClick={handleExportCSV}
                      className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold flex items-center gap-2 border border-slate-200 dark:border-slate-700 cursor-pointer"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                      Export CSV
                    </button>

                    <button
                      id="download-snapshot-btn"
                      type="button"
                      onClick={handleDownloadBackup}
                      className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer shadow-xs"
                    >
                      <Download className="w-4 h-4" />
                      Download Full Snapshot (.json)
                    </button>

                    <button
                      id="download-codebase-btn"
                      type="button"
                      disabled={isDownloadingCodebase}
                      onClick={() => handleDownloadCodebase('zip')}
                      className="px-4 py-2.5 bg-[#002145] hover:bg-blue-900 text-white rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-60"
                      title="Download full project codebase as a zip package"
                    >
                      <Download className="w-4 h-4 text-blue-300" />
                      {isDownloadingCodebase ? 'Exporting...' : 'Download Codebase (.zip)'}
                    </button>

                    <button
                      id="download-codebase-tar-btn"
                      type="button"
                      disabled={isDownloadingCodebase}
                      onClick={() => handleDownloadCodebase('tar')}
                      className="px-3 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 border border-slate-200 dark:border-slate-700 cursor-pointer disabled:opacity-60"
                      title="Download full project codebase as .tar.gz"
                    >
                      <Archive className="w-4 h-4 text-slate-500" />
                      .tar.gz
                    </button>
                  </div>

                  {downloadSuccessNotice && (
                    <div role="status" id="download-snapshot-success-notice" className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{downloadSuccessNotice}</span>
                    </div>
                  )}
                </div>

                {/* Restore from file */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl shrink-0">
                      <Upload className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                        Restore from file
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Upload a previously exported JSON backup file to restore or merge your records.
                      </p>
                    </div>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,application/json"
                    onChange={handleFileUpload}
                    className="hidden"
                  />

                  {!pendingRestoreBackup ? (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-blue-500 rounded-xl p-6 flex flex-col items-center justify-center gap-2 text-slate-600 dark:text-slate-400 hover:text-blue-600 transition-colors cursor-pointer bg-slate-50/50 dark:bg-slate-800/30"
                    >
                      <Upload className="w-6 h-6 text-slate-400" />
                      <span className="text-xs font-semibold">Click to select backup .json file</span>
                      <span className="text-[11px] text-slate-400">Supports standard My LMS backup archives</span>
                    </button>
                  ) : (
                    <div className="p-4 bg-blue-50/60 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-xl space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-blue-900 dark:text-blue-200">
                          Backup File Inspected
                        </span>
                        <button
                          type="button"
                          onClick={() => setPendingRestoreBackup(null)}
                          className="text-xs text-slate-400 hover:text-slate-600"
                        >
                          Cancel
                        </button>
                      </div>

                      <div className="grid grid-cols-4 gap-2 text-center">
                        <div className="bg-white dark:bg-slate-800 p-2 rounded-lg border border-blue-100 dark:border-blue-900">
                          <span className="text-base font-bold text-slate-800 dark:text-white block">
                            {pendingRestoreBackup.data.tasks?.filter(t => !isTaskAnnouncement(t)).length || 0}
                          </span>
                          <span className="text-[10px] text-slate-400 uppercase font-semibold">Tasks</span>
                        </div>
                        <div className="bg-white dark:bg-slate-800 p-2 rounded-lg border border-blue-100 dark:border-blue-900">
                          <span className="text-base font-bold text-slate-800 dark:text-white block">
                            {pendingRestoreBackup.data.courses?.length || 0}
                          </span>
                          <span className="text-[10px] text-slate-400 uppercase font-semibold">Courses</span>
                        </div>
                        <div className="bg-white dark:bg-slate-800 p-2 rounded-lg border border-blue-100 dark:border-blue-900">
                          <span className="text-base font-bold text-slate-800 dark:text-white block">
                            {pendingRestoreBackup.data.classes?.length || 0}
                          </span>
                          <span className="text-[10px] text-slate-400 uppercase font-semibold">Classes</span>
                        </div>
                        <div className="bg-white dark:bg-slate-800 p-2 rounded-lg border border-blue-100 dark:border-blue-900">
                          <span className="text-base font-bold text-slate-800 dark:text-white block">
                            {pendingRestoreBackup.data.exams?.length || 0}
                          </span>
                          <span className="text-[10px] text-slate-400 uppercase font-semibold">Exams</span>
                        </div>
                      </div>

                      <div className="space-y-2 pt-2">
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                          Restore Strategy:
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setRestoreMode('merge')}
                            className={`p-2.5 rounded-lg border text-xs font-semibold text-left transition-all cursor-pointer ${
                              restoreMode === 'merge'
                                ? 'border-blue-600 bg-blue-100/70 text-blue-900 dark:bg-blue-900/60 dark:text-white'
                                : 'border-slate-200 bg-white text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:bg-slate-800 dark:border-slate-700'
                            }`}
                          >
                            Merge (Safe)
                            <span className="block font-normal text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                              Keep existing items & add missing
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setRestoreMode('replace')}
                            className={`p-2.5 rounded-lg border text-xs font-semibold text-left transition-all cursor-pointer ${
                              restoreMode === 'replace'
                                ? 'border-amber-600 bg-amber-100/70 text-amber-900 dark:bg-amber-900/60 dark:text-white'
                                : 'border-slate-200 bg-white text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:bg-slate-800 dark:border-slate-700'
                            }`}
                          >
                            Replace All
                            <span className="block font-normal text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                              Overwrite current records with file
                            </span>
                          </button>
                        </div>
                      </div>

                      <div className="pt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={handleExecuteRestore}
                          disabled={isRestoring || (restoreMode === 'replace' && (pendingRestoreBackup?.data?.tasks?.length || 0) === 0)}
                          className="px-5 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                          {isRestoring ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                          Confirm & Restore Snapshot
                        </button>
                      </div>
                    </div>
                  )}

                  {restoreSuccessNotice && (
                    <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{restoreSuccessNotice}</span>
                    </div>
                  )}

                  {restoreError && (
                    <div role="alert" className="p-3 bg-red-50 text-red-800 border border-red-200 rounded-xl text-xs flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                      <span>{restoreError}</span>
                    </div>
                  )}
                </div>

                {/* Recover Checkpoint / Restore last auto-save */}
                <div className="bg-slate-100/70 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <History className="w-5 h-5 text-slate-500" />
                    <div>
                      <h4 className="font-semibold text-xs text-slate-800 dark:text-slate-200">
                        Automatic local backup
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {latestCheckpointDate ? `Last saved in this browser on ${latestCheckpointDate} — Restore this backup` : 'No local backup yet — one is saved the next time you change something'}
                      </p>
                    </div>
                  </div>

                  <button
                    id="recover-checkpoint-btn"
                    type="button"
                    onClick={handleRestoreLatestCheckpoint}
                    disabled={isRestoring || !latestCheckpointDate}
                    className="px-3 py-1.5 text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                  >
                    Restore last automatic backup
                  </button>
                </div>
              </div>
            )}

            {/* 4. Account Tab */}
            {activeTab === 'account' && (
              <div className="space-y-4">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg shadow-xs">
                      {(user?.displayName || user?.email || 'General')[0].toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-bold text-base text-slate-900 dark:text-white">
                        {user?.displayName || 'Student'}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {user?.email || (isDemoMode ? 'demo@example.com' : 'Signed In')}
                      </p>
                    </div>
                  </div>

                  {/* Account state banner */}
                  {isDemoMode ? (
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-800 dark:text-amber-300 font-medium flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Account: Demo (sample data, not saved)</span>
                    </div>
                  ) : (
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-300 font-medium flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>Account: Signed in</span>
                    </div>
                  )}

                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-100 dark:border-slate-800">
                    <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">Where your data is saved</h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                      {isDemoMode ? 'Demo only — nothing is saved' : 'Saved to your Google account'}
                    </p>
                  </div>

                  {/* Dashboard View Mode Preference */}
                  <ViewModeToggle variant="settings" />

                  {/* PWA Install in Settings > Profile */}
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/60">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-2">
                      Install app
                    </span>
                    <PWAInstallButton
                      variant="outline"
                      className="w-full justify-center"
                      showDismissibleHint={true}
                    />
                  </div>

                  {/* Sync Status & Manual Sync */}
                  {!isDemoMode && (
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                          How syncing works
                        </span>
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-0.5 flex items-center gap-1.5">
                          <RefreshCw size={13} className={isSyncing ? "animate-spin text-blue-600" : "text-slate-400"} />
                          <span>Last synced {lastSync ? formatInTimeZone(lastSync, TIMEZONE, 'h:mm:ss a') : 'Live'}</span>
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {!isOnline ? 'Offline: changes saved locally' : hasPendingWrites ? 'Syncing changes to cloud...' : 'Up to date with cloud storage'}
                        </p>
                      </div>
                      <button
                        type="button"
                        id="sync-now-btn"
                        onClick={handleSyncNow}
                        disabled={isSyncing || !isOnline}
                        className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 shadow-xs cursor-pointer shrink-0"
                      >
                        <RefreshCw size={13} className={isSyncing ? "animate-spin" : ""} />
                        <span>{isSyncing ? 'Syncing...' : 'Sync now'}</span>
                      </button>
                    </div>
                  )}

                  {/* Vancouver time notice */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-100 dark:border-slate-800">
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      All times shown in: Vancouver
                    </p>
                  </div>
                  {/* Account / Preferences Save button */}
                  <div className="pt-2 flex justify-end">
                    <button
                      id="account-tab-save-btn"
                      type="button"
                      onClick={handleSave}
                      disabled={isSaving}
                      className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                    >
                      {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Save Preferences
                    </button>
                  </div>

                  {/* Danger Zone: Data Management & Account Deletion (V3-233) */}
                  <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
                    <div className="flex items-center gap-2">
                      <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
                        Data Management & Account Deletion
                      </h4>
                    </div>

                    <div className="p-4 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                          <h5 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                            Delete All My Data
                          </h5>
                          <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 max-w-md">
                            Permanently purge all your tasks, courses, timetable schedules, exams, group memberships, and revoke active calendar subscription feed links without deleting your login account.
                          </p>
                        </div>
                        <button
                          id="delete-all-data-btn"
                          type="button"
                          onClick={handleDeleteAllData}
                          disabled={isDeletingData || isDeletingAccount}
                          className="px-3.5 py-2 text-xs font-semibold bg-white dark:bg-slate-900 border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors shadow-xs flex items-center justify-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
                        >
                          {isDeletingData ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          Delete all my data
                        </button>
                      </div>

                      <div className="pt-3 border-t border-red-200/60 dark:border-red-900/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                          <h5 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                            Delete Account
                          </h5>
                          <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 max-w-md">
                            Permanently delete your account authentication, profile record, and cascade-delete all stored cloud and timetable data. This action is irreversible.
                          </p>
                        </div>
                        <button
                          id="delete-account-btn"
                          type="button"
                          onClick={handleDeleteAccount}
                          disabled={isDeletingData || isDeletingAccount}
                          className="px-3.5 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors shadow-xs flex items-center justify-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
                        >
                          {isDeletingAccount ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                          Delete account
                        </button>
                      </div>
                    </div>

                    {/* Data Retention & Privacy Policy Disclosure */}
                    <div id="data-retention-policy-disclosure" className="p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 space-y-1.5">
                      <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200">
                        <ShieldAlert className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                        <span>Data Retention & Privacy Policy</span>
                      </div>
                      <p className="text-[11px] leading-relaxed">
                        <strong>Storage & Retention:</strong> User-authored tasks, timetable entries, and course records are stored securely in your private user partition while your account is active. When you delete your data or account, all tasks, courses, timetable schedules, exam records, and private calendar feed tokens are immediately purged and revoked. Inactive accounts retain data for up to 12 months before being permanently expunged.
                      </p>
                      <p className="text-[11px] leading-relaxed">
                        <strong>Support:</strong> Contact the owner of this deployment for account or privacy help.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 flex items-center justify-between">
            <div>
              {saveMessage && (
                <span role={saveFailed ? 'alert' : 'status'} className={`text-xs font-semibold flex items-center gap-1 ${saveFailed ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}`}>
                  {saveFailed ? <AlertCircle className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  {saveMessage}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                id="cancel-settings-btn"
                onClick={handleCancel}
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              >
                Close
              </button>
              {hasUnsavedChanges && (
                <span id="unsaved-changes-indicator" className="text-xs text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1.5 mr-1">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse inline-block" />
                  Unsaved changes
                </span>
              )}
              <button
                  id="save-settings-btn"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Save Preferences
                </button>
            </div>
          </div>
        </div>
      </div>

      {/* Digest Preview Modal */}
      <DigestPreviewModal
        isOpen={showDigestModal}
        onClose={() => {
          setShowDigestModal(false);
          setShowDigestPreview(false);
        }}
        tasks={tasks}
        onTriggerTestDigest={(type) => {
          triggerDigest(type);
          setShowDigestModal(false);
          setShowDigestPreview(false);
          setTestSentNotice(`Sent test ${type === 'daily' ? 'Morning Briefing' : 'Week Ahead Digest'} to Notification Center!`);
          setTimeout(() => setTestSentNotice(null), 3500);
        }}
      />
    </>
  );
}
