import React, { useState } from 'react';
import {
  Printer,
  Bell,
  CheckCircle2,
  Clock,
  User as UserIcon,
  LogOut,
  ShieldAlert,
  GraduationCap,
  Sparkles,
  Search,
  ExternalLink
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';

interface NavbarProps {
  onOpenAuth: (initialTab?: 'student_login' | 'faculty_login' | 'handler_login') => void;
  onOpenCreateOrder: () => void;
  onOpenTrackModal: () => void;
  onOpenProfile?: () => void;
  onSelectTab?: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenAuth,
  onOpenCreateOrder,
  onOpenTrackModal,
  onOpenProfile,
  onSelectTab,
}) => {
  const { user, logout } = useAuth();
  const { notifications, unreadCount, markAsRead } = useRealtime();
  const [showNotifications, setShowNotifications] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 max-w-full overflow-x-hidden">
      <div className="max-w-7xl mx-auto px-2.5 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Lockup */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-blue-700 via-indigo-600 to-sky-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20 shrink-0">
            <Printer className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
          <div>
            <div className="flex items-center gap-1 sm:gap-2">
              <span className="font-bold text-base sm:text-xl tracking-tight text-slate-900">
                Qprint
              </span>
              <span className="text-[8px] sm:text-[11px] font-semibold uppercase px-1.5 sm:px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200/60 whitespace-nowrap">
                by HEMALESH
              </span>
            </div>
            <p className="text-[10px] text-slate-500 hidden sm:block tracking-wide">
              Upload • Pay • Track • Print • Collect
            </p>
          </div>
        </div>

        {/* Center Live Shop Status */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200/80 text-xs text-slate-600">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="font-medium text-slate-700">RIT Xerox Center</span>
          <span className="text-slate-400">•</span>
          <span className="text-emerald-700 font-semibold">Open & Printing</span>
        </div>

        {/* Right Action Cluster */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {/* Quick Track Order CTA */}
          <button
            onClick={onOpenTrackModal}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <Search className="w-3.5 h-3.5" />
            Track Order
          </button>

          {/* New Print Order CTA (hidden on mobile navbar to keep exit button always visible) */}
          {user?.role !== 'handler' && (
            <button
              onClick={() => {
                if (!user) {
                  onOpenAuth('student_login');
                } else {
                  onOpenCreateOrder();
                }
              }}
              className="hidden sm:inline-flex items-center gap-1 px-2.5 sm:px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] sm:text-xs font-semibold shadow-sm shadow-blue-500/25 transition-all active:scale-95 whitespace-nowrap"
            >
              <Sparkles className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span>New Print</span>
            </button>
          )}

          {/* Real-time Notifications Bell */}
          {user && (
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="relative p-1.5 sm:p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                aria-label="View notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute top-0.5 right-0.5 sm:top-1 sm:right-1 flex items-center justify-center min-w-3.5 h-3.5 sm:min-w-4 sm:h-4 px-1 text-[9px] sm:text-[10px] font-bold text-white bg-rose-500 rounded-full animate-pulse">
                    {unreadCount}
                  </span>
                )}
              </button>

              {/* Notifications Popover */}
              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">
                      Notifications ({unreadCount} new)
                    </span>
                    <button
                      onClick={() => setShowNotifications(false)}
                      className="text-xs text-slate-400 hover:text-slate-600"
                    >
                      Close
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400">
                        No notifications yet. You'll receive live alerts when your print is ready!
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          onClick={() => markAsRead(n.id)}
                          className={`p-3 text-left transition-colors cursor-pointer ${
                            !n.read ? 'bg-blue-50/50 hover:bg-blue-50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-semibold text-slate-900">
                              {n.title}
                            </p>
                            {!n.read && (
                              <span className="w-2 h-2 rounded-full bg-blue-600 mt-1 shrink-0" />
                            )}
                          </div>
                          <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">
                            {n.message}
                          </p>
                          <span className="text-[10px] text-slate-400 mt-1 block">
                            {new Date(n.createdAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* User Profile or Login Trigger */}
          {user ? (
            <div className="flex items-center gap-1.5 sm:gap-2 pl-1.5 sm:pl-2 border-l border-slate-200 shrink-0">
              <div
                onClick={() => user.role !== 'handler' && onOpenProfile && onOpenProfile()}
                className={`text-right hidden sm:block ${user.role !== 'handler' ? 'cursor-pointer hover:opacity-80' : ''}`}
                title={user.role !== 'handler' ? 'Click to view & edit profile' : undefined}
              >
                <p className="text-xs font-semibold text-slate-900 leading-tight">
                  {user.name}
                </p>
                <p className="text-[10px] font-medium text-slate-500 capitalize">
                  {user.role === 'handler' ? (
                    <span className="text-purple-600 font-bold">Shop Handler</span>
                  ) : user.role === 'faculty' ? (
                    <span className="text-indigo-600">Faculty {user.department ? `• ${user.department}` : ''}</span>
                  ) : (
                    <span>Student {user.rollNumber ? `• ${user.rollNumber}` : ''}</span>
                  )}
                </p>
              </div>

              <button
                onClick={() => user.role !== 'handler' && onOpenProfile && onOpenProfile()}
                className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gradient-to-tr from-slate-200 to-slate-100 border border-slate-300 flex items-center justify-center text-slate-700 font-bold text-xs ${
                  user.role !== 'handler' ? 'hover:ring-2 hover:ring-blue-400 cursor-pointer' : ''
                }`}
                title={user.role !== 'handler' ? 'View Profile' : 'Shop Handler'}
              >
                {user.role === 'handler' ? 'H' : user.name.charAt(0).toUpperCase()}
              </button>

              {user.role !== 'handler' && onOpenProfile && (
                <button
                  onClick={onOpenProfile}
                  className="hidden md:inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-blue-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                  title="My Profile"
                >
                  <UserIcon className="w-3 h-3 text-blue-600" />
                  <span>Profile</span>
                </button>
              )}

              {/* Exit / Log Out Button - Clearly visible and styled on all screen sizes */}
              <button
                onClick={logout}
                title="Log Out / Exit"
                className="flex items-center gap-1 px-2 sm:px-2.5 py-1 text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200/80 rounded-lg transition-colors cursor-pointer shrink-0 active:scale-95"
                aria-label="Log Out / Exit"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                <span className="text-[11px]">Exit</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onOpenAuth('student_login')}
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Sign In
              </button>
              <button
                onClick={() => onOpenAuth('handler_login')}
                className="px-2.5 py-1.5 text-[11px] font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200/60 rounded-lg transition-colors flex items-center gap-1"
                title="Shop Handler Login"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Handler</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
