import React, { useState } from 'react';
import {
  BookOpen, Users, CreditCard, Calendar, FileText,
  LogOut, RefreshCw, Bell, Video, ClipboardList, Settings
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { cn } from '@/utils/cn';
import { Brand } from '@/components/shared/Brand';
import { BatchManager } from './BatchManager';
import { StudentRoster } from './StudentRoster';
import { PaymentLedger } from './PaymentLedger';
import { Timetable } from './Timetable';
import { FileDistribution } from './FileDistribution';
import { Announcements } from './Announcements';
import { OnlineClasses } from './OnlineClasses';
import { Exams } from './Exams';
import { Maintenance } from './Maintenance';
import toast from 'react-hot-toast';

type Tab = 'batches' | 'students' | 'payments' | 'timetable' | 'files' | 'announcements' | 'online' | 'exams' | 'maintenance';

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'batches', label: 'Batches', icon: <BookOpen size={16} /> },
  { id: 'students', label: 'Students', icon: <Users size={16} /> },
  { id: 'payments', label: 'Fee Ledger', icon: <CreditCard size={16} /> },
  { id: 'exams', label: 'Exams', icon: <ClipboardList size={16} /> },
  { id: 'timetable', label: 'Timetable', icon: <Calendar size={16} /> },
  { id: 'files', label: 'Resources', icon: <FileText size={16} /> },
  { id: 'announcements', label: 'Notices', icon: <Bell size={16} /> },
  { id: 'online', label: 'Online Classes', icon: <Video size={16} /> },
  { id: 'maintenance', label: 'Settings', icon: <Settings size={16} /> },
];

export const TutorDashboard: React.FC = () => {
  const { user, db, logout, isSyncing, lastSynced } = useAppStore();
  const [activeTab, setActiveTab] = useState<Tab>('batches');

  const handleLogout = () => {
    logout();
    toast.success('Logged out');
  };

  const currentYear = db?.academicYears.find((y) => y.isCurrent);
  const liveClassCount = (db?.onlineClasses ?? []).filter((c) => c.status === 'live').length;

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      {/* Top Nav */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Brand size="sm" />
            <span className="hidden sm:inline text-xs text-stone-400 bg-stone-100 px-2 py-0.5 rounded-full">Tutor</span>
          </div>

          <div className="flex items-center gap-3">
            {/* Live class indicator */}
            {liveClassCount > 0 && (
              <button
                onClick={() => setActiveTab('online')}
                className="hidden sm:flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold px-2.5 py-1 rounded-full hover:bg-emerald-100 transition-colors"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                {liveClassCount} Live
              </button>
            )}
            {/* Sync indicator */}
            {isSyncing && (
              <span className="flex items-center gap-1 text-xs text-amber-600">
                <RefreshCw size={12} className="animate-spin" /> Saving…
              </span>
            )}
            {!isSyncing && lastSynced && (
              <span className="hidden sm:inline text-xs text-stone-400">
                Saved {new Date(lastSynced).toLocaleTimeString()}
              </span>
            )}

            {/* Academic year badge */}
            {currentYear && (
              <span className="hidden sm:inline text-xs font-medium text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-100">
                {currentYear.label}
              </span>
            )}

            {/* User */}
            <div className="flex items-center gap-2">
              {user?.picture && (
                <img src={user.picture} alt="" className="w-7 h-7 rounded-full" />
              )}
              <span className="hidden md:inline text-xs font-medium text-stone-700 max-w-[120px] truncate">
                {user?.name}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              title="Logout"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Tab Bar */}
      <div className="bg-white border-b border-stone-200 sticky top-14 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex gap-0 overflow-x-auto no-scrollbar">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap',
                  activeTab === tab.id
                    ? 'border-amber-600 text-amber-600'
                    : 'border-transparent text-stone-500 hover:text-stone-700 hover:border-stone-300',
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        {activeTab === 'batches' && <BatchManager />}
        {activeTab === 'students' && <StudentRoster />}
        {activeTab === 'payments' && <PaymentLedger />}
        {activeTab === 'exams' && <Exams />}
        {activeTab === 'timetable' && <Timetable />}
        {activeTab === 'files' && <FileDistribution />}
        {activeTab === 'announcements' && <Announcements />}
        {activeTab === 'online' && <OnlineClasses />}
        {activeTab === 'maintenance' && <Maintenance />}
      </main>
    </div>
  );
};
