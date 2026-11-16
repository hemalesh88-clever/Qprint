import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, UserRole } from '../types';
import { auth, googleProvider, checkFirebaseStatus, FirebaseDiagnostic } from '../lib/firebase';
import { signInWithPopup } from 'firebase/auth';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  firebaseDiag: FirebaseDiagnostic;
  login: (identifier: string, password: string) => Promise<boolean>;
  register: (data: {
    name: string;
    phone: string;
    email?: string;
    role: 'student' | 'faculty';
    password: string;
    department?: string;
    section?: string;
    rollNumber?: string;
    staffId?: string;
  }) => Promise<boolean>;
  loginWithGoogle: (role: 'student' | 'faculty') => Promise<boolean>;
  loginAsHandlerDemo: () => Promise<boolean>;
  updateUserProfile: (updatedUser: User) => void;
  logout: () => void;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('qprint_token'));
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [firebaseDiag] = useState<FirebaseDiagnostic>(checkFirebaseStatus());

  useEffect(() => {
    async function loadCurrentUser() {
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        } else {
          // Token invalid or expired
          localStorage.removeItem('qprint_token');
          setToken(null);
          setUser(null);
        }
      } catch (err) {
        console.warn('Failed to verify session token:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadCurrentUser();
  }, [token]);

  const login = async (identifier: string, password: string): Promise<boolean> => {
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed. Please check credentials.');
        return false;
      }

      localStorage.setItem('qprint_token', data.token);
      setToken(data.token);
      setUser(data.user);
      return true;
    } catch (err: any) {
      setError(err.message || 'Network error during login.');
      return false;
    }
  };

  const register = async (data: any): Promise<boolean> => {
    setError(null);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const resData = await res.json();
      if (!res.ok) {
        setError(resData.error || 'Registration failed.');
        return false;
      }

      localStorage.setItem('qprint_token', resData.token);
      setToken(resData.token);
      setUser(resData.user);
      return true;
    } catch (err: any) {
      setError(err.message || 'Network error during registration.');
      return false;
    }
  };

  const loginWithGoogle = async (role: 'student' | 'faculty'): Promise<boolean> => {
    setError(null);
    try {
      if (!auth || !googleProvider) {
        setError('Firebase Authentication is initializing. Please try again.');
        return false;
      }

      let googleEmail = '';
      let googleName = '';
      let googlePhone = '';

      try {
        const result = await signInWithPopup(auth, googleProvider);
        googleEmail = result.user.email || '';
        googleName = result.user.displayName || (role === 'faculty' ? 'Faculty Member' : 'Student Scholar');
        googlePhone = result.user.phoneNumber || '';
      } catch (fbErr: any) {
        console.warn('Firebase popup notice:', fbErr);
        if (fbErr.code === 'auth/popup-closed-by-user' || fbErr.code === 'auth/cancelled-popup-request') {
          setError('Google sign-in was closed before completion. Please try again.');
          return false;
        }
        if (fbErr.code === 'auth/unauthorized-domain') {
          setError('This domain is not in your Firebase Authorized Domains list. Please add it in Firebase Console.');
          return false;
        }
        if (fbErr.code === 'auth/popup-blocked') {
          setError('Google sign-in popup was blocked by your browser. Please allow popups for this site.');
          return false;
        }
        setError(fbErr.message || 'Google sign-in failed.');
        return false;
      }

      if (!googleEmail) {
        setError('Google did not provide an email address.');
        return false;
      }

      const res = await fetch('/api/auth/google-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: googleEmail,
          name: googleName,
          phone: googlePhone,
          role,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Google authentication sync failed.');
        return false;
      }

      localStorage.setItem('qprint_token', data.token);
      setToken(data.token);
      setUser(data.user);
      return true;
    } catch (err: any) {
      setError(err.message || 'Google sign-in could not be completed.');
      return false;
    }
  };

  const loginAsHandlerDemo = async (): Promise<boolean> => {
    return login('RITXeroxShop', 'Rit@1432#');
  };

  const updateUserProfile = (updatedUser: User) => {
    setUser(updatedUser);
  };

  const logout = async () => {
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => { });
    }
    localStorage.removeItem('qprint_token');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        error,
        firebaseDiag,
        login,
        register,
        loginWithGoogle,
        loginAsHandlerDemo,
        updateUserProfile,
        logout,
        clearError: () => setError(null),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
