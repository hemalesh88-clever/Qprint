import React, { useState } from 'react';
import {
  X,
  GraduationCap,
  Building2,
  ShieldAlert,
  Eye,
  EyeOff,
  AlertCircle,
  Loader2,
  Sparkles,
  KeyRound,
  UserPlus,
  CheckCircle2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { checkUserDuplicate } from '../lib/firestoreService';

interface AuthModalsProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'student_login' | 'faculty_login' | 'handler_login' | 'student_register' | 'faculty_register';
}

export const AuthModals: React.FC<AuthModalsProps> = ({
  isOpen,
  onClose,
  initialTab = 'student_login',
}) => {
  const {
    login,
    register,
    loginWithGoogle,
    error: authError,
    clearError,
  } = useAuth();

  // Determine initial role and subTab
  const getInitialRole = (): 'student' | 'faculty' | 'handler' => {
    if (initialTab?.startsWith('faculty')) return 'faculty';
    if (initialTab === 'handler_login') return 'handler';
    return 'student';
  };

  const getInitialSubTab = (): 'password' | 'google' | 'register' => {
    if (initialTab?.includes('register')) return 'register';
    return 'password';
  };

  const [roleTab, setRoleTab] = useState<'student' | 'faculty' | 'handler'>(getInitialRole());
  const [subTab, setSubTab] = useState<'password' | 'google' | 'register'>(getInitialSubTab());

  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Common Login fields
  const [identifier, setIdentifier] = useState<string>('');
  const [password, setPassword] = useState<string>('');

  // Registration fields
  const [fullName, setFullName] = useState<string>('');
  const [mobileNumber, setMobileNumber] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [department, setDepartment] = useState<string>('');
  const [section, setSection] = useState<string>('');
  const [rollNumber, setRollNumber] = useState<string>('');
  const [staffId, setStaffId] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [agreeTerms, setAgreeTerms] = useState<boolean>(true);

  if (!isOpen) return null;

  const handleRoleChange = (newRole: 'student' | 'faculty' | 'handler') => {
    setRoleTab(newRole);
    clearError();
    setLocalError(null);
    setIdentifier('');
    setPassword('');
    if (newRole === 'handler') {
      setSubTab('password');
    }
  };

  const handleSubTabChange = (newSubTab: 'password' | 'google' | 'register') => {
    setSubTab(newSubTab);
    clearError();
    setLocalError(null);
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!identifier.trim()) {
      setLocalError(
        roleTab === 'handler'
          ? 'Please enter your handler username.'
          : roleTab === 'faculty'
          ? 'Please enter your Staff ID or Email.'
          : 'Please enter your Roll Number or Email.'
      );
      return;
    }
    if (!password) {
      setLocalError('Please enter your password.');
      return;
    }

    setIsSubmitting(true);
    const success = await login(identifier.trim(), password);
    setIsSubmitting(false);
    if (success) onClose();
  };

  const handleStudentRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    const cleanPhone = mobileNumber.replace(/\D/g, '').slice(-10);
    const cleanRoll = rollNumber.trim().toUpperCase();

    if (!cleanPhone || cleanPhone.length !== 10) {
      setLocalError('Please enter a valid 10-digit Indian mobile number for order pickup notifications.');
      return;
    }
    if (!cleanRoll) {
      setLocalError('Please enter your student Roll Number.');
      return;
    }
    if (password !== confirmPassword) {
      setLocalError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setLocalError('Password must be at least 6 characters.');
      return;
    }
    if (!department.trim()) {
      setLocalError('Please enter your department name.');
      return;
    }
    if (!section.trim()) {
      setLocalError('Please enter your section.');
      return;
    }
    if (!agreeTerms) {
      setLocalError('Please agree to terms and college xerox policies.');
      return;
    }

    setIsSubmitting(true);
    // Duplicate check across both Firestore and local database
    const dupCheck = await checkUserDuplicate(cleanPhone, 'student', cleanRoll);
    if (dupCheck.isDuplicate && dupCheck.message) {
      setLocalError(dupCheck.message);
      setIsSubmitting(false);
      return;
    }

    const success = await register({
      name: fullName.trim() || 'Student User',
      phone: cleanPhone,
      email: email.trim().toLowerCase() || `${cleanRoll.toLowerCase()}@rit.ac.in`,
      role: 'student',
      password,
      department: department.trim(),
      section: section.trim().toUpperCase(),
      rollNumber: cleanRoll,
    });
    setIsSubmitting(false);
    if (success) onClose();
  };

  const handleFacultyRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    const cleanPhone = mobileNumber.replace(/\D/g, '').slice(-10);
    const cleanStaff = staffId.trim().toUpperCase();

    if (!cleanPhone || cleanPhone.length !== 10) {
      setLocalError('Please enter a valid 10-digit Indian mobile number for order pickup notifications.');
      return;
    }
    if (!cleanStaff) {
      setLocalError('Please enter your Staff ID.');
      return;
    }
    if (password !== confirmPassword) {
      setLocalError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setLocalError('Password must be at least 6 characters.');
      return;
    }
    if (!department.trim()) {
      setLocalError('Please enter your department name.');
      return;
    }

    setIsSubmitting(true);
    // Duplicate check across both Firestore and local database
    const dupCheck = await checkUserDuplicate(cleanPhone, 'faculty', undefined, cleanStaff);
    if (dupCheck.isDuplicate && dupCheck.message) {
      setLocalError(dupCheck.message);
      setIsSubmitting(false);
      return;
    }

    const success = await register({
      name: fullName.trim() || 'Faculty Member',
      phone: cleanPhone,
      email: email.trim().toLowerCase() || `${cleanStaff.toLowerCase()}@rit.ac.in`,
      role: 'faculty',
      password,
      department: department.trim(),
      staffId: cleanStaff,
    });
    setIsSubmitting(false);
    if (success) onClose();
  };

  const handleGoogleSignIn = async () => {
    setIsSubmitting(true);
    setLocalError(null);
    const success = await loginWithGoogle(roleTab === 'faculty' ? 'faculty' : 'student');
    setIsSubmitting(false);
    if (success) onClose();
  };

  const handleQuickDemoFill = () => {
    setIdentifier('RITXeroxShop');
    setPassword('Rit@1432#');
  };

  const activeError = localError || authError;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden text-slate-800 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
              <span>Qprint Sign In</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-semibold">
                By: HEMALESH
              </span>
            </h2>
            <p className="text-xs text-slate-500">
              College Xerox & Print Management System
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition-colors cursor-pointer"
            title="Close & Return to Home"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Primary Role Selector Tabs */}
        <div className="grid grid-cols-3 gap-1 p-2 bg-slate-100 text-xs font-semibold">
          <button
            type="button"
            onClick={() => handleRoleChange('student')}
            className={`py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              roleTab === 'student'
                ? 'bg-white text-blue-700 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <GraduationCap className="w-4 h-4" />
            <span>Student</span>
          </button>

          <button
            type="button"
            onClick={() => handleRoleChange('faculty')}
            className={`py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              roleTab === 'faculty'
                ? 'bg-white text-indigo-700 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>Faculty</span>
          </button>

          <button
            type="button"
            onClick={() => handleRoleChange('handler')}
            className={`py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              roleTab === 'handler'
                ? 'bg-purple-600 text-white shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            <span>Shop Handler</span>
          </button>
        </div>

        {/* Sub-tabs for Student & Faculty: Password Login | Google | New Account */}
        {roleTab !== 'handler' && (
          <div className="grid grid-cols-3 border-b border-slate-200 bg-slate-50 text-xs font-semibold">
            <button
              type="button"
              onClick={() => handleSubTabChange('password')}
              className={`py-2.5 px-2 border-b-2 transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                subTab === 'password'
                  ? roleTab === 'faculty'
                    ? 'border-indigo-600 text-indigo-700 bg-white font-bold'
                    : 'border-blue-600 text-blue-700 bg-white font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Password Login</span>
            </button>

            <button
              type="button"
              onClick={() => handleSubTabChange('google')}
              className={`py-2.5 px-2 border-b-2 transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                subTab === 'google'
                  ? 'border-blue-500 text-blue-700 bg-white font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Google</span>
            </button>

            <button
              type="button"
              onClick={() => handleSubTabChange('register')}
              className={`py-2.5 px-2 border-b-2 transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                subTab === 'register'
                  ? 'border-emerald-600 text-emerald-700 bg-white font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5 text-emerald-600" />
              <span>New Account</span>
            </button>
          </div>
        )}

        <div className="p-5 max-h-[75vh] overflow-y-auto">
          {activeError && (
            <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{activeError}</span>
            </div>
          )}

          {/* ======================================================== */}
          {/* 1. PASSWORD LOGIN TAB (Student or Faculty)                */}
          {/* ======================================================== */}
          {roleTab !== 'handler' && subTab === 'password' && (
            <div className="space-y-4">
              <form onSubmit={handlePasswordLogin} className="space-y-3.5 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {roleTab === 'student'
                      ? 'Roll Number or Registered Email'
                      : 'Staff ID or Registered Email'}
                  </label>
                  <input
                    type="text"
                    placeholder={
                      roleTab === 'student'
                        ? 'e.g. 2117250020141 or student@rit.ac.in'
                        : 'e.g. RIT-FAC-01 or faculty@rit.ac.in'
                    }
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    autoComplete="username"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 font-medium text-slate-900"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Log in from any device using your Roll Number or registered Email.
                  </p>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 font-medium pr-10 text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`w-full py-2.5 rounded-xl text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer ${
                    roleTab === 'faculty' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {isSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <span>Sign In as {roleTab === 'faculty' ? 'Faculty' : 'Student'}</span>
                  )}
                </button>
              </form>

              {/* Quick Link to Google & Register */}
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200"></div>
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white px-2 text-slate-500 font-medium">Or</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 border border-slate-300 hover:bg-slate-50 rounded-xl font-bold text-xs text-slate-700 flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>Continue with Google</span>
              </button>

              <div className="text-center pt-2 text-xs text-slate-500">
                Don't have an account yet?{' '}
                <button
                  type="button"
                  onClick={() => handleSubTabChange('register')}
                  className="font-bold text-blue-600 hover:underline cursor-pointer"
                >
                  Create New Account
                </button>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* 2. DEDICATED GOOGLE TAB (Student or Faculty)              */}
          {/* ======================================================== */}
          {roleTab !== 'handler' && subTab === 'google' && (
            <div className="space-y-4 text-xs">
              <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-100 text-blue-900 space-y-2">
                <div className="flex items-center gap-2 font-bold text-sm text-blue-950">
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>Instant Google Sign-In</span>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Log in directly using your college institutional Gmail or personal Google account. No separate password needed.
                </p>
                <div className="pt-1 flex flex-col gap-1 text-[11px] text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Instant access from mobile phone, laptop, or desktop</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Automatic profile setup for new students and faculties</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isSubmitting}
                className="w-full py-3 px-4 bg-white hover:bg-slate-50 border-2 border-slate-200 hover:border-slate-300 rounded-xl font-bold text-xs text-slate-800 flex items-center justify-center gap-2.5 shadow-xs transition-all cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                ) : (
                  <>
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                    <span>Continue with Google as {roleTab === 'faculty' ? 'Faculty' : 'Student'}</span>
                  </>
                )}
              </button>

              <div className="text-center pt-2 text-slate-500">
                Prefer using your password?{' '}
                <button
                  type="button"
                  onClick={() => handleSubTabChange('password')}
                  className="font-bold text-blue-600 hover:underline cursor-pointer"
                >
                  Password Login
                </button>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* 3. REGISTER NEW ACCOUNT (Student)                        */}
          {/* ======================================================== */}
          {roleTab === 'student' && subTab === 'register' && (
            <form onSubmit={handleStudentRegister} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  placeholder="e.g. Rahul Sharma"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Mobile Number</label>
                  <input
                    type="tel"
                    placeholder="e.g. 9840123456"
                    value={mobileNumber}
                    onChange={(e) => setMobileNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">For order ready SMS</p>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Roll Number</label>
                  <input
                    type="text"
                    placeholder="e.g. 22CS104"
                    value={rollNumber}
                    onChange={(e) => setRollNumber(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono uppercase text-slate-900"
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">Primary login ID</p>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Email Address (Optional)</label>
                <input
                  type="email"
                  placeholder="e.g. student@rit.ac.in"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Department</label>
                  <input
                    type="text"
                    placeholder="e.g. CSE, IT, ECE"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-medium text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Section</label>
                  <input
                    type="text"
                    placeholder="e.g. A, B, C"
                    value={section}
                    onChange={(e) => setSection(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-medium uppercase text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Password</label>
                  <input
                    type="password"
                    placeholder="Min 6 chars"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Confirm Password</label>
                  <input
                    type="password"
                    placeholder="Repeat"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="terms"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  className="rounded text-blue-600"
                />
                <label htmlFor="terms" className="text-[11px] text-slate-600">
                  I agree to college print policies & terms
                </label>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span>Complete Registration</span>}
              </button>

              <div className="text-center pt-2 text-slate-500">
                Already registered?{' '}
                <button
                  type="button"
                  onClick={() => handleSubTabChange('password')}
                  className="font-bold text-blue-600 hover:underline cursor-pointer"
                >
                  Password Sign-In
                </button>
              </div>
            </form>
          )}

          {/* ======================================================== */}
          {/* 4. REGISTER NEW ACCOUNT (Faculty)                        */}
          {/* ======================================================== */}
          {roleTab === 'faculty' && subTab === 'register' && (
            <form onSubmit={handleFacultyRegister} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Professor / Lecturer Name</label>
                <input
                  type="text"
                  placeholder="e.g. Dr. K. Ramanathan"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Mobile Number</label>
                  <input
                    type="tel"
                    placeholder="e.g. 9840123456"
                    value={mobileNumber}
                    onChange={(e) => setMobileNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">For order pickup alerts</p>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Staff ID</label>
                  <input
                    type="text"
                    placeholder="e.g. RIT-CSE-04"
                    value={staffId}
                    onChange={(e) => setStaffId(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono uppercase text-slate-900"
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">Primary login ID</p>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Email Address (Optional)</label>
                <input
                  type="email"
                  placeholder="e.g. faculty@rit.ac.in"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Department</label>
                <input
                  type="text"
                  placeholder="e.g. Department of Computer Science & Engineering"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Password</label>
                  <input
                    type="password"
                    placeholder="Min 6 chars"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Confirm Password</label>
                  <input
                    type="password"
                    placeholder="Repeat"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span>Register Faculty Account</span>}
              </button>

              <div className="text-center pt-2 text-slate-500">
                Already registered?{' '}
                <button
                  type="button"
                  onClick={() => handleSubTabChange('password')}
                  className="font-bold text-indigo-600 hover:underline cursor-pointer"
                >
                  Password Sign-In
                </button>
              </div>
            </form>
          )}

          {/* ======================================================== */}
          {/* 5. SHOP HANDLER SECURE LOGIN                             */}
          {/* ======================================================== */}
          {roleTab === 'handler' && (
            <form onSubmit={handlePasswordLogin} className="space-y-4 text-xs">
              <div className="p-3.5 rounded-xl bg-purple-50 border border-purple-200 text-purple-900">
                <div className="flex items-center gap-2 font-bold mb-1">
                  <ShieldAlert className="w-4 h-4 text-purple-700" />
                  <span>Authorized Shop Handler Portal</span>
                </div>
                <p className="text-[11px] text-purple-700">
                  Protected station for RIT Xerox operator and printing shop administrators.
                </p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Handler Username
                </label>
                <input
                  type="text"
                  placeholder="Enter Handler Username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  autoComplete="username"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-medium text-slate-900 focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Handler Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter Handler Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg pr-10 focus:ring-2 focus:ring-purple-500 text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <span>Sign In as Shop Handler</span>
                )}
              </button>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[11px] text-slate-500">Need quick testing credentials?</span>
                <button
                  type="button"
                  onClick={handleQuickDemoFill}
                  className="text-[11px] font-bold text-purple-600 hover:text-purple-800 hover:underline cursor-pointer flex items-center gap-1"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Auto-fill Demo</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
