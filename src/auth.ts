import { initializeApp, onLog } from 'firebase/app';
import { 
  getAuth, 
  setPersistence,
  browserSessionPersistence,
  browserLocalPersistence,
  signInWithPopup, 
  signInWithRedirect, 
  getRedirectResult, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut, 
  User 
} from 'firebase/auth';
import { 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager,
  doc,
  getDocFromCache,
  getFirestore,
  terminate,
  clearIndexedDbPersistence
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Serve auth handler from app's own origin per Firebase redirect best practices (V4-121)
const effectiveAuthDomain = typeof window !== 'undefined' && window.location.hostname && !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1')
  ? window.location.host
  : firebaseConfig.authDomain;

export const app = initializeApp({
  ...firebaseConfig,
  authDomain: effectiveAuthDomain
});
export const auth = getAuth(app);

export type OfflineCacheStatus = 'checking' | 'persistent' | 'memory';
let offlineCacheStatus: OfflineCacheStatus = 'checking';
const cacheStatusListeners = new Set<(status: OfflineCacheStatus) => void>();
export const getOfflineCacheStatus = () => offlineCacheStatus;
const reportCacheStatus = (status: OfflineCacheStatus) => {
  offlineCacheStatus = status;
  cacheStatusListeners.forEach(listener => listener(status));
};

// Firestore's persistentLocalCache falls back asynchronously. Observe the SDK's
// fallback warning, rather than treating the configured cache as proof of durability.
onLog(({ type, message }) => {
  if (type === '@firebase/firestore' && /falling back to memory cache/i.test(message)) {
    reportCacheStatus('memory');
  }
}, { level: 'warn' });

// Initialize Firestore with persistent IndexedDB local cache for offline reliability
export const db = (() => {
  try {
    const localCache = persistentLocalCache({ tabManager: persistentMultipleTabManager() });
    return firebaseConfig.firestoreDatabaseId
      ? initializeFirestore(app, { localCache, ignoreUndefinedProperties: true }, firebaseConfig.firestoreDatabaseId)
      : initializeFirestore(app, { localCache, ignoreUndefinedProperties: true });
  } catch {
    reportCacheStatus('memory');
    // In case Firestore was already initialized or cache setup fails
    return firebaseConfig.firestoreDatabaseId
      ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
      : getFirestore(app);
  }
})();

let cacheCheck: Promise<void> | null = null;
export const subscribeOfflineCacheStatus = (listener: (status: OfflineCacheStatus) => void) => {
  cacheStatusListeners.add(listener);
  listener(offlineCacheStatus);
  // A cache-only read starts the actual persistence provider without a server read.
  // An absent probe document reports unavailable after initialization succeeds.
  if (!cacheCheck && offlineCacheStatus === 'checking') {
    cacheCheck = getDocFromCache(doc(db, 'users', '__cache_probe__'))
      .then(() => { if (offlineCacheStatus === 'checking') reportCacheStatus('persistent'); })
      .catch(error => {
        if (offlineCacheStatus === 'checking') {
          reportCacheStatus(error?.code === 'unavailable' ? 'persistent' : 'memory');
        }
      });
  }
  return () => { cacheStatusListeners.delete(listener); };
};

// Standard Google Auth provider without sensitive scopes
// This allows ANY personal or school Google account to log in without verification or test users!
const provider = new GoogleAuthProvider();

export const initAuth = (
  onAuthSuccess?: (user: User) => void,
  onAuthFailure?: () => void,
  onRedirectError?: (error: Error) => void
) => {
  const redirectPending = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('ubc_auth_redirect_pending') === 'true';

  // Check for redirect result on app initialization and detect iOS Safari storage-partitioned null returns (V3-394, V3-124)
  getRedirectResult(auth)
    .then((result) => {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('ubc_auth_redirect_pending');
      }

      if (result?.user) {
        if (onAuthSuccess) onAuthSuccess(result.user);
      } else if (redirectPending && !auth.currentUser) {
        // Redirect returned null because third-party storage is blocked on Safari/iOS (V3-394)
        const storageErr = new Error(
          'Safari blocked third-party authentication cookies during redirect. Please allow pop-ups and use the standard sign-in button.'
        );
        console.warn('Redirect sign-in completed without user session (Safari storage partitioning):', storageErr);
        try {
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem('ubc_redirect_auth_error', storageErr.message);
          }
        } catch {}
        if (onRedirectError) {
          onRedirectError(storageErr);
        } else if (onAuthFailure) {
          onAuthFailure();
        }
      }
    })
    .catch((err) => {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('ubc_auth_redirect_pending');
        try {
          sessionStorage.setItem('ubc_redirect_auth_error', err?.message || 'Redirect sign-in failed');
        } catch {}
      }
      console.error('Redirect sign-in error:', err);
      if (onRedirectError) {
        onRedirectError(err);
      } else if (onAuthFailure) {
        onAuthFailure();
      }
    });

  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (onAuthSuccess) onAuthSuccess(user);
    } else {
      if (onAuthFailure) onAuthFailure();
    }
  });
};

/**
 * Google sign-in using popup.
 * Does NOT silently redirect on popup-blocked (V3-124, V3-394) to avoid cross-origin storage partitioning loops on Safari/Firefox/iOS.
 * Instructs user to allow popups for the app domain.
 */
export const googleSignIn = async (useRedirect = false, keepSignedIn = false): Promise<User | null> => {
  // Apply the choice before either auth flow; session-only is the default.
  await setPersistence(auth, keepSignedIn ? browserLocalPersistence : browserSessionPersistence);
  if (useRedirect) {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('ubc_auth_redirect_pending', 'true');
    }
    try {
      await signInWithRedirect(auth, provider);
      return null;
    } catch (error: any) {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('ubc_auth_redirect_pending');
      }
      console.error('Sign in with redirect error:', error);
      throw error;
    }
  }

  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (error: any) {
    console.error('Sign in error:', error);
    // If popup is blocked by browser, do not bounce into broken cross-origin redirect loop (V3-394, V3-124)
    if (error.code === 'auth/popup-blocked') {
      const blockedErr = new Error(
        'Pop-up was blocked by your browser. Please allow pop-ups for this site in your browser settings (or tap "aA" > Website Settings > Pop-ups in Safari) to sign in with Google.'
      );
      (blockedErr as any).code = 'auth/popup-blocked';
      throw blockedErr;
    }
    throw error;
  }
};

/**
 * Robust sign-out:
 * 1. Terminates Firestore instance and clears IndexedDB cache persistence so no plaintext data survives on shared machines (V3-146, V3-230, V3-231)
 * 2. Clears per-user and dashboard localStorage items (checkpoints, notification history, timers)
 * 3. Clears sessionStorage
 * 4. Signs out of Firebase Auth
 */
let logoutInProgress: Promise<void> | null = null;

export const logout = (currentUid?: string): Promise<void> => {
  // Auth state callbacks and the provider can request cleanup for the same sign-out.
  if (logoutInProgress) return logoutInProgress;
  logoutInProgress = performLogout(currentUid).finally(() => { logoutInProgress = null; });
  return logoutInProgress;
};

const performLogout = async (currentUid?: string) => {
  const uid = currentUid || auth.currentUser?.uid;

  // 1. Terminate Firestore instance and clear IndexedDB persistence so cache does not persist on shared machines (V3-231)
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch (e) {
    console.warn('Error clearing Firestore IndexedDB persistence on logout:', e);
  }

  // 2. Clear per-user and app localStorage items
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (
          key.startsWith('ubc_') ||
          key.includes('checkpoint') ||
          key.includes('notification') ||
          (uid && key.includes(uid))
        ) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch (e) {
      console.warn('Error clearing localStorage keys on logout:', e);
    }
  }

  // 3. Clear sessionStorage
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      sessionStorage.clear();
    } catch (e) {
      console.warn('Error clearing sessionStorage on logout:', e);
    }
  }

  // 4. Sign out from Firebase Auth
  try {
    await signOut(auth);
  } catch (e) {
    console.warn('Error during signOut:', e);
  }
};

export const getAuthHeader = async (): Promise<Record<string, string>> => {
  const user = auth.currentUser;
  if (user) {
    try {
      const token = await user.getIdToken();
      return { Authorization: `Bearer ${token}` };
    } catch {
      return { Authorization: 'Bearer demo-guest-token', 'x-demo-mode': 'true' };
    }
  }
  return { Authorization: 'Bearer demo-guest-token', 'x-demo-mode': 'true' };
};
