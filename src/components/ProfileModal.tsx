import React, { useState, useEffect } from 'react';
import {
  X,
  User as UserIcon,
  Phone,
  Mail,
  GraduationCap,
  Building2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  Save,
  ArrowLeft,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { User } from '../types';
import { saveUserProfile, isProfileComplete } from '../lib/firestoreService';
import { auth } from '../lib/firebase';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  enforceCompletion?: boolean;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  enforceCompletion = false,
}) => {
  const { user, updateUserProfile, logout } = useAuth();

  const handleCloseOrBack = () => {
    if (enforceCompletion) {
      // If closing/canceling during required completion, logout and redirect to home page before login
      logout();
    }
    onClose();
  };

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [department, setDepartment] = useState('');
  const [section, setSection] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [staffId, setStaffId] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setPhone(user.phone || '');
      setEmail(user.email || '');
      setDepartment(user.department || '');
      setSection(user.section || '');
      setRollNumber(user.rollNumber || '');
      setStaffId(user.staffId || '');
    }
  }, [user, isOpen]);

  if (!isOpen || !user) return null;

  const profileReady = isProfileComplete(user);

  // Users can freely edit and update their pickup mobile contact number
  const isGoogleUser = Boolean(
    (user.email && user.email.includes('@')) ||
    auth?.currentUser?.providerData?.some((p) => p.providerId === 'google.com')
  );
  const isPhoneReadOnly = false;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSaveSuccess(false);

    if (!name.trim()) {
      setErrorMessage('Full name is required.');
      return;
    }

    if (!phone.trim()) {
      setErrorMessage('Mobile number is required.');
      return;
    }

    if (user.role === 'student') {
      if (!department.trim() || !section.trim() || !rollNumber.trim()) {
        setErrorMessage('Please enter your Department, Section, and Roll Number.');
        return;
      }
    }

    if (user.role === 'faculty') {
      if (!department.trim() || !staffId.trim()) {
        setErrorMessage('Please enter your Department and Staff ID.');
        return;
      }
    }

    setIsSaving(true);
    try {
      const updatedData: Partial<User> = {
        name: name.trim(),
        phone: phone.trim(),
        department: department.trim(),
      };
      if (email.trim()) updatedData.email = email.trim();
      if (user.role === 'student') {
        if (section.trim()) updatedData.section = section.trim().toUpperCase();
        if (rollNumber.trim()) updatedData.rollNumber = rollNumber.trim().toUpperCase();
      } else if (user.role === 'faculty') {
        if (staffId.trim()) updatedData.staffId = staffId.trim().toUpperCase();
      }

      const savedUser = await saveUserProfile(user.id, updatedData);
      if (updateUserProfile) {
        updateUserProfile(savedUser);
      }

      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        if (enforceCompletion) {
          onClose();
        }
      }, 1500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update profile.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden text-slate-800 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-sm">
              <UserIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {enforceCompletion ? 'Complete Your Profile' : 'My Account Profile'}
              </h2>
              <p className="text-xs text-slate-500">
                Qprint Platform • {user.role.toUpperCase()}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCloseOrBack}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/60 transition-colors cursor-pointer"
            title={enforceCompletion ? 'Back to Home Page' : 'Close'}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Completion Notice Banner */}
        {enforceCompletion ? (
          <div className="p-3.5 bg-amber-50 border-b border-amber-200 text-amber-900 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p>
              <strong>Profile Completion Required:</strong> Please provide your official college Department, Section, and Roll Number before creating print orders.
            </p>
          </div>
        ) : profileReady ? (
          <div className="px-5 py-2.5 bg-emerald-50 border-b border-emerald-100 text-emerald-800 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Profile verified & ready for printing at RIT Xerox Center.</span>
          </div>
        ) : (
          <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-100 text-amber-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Profile incomplete. Add your department and roll number.</span>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-5 space-y-4 text-xs">
          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center gap-2 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {saveSuccess && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Profile updated successfully!</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Full Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="e.g. Rahul Sharma"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-medium text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block font-semibold text-slate-700">Mobile Number *</label>
                <span className="text-[10px] text-blue-700 font-bold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                  Pickup Notifications
                </span>
              </div>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                required
                placeholder="e.g. 9840123456"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-medium text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Used for SMS & WhatsApp order ready notifications.
              </p>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. student@rit.ac.in"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg font-medium text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          {user.role === 'student' && (
            <>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Department</label>
                <input
                  type="text"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  required
                  placeholder="e.g. Computer Science (CSE), ECE, IT, MECH"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-medium text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Section</label>
                  <input
                    type="text"
                    value={section}
                    onChange={(e) => setSection(e.target.value)}
                    required
                    placeholder="e.g. A, B, C"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-medium uppercase text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Roll Number</label>
                  <input
                    type="text"
                    value={rollNumber}
                    onChange={(e) => setRollNumber(e.target.value)}
                    required
                    placeholder="e.g. 21CS042"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono uppercase font-medium text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
              </div>
            </>
          )}

          {user.role === 'faculty' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Department</label>
                <input
                  type="text"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  required
                  placeholder="e.g. Mathematics"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-medium text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Staff ID</label>
                <input
                  type="text"
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                  required
                  placeholder="e.g. RIT-FAC-01"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono uppercase font-medium text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
            </div>
          )}

          <div className="pt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleCloseOrBack}
              className="px-4 py-2.5 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{enforceCompletion ? 'Back to Home' : 'Cancel'}</span>
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center gap-1.5 shadow-md shadow-blue-500/20 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>Save Profile Details</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
