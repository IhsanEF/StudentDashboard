import React, { useState, useRef, useEffect } from 'react';
import { useTasksContext } from '../hooks/useTasks';
import { InAppNotification } from '../types';
import { Bell, CheckCheck, Trash2, Settings, ExternalLink, Clock, Sparkles, Calendar, RefreshCw, Inbox } from 'lucide-react';
import { formatInTimeZone, TIMEZONE } from '../utils';

interface NotificationCenterProps {
  onOpenSettings: () => void;
  onOpenTaskDetails?: (taskId: string) => void;
  onOpenReviewInbox?: () => void;
  pendingReviewCount?: number;
}

export default function NotificationCenter({ 
  onOpenSettings, 
  onOpenTaskDetails,
  onOpenReviewInbox,
  pendingReviewCount = 0
}: NotificationCenterProps) {
  const {
    notifications,
    unreadNotificationCount,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    clearNotification,
    clearAllNotifications,
    notificationPrefs
  } = useTasksContext();

  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click or Escape key
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const displayedNotifications = notifications.filter(n => {
    if (filter === 'unread') return !n.read;
    return true;
  });

  const opensReviewInbox = (item: InAppNotification) => item.action === 'open_review_inbox' ||
    (item.type === 'canvas_sync' && item.id.startsWith('canvas_sync_'));

  const handleNotificationClick = (item: InAppNotification) => {
    if (!item.read) {
      markNotificationAsRead(item.id);
    }
    if (opensReviewInbox(item) && onOpenReviewInbox) {
      onOpenReviewInbox();
      setIsOpen(false);
    } else if (item.taskId && onOpenTaskDetails) {
      onOpenTaskDetails(item.taskId);
      setIsOpen(false);
    }
  };

  const getNotificationIcon = (type: InAppNotification['type']) => {
    switch (type) {
      case 'daily_digest':
        return <Sparkles className="w-4 h-4 text-amber-500" />;
      case 'weekly_digest':
        return <Calendar className="w-4 h-4 text-blue-500" />;
      case 'test':
        return <Clock className="w-4 h-4 text-purple-500" />;
      case 'canvas_sync':
        return <RefreshCw className="w-4 h-4 text-indigo-500" />;
      case 'reminder':
      default:
        return <Clock className="w-4 h-4 text-rose-500" />;
    }
  };

  const totalBadgeCount = unreadNotificationCount + (pendingReviewCount || 0);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Trigger Button */}
      <button
        id="notification-bell-btn"
        onClick={() => setIsOpen(prev => !prev)}
        className="relative p-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
        aria-label={`Notifications (${totalBadgeCount} unread)`}
        title="Notifications"
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-controls="notification-dropdown-panel"
      >
        <Bell className="w-5 h-5" />
        {totalBadgeCount > 0 && (
          <span
            id="notification-badge-count"
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-rose-600 text-white text-xs font-semibold rounded-full flex items-center justify-center animate-pulse"
          >
            {totalBadgeCount > 9 ? '9+' : totalBadgeCount}
          </span>
        )}
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <div
          id="notification-dropdown-panel"
          className="fixed left-2 right-2 top-16 w-auto max-w-[calc(100vw-16px)] sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96 sm:max-w-none bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Header */}
          <div className="p-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm text-slate-800 dark:text-slate-100">
                Notifications
              </h3>
              {totalBadgeCount > 0 && (
                <span className="px-2 py-0.5 text-xs font-medium bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full">
                  {totalBadgeCount} new
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {unreadNotificationCount > 0 && (
                <button
                  id="mark-all-read-btn"
                  onClick={markAllNotificationsAsRead}
                  className="p-1.5 text-xs text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1"
                  title="Mark all as read"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Mark read</span>
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  id="clear-all-notifs-btn"
                  onClick={clearAllNotifications}
                  className="p-1.5 text-xs text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  title="Clear all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Pending Review Items Banner */}
          {pendingReviewCount > 0 && onOpenReviewInbox && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-medium">
                <Inbox size={15} className="text-amber-600 shrink-0" />
                <span>{pendingReviewCount} {pendingReviewCount === 1 ? 'item needs' : 'items need'} review</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenReviewInbox();
                }}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-[11px] transition-colors cursor-pointer"
              >
                Review
              </button>
            </div>
          )}

          {/* Filter Bar */}
          <div className="flex border-b border-slate-100 dark:border-slate-800 px-3 py-1.5 text-xs bg-white dark:bg-slate-900 gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                filter === 'all'
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              All ({notifications.length})
            </button>
            <button
              onClick={() => setFilter('unread')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                filter === 'unread'
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Unread ({unreadNotificationCount})
            </button>

            {!notificationPrefs.enabled && (
              <span className="ml-auto text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                Paused
              </span>
            )}
          </div>

          {/* List Content */}
          <div className="overflow-y-auto max-h-96 divide-y divide-slate-100 dark:divide-slate-800">
            {displayedNotifications.length === 0 ? (
              <div className="py-10 px-4 text-center">
                <Bell className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2 opacity-50" />
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {filter === 'unread' ? 'No unread notifications' : 'Nothing yet.'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs mx-auto">
                  Once you've imported some deadlines, reminders show up here — by default a day before and an hour before each one. Change the timing in Settings.
                </p>
              </div>
            ) : (
              displayedNotifications.map(item => {
                let formattedTime = '';
                try {
                  formattedTime = formatInTimeZone(new Date(item.createdAt), TIMEZONE, 'MMM d, h:mm a');
                } catch {
                  formattedTime = 'Just now';
                }

                return (
                  <div
                    key={item.id}
                    className={`p-3.5 transition-colors group relative ${
                      item.read
                        ? 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                        : 'bg-blue-50/40 dark:bg-blue-950/20 hover:bg-blue-50/70 dark:hover:bg-blue-950/40'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 shrink-0">
                        {getNotificationIcon(item.type)}
                      </div>

                      <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          {item.courseCode && (
                            <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 rounded">
                              {item.courseCode}
                            </span>
                          )}
                          <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                            {item.title}
                          </h4>
                        </div>

                        <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">
                          {item.body}
                        </p>

                        <div className="flex items-center justify-between mt-2 pt-1">
                          <span className="text-[10px] text-slate-400 dark:text-slate-500">
                            {formattedTime}
                          </span>

                          <div className="flex items-center gap-2">
                            {opensReviewInbox(item) && onOpenReviewInbox && (
                              <button
                                type="button"
                                onClick={() => handleNotificationClick(item)}
                                className="text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-0.5"
                              >
                                Open Review Inbox
                                <ExternalLink className="w-2.5 h-2.5" />
                              </button>
                            )}
                            {item.taskId && onOpenTaskDetails && (
                              <button
                                onClick={() => handleNotificationClick(item)}
                                className="text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-0.5"
                              >
                                View Task
                                <ExternalLink className="w-2.5 h-2.5" />
                              </button>
                            )}

                            {!item.read && (
                              <button
                                onClick={() => markNotificationAsRead(item.id)}
                                className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                              >
                                Mark read
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Single Dismiss */}
                      <button
                        onClick={() => clearNotification(item.id)}
                        className="opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 text-slate-400 hover:text-rose-500 rounded cursor-pointer"
                        title="Dismiss"
                        aria-label="Dismiss notification"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer with Notification Settings link */}
          <div className="p-2.5 bg-slate-50 dark:bg-slate-900/80 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Timezone: <strong className="text-slate-700 dark:text-slate-300">America/Vancouver</strong>
            </span>
            <button
              id="open-notif-settings-btn"
              onClick={() => {
                setIsOpen(false);
                onOpenSettings();
              }}
              aria-label="Settings"
              title="Settings"
              className="flex items-center gap-1.5 px-2.5 py-1 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-md transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              Settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
