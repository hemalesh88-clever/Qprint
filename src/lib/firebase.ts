import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  Auth
} from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDZbi6cKyB8zueqUa299tS9uvRE3I1J9Ck",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "qprint-7890.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "qprint-7890",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "qprint-7890.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "793873573863",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:793873573863:web:ddb28e7d5a40a541d8ff42",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-J92ZH4009M",
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;
let googleProvider: GoogleAuthProvider | null = null;

try {
  if (firebaseConfig.apiKey && firebaseConfig.apiKey.startsWith('AIzaSy')) {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
    googleProvider = new GoogleAuthProvider();
    googleProvider.setCustomParameters({ prompt: 'select_account' });
  }
} catch (err) {
  console.warn('Firebase initialization notice:', err);
}

export { app, auth, db, storage, googleProvider };

export interface FirebaseDiagnostic {
  isConfigured: boolean;
  apiKeyValid: boolean;
  projectId: string;
  authDomain: string;
  error?: string;
  suggestion?: string;
}

export function checkFirebaseStatus(): FirebaseDiagnostic {
  if (!firebaseConfig.apiKey || firebaseConfig.apiKey === 'MY_API_KEY') {
    return {
      isConfigured: false,
      apiKeyValid: false,
      projectId: firebaseConfig.projectId,
      authDomain: firebaseConfig.authDomain,
      error: 'Firebase Web API Key is missing or default placeholder.',
      suggestion: 'Provide a valid Google Cloud / Firebase API key in .env or settings.'
    };
  }

  return {
    isConfigured: true,
    apiKeyValid: true,
    projectId: firebaseConfig.projectId,
    authDomain: firebaseConfig.authDomain,
  };
}

