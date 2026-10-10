import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { TaskProvider } from './TaskProvider';
import Login from './components/Login';
import EmailVerification from './components/EmailVerification';
import DashboardLayout from './components/DashboardLayout';
import Overview from './components/Overview';
import TasksList from './components/TasksList';
import CoursesList from './components/CoursesList';
import Announcements from './components/Announcements';
import ProgressTab from './components/ProgressTab';
import WorkloadTab from './components/WorkloadTab';
import GroupsTab from './components/GroupsTab';
import ErrorBoundary from './components/ErrorBoundary';
import { TabType, AppUser } from './types';
import { initAuth, logout as firebaseLogout } from './auth';
import { useTasksContext } from './hooks/useTasks';

const GradesTab = lazy(() => import('./components/GradesTab'));
const TimetableTab = lazy(() => import('./components/TimetableTab'));

function DashboardContent({ user }: { user: AppUser | null }) {
  const { isDemoMode, logout } = useTasksContext();
  const [tabResetKey, setTabResetKey] = useState(0);
  const [activeTab, setActiveTab] = useState<TabType>('Overview');
  const [tasksInitialGroup, setTasksInitialGroup] = useState<string | undefined>(undefined);
  const [gradesInitialSubView, setGradesInitialSubView] = useState<string | undefined>(undefined);
  const [gradesOpenCalculators, setGradesOpenCalculators] = useState<boolean>(false);

  const handleNavigate = (tab: TabType, initialGroup?: string, gradesSubView?: string, openCalc?: boolean) => {
    setActiveTab(tab);
    if (tab === 'Tasks') {
      setTasksInitialGroup(initialGroup);
    }
    if (tab === 'Grades') {
      setGradesInitialSubView(gradesSubView);
      setGradesOpenCalculators(Boolean(openCalc));
    }
  };

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    if (tab !== 'Tasks') {
      setTasksInitialGroup(undefined);
    }
    if (tab !== 'Grades') {
      setGradesInitialSubView(undefined);
      setGradesOpenCalculators(false);
    }
  };

  const handleGoToTasks = () => {
    setTabResetKey(key => key + 1);
    handleTabChange('Tasks');
  };

  return (
    <DashboardLayout activeTab={activeTab} onTabChange={handleTabChange} user={user}>
      {activeTab === 'Overview' && (
        <ErrorBoundary key={`${activeTab}-${tabResetKey}`} isDemoMode={isDemoMode} onGoToTasks={handleGoToTasks} onSignOut={logout} fallbackTitle="Error loading Overview tab" onReset={() => { setTabResetKey(key => key + 1); handleTabChange('Overview'); }}>
          <Overview onNavigate={handleNavigate} />
        </ErrorBoundary>
      )}
      {activeTab === 'Workload' && (
        <ErrorBoundary key={`${activeTab}-${tabResetKey}`} isDemoMode={isDemoMode} onGoToTasks={handleGoToTasks} onSignOut={logout} fallbackTitle="Error loading Workload tab" onReset={() => { setTabResetKey(key => key + 1); handleTabChange('Overview'); }}>
          <WorkloadTab onNavigate={handleNavigate} />
        </ErrorBoundary>
      )}
      {activeTab === 'Tasks' && (
        <ErrorBoundary key={`${activeTab}-${tabResetKey}`} isDemoMode={isDemoMode} onGoToTasks={handleGoToTasks} onSignOut={logout} fallbackTitle="Error loading Tasks tab" onReset={() => { setTabResetKey(key => key + 1); handleTabChange('Overview'); }}>
          <TasksList initialGroup={tasksInitialGroup} />
        </ErrorBoundary>
      )}
      {activeTab === 'Groups' && (
        <ErrorBoundary key={`${activeTab}-${tabResetKey}`} isDemoMode={isDemoMode} onGoToTasks={handleGoToTasks} onSignOut={logout} fallbackTitle="Error loading Groups tab" onReset={() => { setTabResetKey(key => key + 1); handleTabChange('Overview'); }}>
          <GroupsTab />
        </ErrorBoundary>
      )}
      {activeTab === 'Timetable' && (
        <ErrorBoundary key={`${activeTab}-${tabResetKey}`} isDemoMode={isDemoMode} onGoToTasks={handleGoToTasks} onSignOut={logout} fallbackTitle="Error loading Timetable tab" onReset={() => { setTabResetKey(key => key + 1); handleTabChange('Overview'); }}>
          <Suspense fallback={<p role="status">Loading timetable…</p>}>
            <TimetableTab />
          </Suspense>
        </ErrorBoundary>
      )}
      {activeTab === 'Courses' && (
        <ErrorBoundary key={`${activeTab}-${tabResetKey}`} isDemoMode={isDemoMode} onGoToTasks={handleGoToTasks} onSignOut={logout} fallbackTitle="Error loading Courses tab" onReset={() => { setTabResetKey(key => key + 1); handleTabChange('Overview'); }}>
          <CoursesList />
        </ErrorBoundary>
      )}
      {activeTab === 'Progress' && (
        <ErrorBoundary key={`${activeTab}-${tabResetKey}`} isDemoMode={isDemoMode} onGoToTasks={handleGoToTasks} onSignOut={logout} fallbackTitle="Error loading Progress tab" onReset={() => { setTabResetKey(key => key + 1); handleTabChange('Overview'); }}>
          <ProgressTab />
        </ErrorBoundary>
      )}
      {activeTab === 'Grades' && (
        <ErrorBoundary key={`${activeTab}-${tabResetKey}`} isDemoMode={isDemoMode} onGoToTasks={handleGoToTasks} onSignOut={logout} fallbackTitle="Error loading Grades tab" onReset={() => { setTabResetKey(key => key + 1); handleTabChange('Overview'); }}>
          <Suspense fallback={<p role="status">Loading grades…</p>}>
          <GradesTab
            initialSubView={gradesInitialSubView}
            openCalculatorsForFirstCourse={gradesOpenCalculators}
          />
          </Suspense>
        </ErrorBoundary>
      )}
      {activeTab === 'Announcements' && (
        <ErrorBoundary key={`${activeTab}-${tabResetKey}`} isDemoMode={isDemoMode} onGoToTasks={handleGoToTasks} onSignOut={logout} fallbackTitle="Error loading Announcements tab" onReset={() => { setTabResetKey(key => key + 1); handleTabChange('Overview'); }}>
          <Announcements />
        </ErrorBoundary>
      )}
    </DashboardLayout>
  );
}

export default function App() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [verificationSent, setVerificationSent] = useState<boolean | undefined>();
  const authenticatedUidRef = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser) => {
        authenticatedUidRef.current = currentUser.uid;
        setIsDemo(prevDemo => {
          if (!prevDemo) {
            setUser(currentUser);
          }
          return prevDemo;
        });
        setAuthLoading(false);
      },
      () => {
        const previousUid = authenticatedUidRef.current;
        authenticatedUidRef.current = null;
        if (previousUid) void firebaseLogout(previousUid);
        setIsDemo(prevDemo => {
          if (!prevDemo) {
            setUser(null);
          }
          return prevDemo;
        });
        setAuthLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const handleDemoLogin = () => {
    setIsDemo(true);
    setUser({
      uid: 'demo-student',
      email: 'demo@example.com',
      displayName: 'Demo Student',
      photoURL: ''
    });
  };

  const handleLogout = () => {
    setUser(null);
    setIsDemo(false);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 text-white space-y-4">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-400"></div>
        <p className="text-xs font-semibold text-slate-300 tracking-wide uppercase">Checking student session...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <Login
        onLogin={(u, sent) => {
          setIsDemo(false);
          setVerificationSent(sent);
          setUser(u);
        }}
        onDemoLogin={handleDemoLogin}
      />
    );
  }

  if (!isDemo && user.emailVerified === false) {
    return <EmailVerification email={user.email} verificationSent={verificationSent}
      onVerified={verifiedUser => setUser({ ...verifiedUser })}
      onSignOut={async () => { await firebaseLogout(user.uid); handleLogout(); setVerificationSent(undefined); }} />;
  }

  return (
    <TaskProvider user={user} initialDemoMode={isDemo} onLogout={handleLogout}
      onDemoSignIn={(signedIn) => { setUser(signedIn); setIsDemo(false); }}>
      <DashboardContent user={user} />
    </TaskProvider>
  );
}
