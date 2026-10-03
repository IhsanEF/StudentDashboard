import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import React from 'react';
import { useTasksContext } from '../hooks/useTasks';
import { TabType, AppUser, SIMPLE_TABS, MORE_TABS } from '../types';
import { 
  LayoutDashboard, Flame, CheckSquare, BookOpen, TrendingUp, Award, Bell, 
  Calendar as CalendarIcon, LogOut, Download, AlertTriangle, 
  Sparkles, WifiOff, CloudUpload, Shield, Sliders, Users, Inbox, 
  Menu, X, Smartphone, GraduationCap, ChevronDown, RotateCw, Plus, ArrowLeft
} from 'lucide-react';
import { cn, formatInTimeZone, TIMEZONE } from '../utils';
import PrivacyModal from './PrivacyModal';
import ErrorBoundary from './ErrorBoundary';
import NotificationCenter from './NotificationCenter';
import SettingsModal from './SettingsModal';
import EditTaskModal from './EditTaskModal';
import AddTaskModal from './AddTaskModal';
import FloatingFocusTimer from './FloatingFocusTimer';
import ReviewInboxModal from './ReviewInboxModal';
import { PWAInstallButton } from './PWAInstallButton';
import { OfflineIndicator } from './OfflineIndicator';
import { ToastHost } from './ToastHost';
import { ViewModeToggle } from './ViewModeToggle';
import JustOneThingView from './JustOneThingView';
import { auth } from '../auth';
import { useModalFocus } from '../hooks/useModalFocus';

const SmartImportModal = lazy(() => import('./SmartImportModal'));

export default function DashboardLayout({ children, activeTab, onTabChange, user }: { children: React.ReactNode, activeTab: TabType, onTabChange: (t: TabType) => void, user: AppUser | null }) {
  const { tasks, now, lastSync, refreshTasks, loading, error, isDemoMode, disableDemoMode, isOnline, hasPendingWrites, logout, exportToCSV, uiPrefs, setViewMode, updateUiPrefs, showToast, toast, focusModeActive, setFocusModeActive, openImport, isImportOpen, importInitialTab, closeImport } = useTasksContext();
  const [demoNoticeDismissed, setDemoNoticeDismissed] = useState(false);
  useEffect(() => setDemoNoticeDismissed(false), [isDemoMode]);
  const [notificationResetKey, setNotificationResetKey] = useState(0);
  const [timerDismissed, setTimerDismissed] = useState(false);
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const actionsButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isActionsOpen) return;
    const outside = (event: MouseEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) setIsActionsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsActionsOpen(false);
        actionsButtonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [isActionsOpen]);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [hasOpenedImport, setHasOpenedImport] = useState(false);
  useEffect(() => {
    if (isImportOpen) setHasOpenedImport(true);
  }, [isImportOpen]);
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isReviewInboxOpen, setIsReviewInboxOpen] = useState(false);
  const [isMobileMoreOpen, setIsMobileMoreOpen] = useState(false);
  const { modalRef: mobileMoreRef } = useModalFocus({
    isOpen: isMobileMoreOpen, onClose: () => setIsMobileMoreOpen(false)
  });
  const [selectedTaskForEditId, setSelectedTaskForEditId] = useState<string | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>('');
  useEffect(() => {
    setLiveAnnouncement(`${activeTab} page`);
  }, [activeTab]);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setIsAddMenuOpen(false);
      }
    }
    if (isAddMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isAddMenuOpen]);

  // Sync toast messages and app announcements into persistent role="status" live region
  useEffect(() => {
    if (toast?.message) {
      setLiveAnnouncement(toast.message);
    }
  }, [toast]);

  // Support direct app-announce events and global announce helper
  useEffect(() => {
    const handleAnnounce = (e: Event) => {
      const customEvent = e as CustomEvent<{ message?: string } | string>;
      const detail = customEvent.detail;
      const msg = typeof detail === 'string' ? detail : detail?.message;
      if (msg) {
        setLiveAnnouncement(msg);
      }
    };
    window.addEventListener('app-announce', handleAnnounce);
    
    // Register global announce helper if not already defined
    if (typeof window !== 'undefined') {
      (window as any).announce = (message: string) => {
        window.dispatchEvent(new CustomEvent('app-announce', { detail: message }));
      };
    }

    return () => {
      window.removeEventListener('app-announce', handleAnnounce);
    };
  }, []);

  const pendingReviewCount = tasks.filter(t => !t.demo_seed && (t.needs_review || !!t.canvas_date_diff)).length;
  const selectedTaskForEdit = selectedTaskForEditId ? tasks.find(t => t.task_id === selectedTaskForEditId) : null;
  useEffect(() => {
    if (selectedTaskForEditId !== null && !selectedTaskForEdit && !loading) {
      setSelectedTaskForEditId(null);
      showToast({ message: 'This task no longer exists' });
    }
  }, [selectedTaskForEditId, selectedTaskForEdit, loading, showToast]);

  const [isExportingPackage, setIsExportingPackage] = useState(false);
  const handleDownloadCodePackage = async () => {
    try {
      setIsExportingPackage(true);
      showToast({ message: 'Preparing full app package download (.zip)...' });
      const response = await fetch('/api/export-app-package');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = 'ubc-study-flow-codebase.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      showToast({ message: 'Full app package downloaded successfully (.zip)!' });
    } catch {
      window.location.href = '/api/export-app-package';
    } finally {
      setIsExportingPackage(false);
    }
  };

  // Refresh data automatically when the window regains focus (debounced to once per 60 seconds)
  const lastFocusRefreshRef = useRef<number>(Date.now());
  useEffect(() => {
    const handleFocus = () => {
      const now = Date.now();
      if (now - lastFocusRefreshRef.current >= 60000) {
        lastFocusRefreshRef.current = now;
        refreshTasks();
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refreshTasks]);

  // Detailed: nine flat items in this exact order:
  // Overview, Tasks, Courses, Grades, Timetable, Workload, Groups, Progress, Announcements
  const detailedNavItems: { label: TabType; icon: any }[] = [
    { label: 'Overview', icon: LayoutDashboard },
    { label: 'Tasks', icon: CheckSquare },
    { label: 'Courses', icon: BookOpen },
    { label: 'Grades', icon: Award },
    { label: 'Timetable', icon: CalendarIcon },
    { label: 'Workload', icon: Flame },
    { label: 'Groups', icon: Users },
    { label: 'Progress', icon: TrendingUp },
    { label: 'Announcements', icon: Bell },
  ];

  // Simple: first four essential items matching Detailed
  const simpleNavItems: { label: TabType; icon: any }[] = [
    { label: 'Overview', icon: LayoutDashboard },
    { label: 'Tasks', icon: CheckSquare },
    { label: 'Courses', icon: BookOpen },
    { label: 'Grades', icon: Award },
  ];

  // Simple: remaining five items inside "More tools" fold:
  // Workload, Timetable, Groups, Progress, Announcements
  const moreNavItems: { label: TabType; icon: any; desc: string }[] = [
    { label: 'Workload', icon: Flame, desc: 'Weekly workload outlook & crunch detection' },
    { label: 'Timetable', icon: CalendarIcon, desc: 'Weekly classes and exam clash check' },
    { label: 'Groups', icon: Users, desc: 'Shared task board for group projects' },
    { label: 'Progress', icon: TrendingUp, desc: "How much you've finished, by course" },
    { label: 'Announcements', icon: Bell, desc: "Canvas announcements you've pasted in" },
  ];

  const isSimpleView = (uiPrefs.viewMode || 'simple') === 'simple';
  const isCurrentTabMore = (MORE_TABS as readonly TabType[]).includes(activeTab);
  const isMoreToolsOpen = Boolean(uiPrefs.moreToolsOpen || isCurrentTabMore);

  // Mobile bottom bar in BOTH views: Overview, Tasks, Courses, Grades, More
  const mobilePrimaryTabs: { label: TabType; icon: any; desc?: string }[] = [
    { label: 'Overview', icon: LayoutDashboard },
    { label: 'Tasks', icon: CheckSquare },
    { label: 'Courses', icon: BookOpen },
    { label: 'Grades', icon: Award, desc: 'Weighted grades & what-you-need-on-the-final calculator' },
  ];

  // Mobile More sheet lists the remaining five under "More tools"
  const mobileSecondaryTabs = moreNavItems;

  const isCurrentTabSecondary = mobileSecondaryTabs.some(t => t.label === activeTab);

  const userInitials = (user?.displayName || user?.email || 'TM')
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  const scrollerRef = useRef<HTMLDivElement>(null);

  // Reset scroll offset on tab change so new tab never opens mid-page
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTo(0, 0);
    }
    window.scrollTo(0, 0);
  }, [activeTab]);

  const handleMobileNav = (tab: TabType) => {
    onTabChange(tab);
    setIsMobileMoreOpen(false);
    if (scrollerRef.current) {
      scrollerRef.current.scrollTo(0, 0);
    }
    window.scrollTo(0, 0);
  };

  const isFocusModeActive = focusModeActive;
  const hasAuthenticatedSession = !!auth.currentUser;
  const handleLeaveDemo = () => {
    if (auth.currentUser) {
      // The provider offers confirmation, export and return to the signed-in account.
      disableDemoMode();
    } else if (window.confirm('Leave demo? Demo data will be discarded. You will return to sign-in.')) {
      logout();
    }
  };

  const isAnyModalOpen = isQuickAddOpen || 
    isImportOpen || 
    isPrivacyModalOpen || 
    isSettingsOpen || 
    isReviewInboxOpen || 
    !!selectedTaskForEditId || 
    isMobileMoreOpen;

  return (
    <div className="h-screen h-dvh overflow-hidden bg-[#f8fafc] text-slate-800 font-sans flex flex-col md:flex-row">
      <a
        href="#main-content"
        onClick={event => {
          event.preventDefault();
          document.getElementById('dashboard-content')?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-white focus:p-3 focus:text-slate-900 focus:shadow-lg"
      >
        Skip to main content
      </a>
      
      {/* Desktop & Tablet Sidebar */}
      {!isFocusModeActive && (
        <nav 
          aria-label="Sidebar navigation"
          className="hidden md:flex flex-col w-60 lg:w-64 bg-[#002145] text-white shrink-0 z-30 select-none border-r border-white/10 h-screen h-dvh max-h-dvh sticky top-0"
        >
        {/* Header Branding */}
        <div className="flex items-center gap-3 p-5 border-b border-white/10">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shrink-0">
            <GraduationCap size={20} className="text-yellow-300" />
          </div>
          <div>
            <h1 className="text-base font-black tracking-tight leading-tight">UBC Student</h1>
            <p className="text-[10px] text-blue-200 uppercase tracking-widest font-bold">Dashboard</p>
          </div>
        </div>

        {/* View Mode Switcher (Simple vs Detailed) */}
        <div className="px-3 pt-3 pb-1">
          <ViewModeToggle variant="sidebar" />
        </div>

        {/* Navigation items */}
        <div className="flex-1 py-3 px-3 space-y-1 overflow-y-auto">
          {isSimpleView ? (
            <>
              {/* Core Essential Navigation */}
              {simpleNavItems.map(item => {
                const Icon = item.icon;
                const isActive = activeTab === item.label;
                return (
                  <button
                    key={item.label}
                    onClick={() => onTabChange(item.label)}
                    aria-label={item.label}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "w-full flex items-center justify-between py-2.5 px-3.5 rounded-xl text-xs lg:text-sm font-medium transition-all cursor-pointer min-h-[44px]",
                      isActive 
                        ? "bg-white/15 font-bold text-white shadow-xs" 
                        : "text-blue-100 hover:bg-white/5 hover:text-white"
                    )}
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      <Icon size={18} className={cn("shrink-0", isActive ? "text-white" : "text-blue-200")} />
                      <span className="truncate">{item.label}</span>
                    </div>
                    {item.label === 'Tasks' && pendingReviewCount > 0 && (
                      <span 
                        title={`${pendingReviewCount} imported item${pendingReviewCount === 1 ? '' : 's'} to check`}
                        className="ml-auto px-1.5 py-0.5 text-xs font-bold rounded-full bg-amber-400 text-slate-900 shrink-0 shadow-xs"
                      >
                        {pendingReviewCount}
                      </span>
                    )}
                  </button>
                );
              })}

              {/* Collapsible More tools fold */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => updateUiPrefs({ moreToolsOpen: !uiPrefs.moreToolsOpen })}
                  aria-expanded={isMoreToolsOpen}
                  className="w-full flex items-center justify-between px-3.5 py-2 text-xs font-semibold text-blue-200 hover:text-white hover:bg-white/5 rounded-xl transition-colors cursor-pointer"
                >
                  <span className="uppercase tracking-wider text-[10px] text-blue-300 font-bold">
                    More tools
                  </span>
                  <ChevronDown
                    size={14}
                    className={cn(
                      "transition-transform duration-200 text-blue-300",
                      isMoreToolsOpen && "rotate-180"
                    )}
                  />
                </button>

                {isMoreToolsOpen && (
                  <div className="mt-1 space-y-1 pl-1">
                    {moreNavItems.map(item => {
                      const Icon = item.icon;
                      const isActive = activeTab === item.label;
                      return (
                        <button
                          key={item.label}
                          onClick={() => onTabChange(item.label)}
                          aria-label={item.label}
                          aria-current={isActive ? "page" : undefined}
                          className={cn(
                            "w-full flex items-center space-x-3 py-2 px-3 rounded-xl text-xs lg:text-sm font-medium transition-all cursor-pointer min-h-[40px]",
                            isActive 
                              ? "bg-white/15 font-bold text-white shadow-xs" 
                              : "text-blue-100 hover:bg-white/5 hover:text-white"
                          )}
                        >
                          <Icon size={16} className={cn("shrink-0", isActive ? "text-white" : "text-blue-200")} />
                          <span className="truncate">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            detailedNavItems.map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.label;
              return (
                <button
                  key={item.label}
                  onClick={() => onTabChange(item.label)}
                  aria-label={item.label}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "w-full flex items-center justify-between py-2.5 px-3.5 rounded-xl text-xs lg:text-sm font-medium transition-all cursor-pointer min-h-[44px]",
                    isActive 
                      ? "bg-white/15 font-bold text-white shadow-xs" 
                      : "text-blue-100 hover:bg-white/5 hover:text-white"
                  )}
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <Icon size={18} className={cn("shrink-0", isActive ? "text-white" : "text-blue-200")} />
                    <span className="truncate">{item.label}</span>
                  </div>
                  {item.label === 'Tasks' && pendingReviewCount > 0 && (
                    <span 
                      title={`${pendingReviewCount} imported item${pendingReviewCount === 1 ? '' : 's'} to check`}
                      className="ml-auto px-1.5 py-0.5 text-xs font-bold rounded-full bg-amber-400 text-slate-900 shrink-0 shadow-xs"
                    >
                      {pendingReviewCount}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
        
        {/* Bottom User Profile Section */}
        <div className="p-3.5 m-3 bg-white/5 rounded-2xl border border-white/10 mt-auto space-y-2.5 shrink-0">
          <div className="flex items-center space-x-2.5">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full border border-white/20 shrink-0" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-[#E8AF10] flex items-center justify-center text-[#002145] font-bold text-xs shrink-0">
                {userInitials}
              </div>
            )}
            <div className="flex-1 overflow-hidden">
              <p className="text-xs font-semibold truncate text-white" title={user?.displayName || user?.email || undefined}>
                {user?.displayName || user?.email}
              </p>
              <p title={user?.email || undefined} className="text-xs text-blue-300 truncate">{user?.email}</p>
            </div>
            <button
              onClick={() => setIsSettingsOpen(true)}
              aria-label="Settings"
              className="text-blue-200 hover:text-white transition-colors p-1.5 hover:bg-white/10 rounded-lg cursor-pointer"
              title="Settings"
            >
              <Sliders size={16} />
            </button>
          </div>

          <button
            type="button"
            onClick={logout}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-blue-200 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer border border-white/10"
          >
            <LogOut size={16} />
            <span>Sign out</span>
          </button>

          <PWAInstallButton variant="outline" className="w-full" />

          <button
            type="button"
            onClick={exportToCSV}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-blue-200 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer border border-white/10"
          >
            <Download size={12} />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={() => setIsPrivacyModalOpen(true)}
            aria-label="Privacy & AI"
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-blue-200 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer border border-white/10"
          >
            <Shield size={12} />
            <span>Privacy & AI</span>
          </button>

          <button
            type="button"
            id="sidebar-export-codebase-btn"
            onClick={handleDownloadCodePackage}
            disabled={isExportingPackage}
            aria-label="Export Full App Package"
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-emerald-200 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer border border-white/10 mt-1.5 disabled:opacity-60"
            title="Download full project codebase as .zip"
          >
            <Download size={12} />
            <span>{isExportingPackage ? 'Exporting...' : 'Export Codebase (.zip)'}</span>
          </button>
        </div>
      </nav>
      )}

      {/* Main Content Area */}
      <main id="main-content" tabIndex={-1} className={cn(
        "flex-1 flex flex-col min-w-0 min-h-0 bg-[#f8fafc] overflow-hidden h-full max-h-full",
        !isFocusModeActive && "pb-[calc(4.75rem+env(safe-area-inset-bottom,0px))] md:pb-0"
      )}>
        
        {/* Header */}
        <header className="h-[calc(4rem+env(safe-area-inset-top,0px))] pt-[env(safe-area-inset-top,0px)] bg-white border-b border-slate-200 px-3 sm:px-6 md:px-8 flex items-center justify-between shrink-0 sticky top-0 z-40 gap-2">
          {/* Left Title & Date group - preserved width, never shrinks to 0px */}
          <div className="flex flex-1 items-center gap-2 min-w-0 pr-1 sm:pr-2">
            <div className="flex flex-col min-w-0">
              <h1 className="text-sm sm:text-base md:text-lg font-bold text-slate-800 truncate leading-tight">
                {isFocusModeActive ? 'Focus on one task' : activeTab}
              </h1>
              <p className="text-[10px] sm:text-xs text-slate-500 font-medium truncate leading-tight">
                <span className="sm:hidden">{formatInTimeZone(now, TIMEZONE, 'EEE, MMM d')}</span>
                <span className="hidden sm:inline">{formatInTimeZone(now, TIMEZONE, 'EEEE, MMM d, yyyy')}</span>
              </p>
            </div>
          </div>

          {/* Compact header actions; disclosures can extend beyond the header */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 py-1 justify-end">
            {isFocusModeActive ? (
              <button
                type="button"
                onClick={() => setFocusModeActive(false)}
                className="inline-flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition-all shadow-xs cursor-pointer min-h-[44px]"
              >
                <ArrowLeft size={16} />
                <span>Exit Focus on one task</span>
              </button>
            ) : (
              <>
            {/* Quick Add with '+' menu: Add task / Import from Canvas */}
            <div className="relative shrink-0" ref={addMenuRef}>
              <button
                type="button"
                id="header-quick-add-btn"
                onClick={() => setIsAddMenuOpen(prev => !prev)}
                aria-label="Add or import"
                aria-haspopup="menu"
                aria-expanded={isAddMenuOpen}
                className="inline-flex items-center justify-center gap-1.5 bg-[#002145] hover:bg-blue-900 text-white text-xs font-bold px-3 py-2 rounded-xl transition-all shadow-xs cursor-pointer min-h-[44px]"
                title="Add task or import coursework"
              >
                <Plus size={16} />
                <span>Add</span>
                <ChevronDown size={14} className={cn("transition-transform duration-150", isAddMenuOpen && "rotate-180")} />
              </button>

              {isAddMenuOpen && (
                <div 
                  role="menu"
                  aria-orientation="vertical"
                  className="absolute right-0 mt-1.5 w-48 bg-white rounded-xl border border-slate-200 shadow-xl z-50 py-1.5 animate-in fade-in zoom-in-95 duration-100"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      setIsQuickAddOpen(true);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors text-left cursor-pointer min-h-[44px]"
                  >
                    <Plus size={16} className="text-blue-600 shrink-0" />
                    <span>Add task</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      openImport();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors text-left cursor-pointer min-h-[44px]"
                  >
                    <Sparkles size={16} className="text-amber-500 shrink-0" />
                    <span>Import</span>
                  </button>
                </div>
              )}
            </div>

            {/* Header Sync Status Indicator */}
            <div 
              id="header-sync-status"
              className={cn(
                "hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition-colors",
                isDemoMode 
                  ? "bg-amber-50 text-amber-900 border border-amber-200" 
                  : hasPendingWrites 
                    ? "bg-blue-50 text-blue-700 border border-blue-200" 
                    : "bg-slate-100 text-slate-700 border border-slate-200"
              )}
              title={isDemoMode ? "NOT SAVED / Demo data only — changes are stored in memory only and will not be saved" : hasPendingWrites ? "Changes are still being saved" : lastSync ? `Last saved update received on ${formatInTimeZone(lastSync, TIMEZONE, 'MMM d, yyyy, h:mm a zzz')}` : "No saved update has been received yet"}
            >
              <span className={cn("w-2 h-2 rounded-full shrink-0", isDemoMode ? "bg-amber-500" : hasPendingWrites ? "bg-blue-500 animate-pulse" : "bg-emerald-500")} />
              <span className="whitespace-nowrap font-medium">
                {isDemoMode 
                  ? 'Demo - not saved'
                  : hasPendingWrites 
                    ? 'Saving...' 
                    : lastSync ? `Last saved ${formatInTimeZone(lastSync, TIMEZONE, 'h:mm a')}` : 'Awaiting saved data'}
              </span>
            </div>

            {/* Notification Center Bell (badge only when unread, includes review inbox count) - anchored to viewport on mobile to prevent clipping */}
            <div className="relative shrink-0 [&_#notification-dropdown-panel]:fixed [&_#notification-dropdown-panel]:inset-x-4 [&_#notification-dropdown-panel]:top-16 [&_#notification-dropdown-panel]:w-auto [&_#notification-dropdown-panel]:max-w-[calc(100vw-2rem)] sm:[&_#notification-dropdown-panel]:absolute sm:[&_#notification-dropdown-panel]:inset-x-auto sm:[&_#notification-dropdown-panel]:right-0 sm:[&_#notification-dropdown-panel]:top-auto sm:[&_#notification-dropdown-panel]:w-96 sm:[&_#notification-dropdown-panel]:max-w-none">
              <ErrorBoundary key={notificationResetKey} isDemoMode={isDemoMode} fallbackTitle="Notifications unavailable" onReset={() => setNotificationResetKey(key => key + 1)}>
              <NotificationCenter
                onOpenSettings={() => setIsSettingsOpen(true)}
                onOpenTaskDetails={(taskId) => setSelectedTaskForEditId(taskId)}
                onOpenReviewInbox={() => setIsReviewInboxOpen(true)}
                pendingReviewCount={pendingReviewCount}
              />
              </ErrorBoundary>
            </div>

            <div ref={actionsRef} className="relative shrink-0">
              <button
                ref={actionsButtonRef}
                type="button"
                aria-label="More actions"
                aria-expanded={isActionsOpen}
                aria-controls="header-actions"
                onClick={() => setIsActionsOpen(open => !open)}
                className="flex items-center gap-1.5 min-h-[44px] min-w-[44px] justify-center px-2 rounded-xl text-slate-700 hover:bg-slate-100 text-xs font-semibold"
              >
                <Menu size={18} />
                <span className="hidden sm:inline">More</span>
              </button>
              {isActionsOpen && (
                <div id="header-actions" className="absolute right-0 mt-1.5 w-48 bg-white rounded-xl border border-slate-200 shadow-xl z-50 p-1.5">
                  <button type="button" onClick={() => { setIsActionsOpen(false); exportToCSV(); }} className="w-full flex items-center gap-2 p-3 min-h-[44px] text-xs text-slate-700 hover:bg-slate-50 rounded-lg">
                    <Download size={16} /> Export CSV
                  </button>
                  <button type="button" aria-label="Refresh" disabled={loading} onClick={() => { setIsActionsOpen(false); refreshTasks(); }} className="w-full flex items-center gap-2 p-3 min-h-[44px] text-xs text-slate-700 hover:bg-slate-50 rounded-lg disabled:opacity-60">
                    <RotateCw size={16} /> Refresh
                  </button>
                  {isDemoMode && (
                    <button type="button" onClick={() => { setIsActionsOpen(false); handleLeaveDemo(); }} aria-label={hasAuthenticatedSession ? 'Exit demo' : 'Leave demo'} title="Exit demo (data will be discarded)" className="w-full flex items-center gap-2 p-3 min-h-[44px] text-xs font-semibold bg-amber-100 text-amber-900 hover:bg-amber-200 rounded-lg">
                      <LogOut size={16} /> {hasAuthenticatedSession ? 'Exit demo' : 'Leave demo'}
                    </button>
                  )}
                </div>
              )}
            </div>
            </>
            )}
          </div>
        </header>

        {isDemoMode && !demoNoticeDismissed && (
          <aside aria-label="Demo data notice" className="bg-amber-50 border-b border-amber-200 px-4 md:px-8 py-2.5 flex items-center justify-between gap-3 shrink-0 text-amber-900 text-xs">
            <p>Demo data is not saved. Your edits are discarded when you reload or leave the demo.</p>
            <button type="button" onClick={() => setDemoNoticeDismissed(true)} className="shrink-0 min-h-[44px] px-2 font-semibold">Got it</button>
          </aside>
        )}

        {/* Offline Notice Banner */}
        <OfflineIndicator />

        {/* Pending Sync Notice */}
        {!isFocusModeActive && isOnline && hasPendingWrites && (
          <div 
            role="status"
            aria-live="polite"
            className="bg-blue-50 border-b border-blue-200 px-4 md:px-8 py-2 flex items-center gap-2 text-blue-800 text-xs font-medium shrink-0"
          >
            <CloudUpload className="text-blue-600 shrink-0 animate-pulse" size={16} />
            <span>Saving...</span>
          </div>
        )}

        {/* Error Banner */}
        {!isFocusModeActive && error && (
          <div 
            role="alert"
            aria-live="assertive"
            className="bg-red-50 border-b border-red-100 px-4 md:px-8 py-3 flex items-start gap-3 shrink-0"
          >
            <AlertTriangle className="text-red-600 shrink-0 mt-0.5" size={18} />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800">Notice</p>
              <p className="text-sm text-red-700 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Main Scrollable View */}
        <div id="dashboard-content" tabIndex={-1} aria-label={`${activeTab} content`} ref={scrollerRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-6 md:p-8">
          <div className="max-w-6xl mx-auto">
            {/* Simple / Detailed View Mode First-Time Notice */}
            {!isFocusModeActive && !uiPrefs.seenViewNotice && (
              <aside
                aria-label="View mode notice"
                className="mb-6 bg-gradient-to-r from-blue-50 to-indigo-50/60 border border-blue-200/80 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-blue-950 shadow-2xs animate-in fade-in"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-[#002145] text-amber-400 flex items-center justify-center shrink-0 shadow-xs">
                    <Sparkles size={16} />
                  </div>
                  <div>
                    <span className="font-bold text-sm block text-slate-900">
                      Welcome to {isSimpleView ? 'Simple View' : 'Detailed View'}
                    </span>
                    <p className="text-slate-600 text-xs mt-0.5">
                      {isSimpleView
                        ? 'Focusing on coursework essentials: due dates, courses and grades. Switch to Detailed view in the sidebar or menu any time to open workload, timetable and collaboration tools.'
                        : 'Detailed view is active with full access to workload distribution, schedule timetable, group projects, and grade planning tools.'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => updateUiPrefs({ seenViewNotice: true })}
                  className="self-start sm:self-center shrink-0 px-3.5 py-1.5 text-xs font-semibold bg-[#002145] hover:bg-blue-900 text-white rounded-lg transition-colors cursor-pointer shadow-2xs"
                >
                  Got it
                </button>
              </aside>
            )}

            {focusModeActive ? (
              <div className="pb-72 md:pb-24">
                <ErrorBoundary isDemoMode={isDemoMode} fallbackTitle="Focus view unavailable" onReset={() => setFocusModeActive(false)}>
                  <JustOneThingView onExit={() => setFocusModeActive(false)} />
                </ErrorBoundary>
              </div>
            ) : (
              children
            )}
          </div>
        </div>
      </main>

      {/* Action Toast Notifications */}
      <ToastHost />

      {/* Visually-hidden persistent role=status live region for screen reader announcements */}
      <div
        id="global-live-region"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveAnnouncement}
      </div>

      {/* Mobile Bottom Navigation Bar (Screens < 768px) */}
      {!isFocusModeActive && (
      <nav 
        aria-label="Mobile Bottom Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#002145] text-white border-t border-white/10 shadow-2xl pb-[env(safe-area-inset-bottom,0px)]"
      >
        <div className="grid grid-cols-5 h-16 items-center px-1">
          {mobilePrimaryTabs.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.label;
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => handleMobileNav(item.label)}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center justify-center h-full py-1 text-center transition-all cursor-pointer select-none",
                  isActive 
                    ? "text-white font-bold" 
                    : "text-blue-200 hover:text-white"
                )}
              >
                <div className={cn(
                  "p-1 rounded-xl transition-all relative",
                  isActive ? "bg-white/20 scale-105" : ""
                )}>
                  <Icon size={20} className={isActive ? "text-white" : "text-blue-200"} />
                  {item.label === 'Tasks' && pendingReviewCount > 0 && (
                    <span 
                      title={`${pendingReviewCount} imported item${pendingReviewCount === 1 ? '' : 's'} to check`}
                      className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center bg-amber-400 text-slate-900 text-xs font-bold rounded-full shadow-xs"
                    >
                      {pendingReviewCount}
                    </span>
                  )}
                </div>
                <span className="text-[11px] sm:text-xs mt-0.5 tracking-tight font-medium truncate max-w-[62px]">
                  {item.label}
                </span>
              </button>
            );
          })}

          {/* 5th "More" Action Button */}
          <button
            type="button"
            onClick={() => setIsMobileMoreOpen(true)}
            aria-label={isCurrentTabSecondary ? `${activeTab} (current), more options` : 'More navigation and settings options'}
            aria-current={isCurrentTabSecondary ? 'page' : undefined}
            className={cn(
              "flex flex-col items-center justify-center h-full py-1 text-center transition-all cursor-pointer select-none relative",
              isCurrentTabSecondary || isMobileMoreOpen
                ? "text-white font-bold" 
                : "text-blue-200 hover:text-white"
            )}
          >
            <div className={cn(
              "p-1 rounded-xl transition-all relative",
              isCurrentTabSecondary || isMobileMoreOpen ? "bg-white/20 scale-105" : ""
            )}>
              <Menu size={20} className={isCurrentTabSecondary ? "text-amber-400" : "text-blue-200"} />
              {/* Notification dot if pending items */}
              {pendingReviewCount > 0 && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-400 rounded-full animate-pulse border-2 border-[#002145]" />
              )}
            </div>
            <span className="text-[11px] sm:text-xs mt-0.5 tracking-tight font-medium w-full px-0.5 break-words leading-tight">
              {isCurrentTabSecondary ? activeTab : 'More'}
            </span>
          </button>
        </div>
      </nav>
      )}

      {/* Mobile "More" Slide-up Drawer / Sheet */}
      {isMobileMoreOpen && (
        <ErrorBoundary isDemoMode={isDemoMode} fallbackTitle="Navigation menu unavailable" onReset={() => setIsMobileMoreOpen(false)}>
        <div 
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobile-more-title"
          ref={mobileMoreRef}
          tabIndex={-1}
          className="md:hidden fixed inset-0 z-[60] flex flex-col justify-end bg-slate-900/60 backdrop-blur-xs animate-in fade-in"
          onClick={() => setIsMobileMoreOpen(false)}
        >
          <div 
            className="bg-white rounded-t-3xl max-h-[85vh] overflow-y-auto overscroll-contain shadow-2xl p-5 border-t border-slate-200 text-slate-800 space-y-5 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]"
            onClick={e => e.stopPropagation()}
          >
            {/* Drawer Handle */}
            <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto" />

            {/* Header / User Profile */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                {user?.photoURL ? (
                  <img src={user.photoURL} alt="Profile" className="w-10 h-10 rounded-full border border-slate-200" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[#002145] text-amber-400 font-bold text-sm flex items-center justify-center">
                    {userInitials}
                  </div>
                )}
                <div className="overflow-hidden">
                  <h3 id="mobile-more-title" className="text-sm font-bold text-slate-900 truncate">
                    {user?.displayName || 'UBC Student'}
                  </h3>
                  <p className="text-xs text-slate-500 truncate">{user?.email}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsMobileMoreOpen(false)}
                aria-label="Close menu"
                className="p-2 rounded-xl text-slate-600 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <X size={20} />
              </button>
            </div>

            {/* View Mode Switcher in Mobile Sheet */}
            <div className="space-y-1.5 pt-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
                Dashboard Mode
              </span>
              <ViewModeToggle variant="sheet" />
            </div>

            {/* Secondary Tabs Grid under More tools */}
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                More tools
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {mobileSecondaryTabs.map(item => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.label;
                  return (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => handleMobileNav(item.label)}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        "w-full flex items-center gap-3 p-3 rounded-2xl text-left transition-all cursor-pointer min-h-[50px] border",
                        isActive 
                          ? "bg-blue-50/80 border-blue-300 text-blue-900 font-bold shadow-2xs" 
                          : "bg-slate-50 hover:bg-slate-100/80 border-slate-200/80 text-slate-700"
                      )}
                    >
                      <div className={cn(
                        "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                        isActive ? "bg-blue-600 text-white" : "bg-white text-slate-600 shadow-2xs"
                      )}>
                        <Icon size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold leading-tight truncate">{item.label}</p>
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">{item.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Account Rows & PWA Install */}
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => { setIsMobileMoreOpen(false); setIsReviewInboxOpen(true); }}
                className="w-full flex items-center gap-2 p-3 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-semibold border border-amber-200 transition cursor-pointer min-h-[44px]"
              >
                <Inbox size={16} />
                <span>Review Inbox ({pendingReviewCount})</span>
              </button>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Account</p>
              
              {/* PWA Install Button in Mobile Sheet */}
              <PWAInstallButton 
                variant="outline" 
                className="w-full justify-center" 
                showDismissibleHint={true}
                onInstalled={() => setIsMobileMoreOpen(false)}
              />

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => { setIsMobileMoreOpen(false); setIsSettingsOpen(true); }}
                  aria-label="Settings"
                  title="Settings"
                  className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200 transition cursor-pointer min-h-[44px]"
                >
                  <Sliders size={16} className="text-blue-600" />
                  <span>Settings</span>
                </button>

                <button
                  type="button"
                  onClick={() => { setIsMobileMoreOpen(false); exportToCSV(); }}
                  className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200 transition cursor-pointer min-h-[44px]"
                >
                  <Download size={16} className="text-emerald-600" />
                  <span>Export CSV</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => { setIsMobileMoreOpen(false); handleDownloadCodePackage(); }}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-[#002145] hover:bg-blue-900 text-white text-xs font-bold transition cursor-pointer min-h-[44px]"
              >
                <Download size={16} className="text-emerald-300" />
                <span>Export Full App Package (.zip)</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => { setIsMobileMoreOpen(false); setIsPrivacyModalOpen(true); }}
                  className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200 transition cursor-pointer min-h-[44px]"
                >
                  <Shield size={16} className="text-indigo-600" />
                  <span>Privacy & AI</span>
                </button>

                <button
                  type="button"
                  onClick={() => { setIsMobileMoreOpen(false); logout(); }}
                  className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold border border-rose-200 transition cursor-pointer min-h-[44px]"
                >
                  <LogOut size={16} className="text-rose-600" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        </ErrorBoundary>
      )}

      {/* Global Add Task Modal */}
      {isQuickAddOpen && (
        <ErrorBoundary isDemoMode={isDemoMode} fallbackTitle="Add task unavailable" onReset={() => setIsQuickAddOpen(false)}>
      <AddTaskModal
        isOpen={isQuickAddOpen}
        onClose={() => setIsQuickAddOpen(false)}
      />
        </ErrorBoundary>
      )}

      {/* Global Smart Import Modal */}
      {(isImportOpen || hasOpenedImport) && (
        <ErrorBoundary isDemoMode={isDemoMode} fallbackTitle="Import unavailable" onReset={() => { closeImport(); setHasOpenedImport(false); }}>
        <Suspense fallback={<p role="status">Loading importer…</p>}>
          <SmartImportModal
            isOpen={isImportOpen}
            onClose={closeImport}
            defaultTab={importInitialTab}
          />
        </Suspense>
        </ErrorBoundary>
      )}

      {/* Global Privacy Modal */}
      {isPrivacyModalOpen && (
        <ErrorBoundary isDemoMode={isDemoMode} fallbackTitle="Privacy unavailable" onReset={() => setIsPrivacyModalOpen(false)}>
      <PrivacyModal
        isOpen={isPrivacyModalOpen}
        onClose={() => setIsPrivacyModalOpen(false)}
      />
        </ErrorBoundary>
      )}

      {/* Global Settings & Notifications Modal */}
      {isSettingsOpen && (
        <ErrorBoundary isDemoMode={isDemoMode} fallbackTitle="Settings unavailable" onReset={() => setIsSettingsOpen(false)}>
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        user={user}
      />
        </ErrorBoundary>
      )}

      {/* Global Review Inbox Modal */}
      {isReviewInboxOpen && (
        <ErrorBoundary isDemoMode={isDemoMode} fallbackTitle="Review inbox unavailable" onReset={() => setIsReviewInboxOpen(false)}>
      <ReviewInboxModal
        isOpen={isReviewInboxOpen}
        onClose={() => setIsReviewInboxOpen(false)}
        onEditTask={(task) => setSelectedTaskForEditId(task.task_id)}
      />
        </ErrorBoundary>
      )}

      {/* Global Task Edit/Details Modal triggered by Notification Click */}
      {selectedTaskForEdit && (
        <ErrorBoundary isDemoMode={isDemoMode} fallbackTitle="Task details unavailable" onReset={() => setSelectedTaskForEditId(null)}>
        <EditTaskModal
          task={selectedTaskForEdit}
          isOpen={!!selectedTaskForEdit}
          onClose={() => setSelectedTaskForEditId(null)}
        />
        </ErrorBoundary>
      )}

      {/* Floating Pomodoro & Deep Work Focus Timer (stacked at z-40, hidden when any modal or More sheet is open) */}
      {!isAnyModalOpen && !timerDismissed && (
        <ErrorBoundary isDemoMode={isDemoMode} fallbackTitle="Focus timer unavailable" onReset={() => setTimerDismissed(true)}>
        <div 
          id="floating-focus-timer-host" 
          className="z-40 relative [body:has([role=dialog]:not(#focus-log-dialog))_&]:hidden [&_aside]:z-40 [&_aside]:bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] md:[&_aside]:bottom-6"
        >
          <FloatingFocusTimer />
        </div>
        </ErrorBoundary>
      )}

    </div>
  );
}
