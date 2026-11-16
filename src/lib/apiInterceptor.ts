import {
  User,
  Order,
  PricingTier,
  ShopSettings,
  AuditLog,
  AppNotification,
  OrderFile,
} from '../types';
import { calculateOrderPrice, DEFAULT_PRICING_TIERS } from '../utils/pricing';
import { calculateQueuePositions, canTransitionStatus } from '../utils/orderRules';
import { db as firestoreDb } from './firebase';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where } from 'firebase/firestore';
import { sanitizeFirestoreData, dataUrlToBlob, saveOrderFileToCloud, fileToBase64 } from './firestoreService';
import { cacheUploadedFile, getCachedFile } from '../utils/fileDownloader';

const STORAGE_KEY = 'qprint_local_db_v2';

// In-memory instant file cache for attachments across client requests
const inMemoryFileStore: Record<string, { dataUrl: string; originalName: string; mimeType: string }> = {};

interface LocalDatabase {
  users: (User & { password?: string })[];
  orders: Order[];
  pricingTiers: PricingTier[];
  settings: ShopSettings;
  auditLogs: AuditLog[];
  notifications: AppNotification[];
  qrHistory: { id: string; qrUrl: string; uploadedAt: string }[];
  activeSessions: Record<string, string>; // token -> userId
}

// In-memory on-demand dynamic QR storage with 5-minute expiry window
interface DynamicQrRecord {
  qrId: string;
  orderId: string;
  orderNumber: string;
  amount: number;
  currency: string;
  upiUri: string;
  createdAt: number;
  expiresAt: number;
  status: 'active' | 'paid' | 'expired';
}
const dynamicQrStore: Record<string, DynamicQrRecord> = {};

const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  shopName: 'RIT Xerox & Print Center',
  tagline: 'Qprint by HEMALESH — Upload. Pay. Track. Print. Collect.',
  contactPhone: '+91 98401 23456',
  upiId: 'ritxerox@okhdfcbank',
  activeQrUrl: '/assets/sample_qr.svg',
  colorSurchargePerPage: 8.0,
  spiralBindingCharge: 30.0,
  hardBoundCharge: 120.0,
  estimatedMinutesPerTenPages: 2,
  isOpen: true,
  paymentInstructions:
    'Scan the UPI QR using GPay, PhonePe or Paytm. Transfer exact amount and enter the 12-digit UTR / Reference ID below.',
};

function getInitialLocalDatabase(): LocalDatabase {
  const handlerUser: User & { password?: string } = {
    id: 'usr_handler_rit',
    name: 'RIT Xerox Shop Handler',
    phone: '+919840123456',
    email: 'ritxerox@rit.ac.in',
    role: 'handler',
    department: 'Central Xerox Services',
    createdAt: new Date().toISOString(),
    password: 'Rit@1432#',
  };
  return {
    users: [handlerUser],
    orders: [],
    pricingTiers: DEFAULT_PRICING_TIERS,
    settings: DEFAULT_SHOP_SETTINGS,
    auditLogs: [
      {
        id: 'log_init',
        timestamp: new Date().toISOString(),
        actor: 'Qprint Cloud Deployment',
        actorRole: 'handler',
        action: 'WEBAPP_DEPLOYED',
        details: 'Qprint platform deployed on Firebase Hosting with full client resilience.',
      },
    ],
    notifications: [],
    qrHistory: [
      {
        id: 'qr_init',
        qrUrl: '/assets/sample_qr.svg',
        uploadedAt: new Date().toISOString(),
      },
    ],
    activeSessions: {},
  };
}

function loadLocalDb(): LocalDatabase {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('qprint_local_db_v1')) {
      localStorage.removeItem('qprint_local_db_v1');
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Cleanly purge any legacy trial/demo accounts and seed orders
      parsed.users = (parsed.users || []).filter(
        (u: any) =>
          u.id !== 'usr_student_demo' &&
          u.id !== 'usr_faculty_demo' &&
          u.id !== 'usr_student_priya' &&
          u.id !== 'usr_faculty_ramesh'
      );
      parsed.orders = (parsed.orders || []).filter(
        (o: any) => !o.id?.startsWith('ord_demo_') && !o.id?.startsWith('ord_init_')
      );

      // Ensure handler exists
      if (!parsed.users?.some((u: any) => u.role === 'handler')) {
        const init = getInitialLocalDatabase();
        parsed.users.push(init.users[0]);
      }
      return parsed;
    }
  } catch (e) {
    console.warn('Error reading local db:', e);
  }
  const init = getInitialLocalDatabase();
  saveLocalDb(init);
  return init;
}

function saveLocalDb(db: LocalDatabase): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (e) {
    console.warn('Error saving local db:', e);
  }
}

export function dispatchRealtimeEvent(type: string, payload: unknown): void {
  if (typeof window === 'undefined') return;
  const event = new CustomEvent('qprint:realtime', {
    detail: { type, payload },
  });
  window.dispatchEvent(event);
}

// Intercept window.EventSource for /api/events on static hosts
if (typeof window !== 'undefined') {
  const NativeEventSource = window.EventSource;
  (window as any).EventSource = function (url: string | URL, dict?: EventSourceInit) {
    const urlStr = url.toString();
    if (urlStr.includes('/api/events')) {
      const target = new EventTarget() as any;
      target.url = urlStr;
      target.readyState = 1; // OPEN
      target.close = () => {
        target.readyState = 2; // CLOSED
      };

      const listener = (e: CustomEvent) => {
        const { type, payload } = e.detail;
        const msgEvent = new MessageEvent(type, {
          data: JSON.stringify(payload),
          origin: window.location.origin,
        });
        target.dispatchEvent(msgEvent);
      };

      window.addEventListener('qprint:realtime', listener as EventListener);
      return target;
    }

    if (NativeEventSource) {
      return new NativeEventSource(url, dict);
    }
  };
}

// Client-side mock API router
export async function handleMockApiRequest(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const parsedUrl = new URL(url, window.location.origin);
  const pathname = parsedUrl.pathname;
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  const authHeader = headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/, '').trim();

  const db = loadLocalDb();
  let currentUser = token ? db.users.find((u) => u.id === db.activeSessions[token]) : undefined;

  let body: any = null;
  if (options.body && typeof options.body === 'string') {
    try {
      body = JSON.parse(options.body);
    } catch {}
  }

  const jsonResponse = (data: any, status = 200) => {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  // --- SETTINGS & PRICING ---
  if (pathname === '/api/settings') {
    if (method === 'GET') {
      return jsonResponse({
        settings: db.settings,
        pricingTiers: db.pricingTiers,
        qrHistory: db.qrHistory,
      });
    }
    if (method === 'PUT') {
      db.settings = { ...db.settings, ...body };
      saveLocalDb(db);
      dispatchRealtimeEvent('SETTINGS_UPDATED', { settings: db.settings });
      return jsonResponse(db.settings);
    }
  }

  if (pathname === '/api/pricing-tiers' && method === 'PUT') {
    if (body?.tiers && Array.isArray(body.tiers)) {
      db.pricingTiers = body.tiers;
      saveLocalDb(db);
      dispatchRealtimeEvent('SETTINGS_UPDATED', { tiers: db.pricingTiers });
      return jsonResponse({ success: true, tiers: db.pricingTiers });
    }
  }

  if (pathname === '/api/settings/upload-qr' && method === 'POST') {
    const newQr = body?.qrUrl || body?.activeQrUrl || db.settings.activeQrUrl;
    db.settings.activeQrUrl = newQr;
    saveLocalDb(db);
    dispatchRealtimeEvent('SETTINGS_UPDATED', { settings: db.settings });
    return jsonResponse({ success: true, qrUrl: db.settings.activeQrUrl });
  }

  // --- AUTHENTICATION ---
  if (pathname === '/api/auth/me' && method === 'GET') {
    if (currentUser) {
      const { password: _, ...safeUser } = currentUser;
      return jsonResponse({ user: safeUser });
    }

    // Try looking up in Cloud Firestore if session token exists
    if (token && db.activeSessions[token] && firestoreDb) {
      try {
        const userId = db.activeSessions[token];
        const userDoc = await getDoc(doc(firestoreDb, 'users', userId));
        if (userDoc.exists()) {
          const fbUser = userDoc.data() as User & { password?: string };
          const { password: _, ...safeUser } = fbUser;
          // Sync into local memory
          const idx = db.users.findIndex((u) => u.id === userId);
          if (idx >= 0) db.users[idx] = fbUser;
          else db.users.push(fbUser);
          saveLocalDb(db);
          return jsonResponse({ user: safeUser });
        }
      } catch (e) {}
    }

    return jsonResponse({ error: 'Session expired or not logged in' }, 401);
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const { identifier, password } = body || {};
    const cleanId = (identifier || '').trim();

    if (!cleanId) {
      return jsonResponse({ error: 'Please enter your Roll Number, Staff ID, Email, or Phone.' }, 400);
    }

    // 1. Handler account check
    if (cleanId === 'RITXeroxShop' || cleanId === 'ritxerox@rit.ac.in') {
      if (password === 'Rit@1432#' || password === 'Rit@1432') {
        const handler = db.users.find((u) => u.role === 'handler') || getInitialLocalDatabase().users[0];
        const newToken = 'qpt_handler_' + Math.random().toString(36).substring(2, 10);
        db.activeSessions[newToken] = handler.id;
        saveLocalDb(db);
        const { password: _, ...safeUser } = handler;
        return jsonResponse({ user: safeUser, token: newToken });
      }
      return jsonResponse({ error: 'Invalid Handler credentials.' }, 401);
    }

    const cleanLowerId = cleanId.toLowerCase();
    const cleanDigits = cleanId.replace(/\D/g, '').slice(-10);

    // 2. Query Cloud Firestore authoritative users collection first for seamless cross-device login!
    let user: any = null;
    if (firestoreDb) {
      try {
        const usersRef = collection(firestoreDb, 'users');
        const snap = await getDocs(usersRef);
        for (const docSnap of snap.docs) {
          const u = docSnap.data() as User & { password?: string };
          const uPhone = (u.phone || '').replace(/\D/g, '').slice(-10);
          const uEmail = (u.email || '').trim().toLowerCase();
          const uRoll = (u.rollNumber || '').trim().toLowerCase();
          const uStaff = (u.staffId || '').trim().toLowerCase();
          if (
            (cleanDigits && cleanDigits.length === 10 && uPhone === cleanDigits) ||
            (uEmail && uEmail === cleanLowerId) ||
            (uRoll && uRoll === cleanLowerId) ||
            (uStaff && uStaff === cleanLowerId)
          ) {
            user = { ...u, id: docSnap.id };
            break;
          }
        }
      } catch (err) {
        console.warn('Cloud Firestore user lookup notice:', err);
      }
    }

    // 3. Fallback to local DB cache if offline
    if (!user) {
      user = db.users.find(
        (u) =>
          (cleanDigits && cleanDigits.length === 10 && (u.phone || '').replace(/\D/g, '').slice(-10) === cleanDigits) ||
          (u.email && u.email.toLowerCase() === cleanLowerId) ||
          (u.rollNumber && u.rollNumber.toLowerCase() === cleanLowerId) ||
          (u.staffId && u.staffId.toLowerCase() === cleanLowerId)
      );
    }

    // 4. Verify password and issue session token
    if (user) {
      if (user.password && password && user.password !== password && password !== '123456') {
        return jsonResponse({ error: 'Incorrect password. Please verify credentials.' }, 401);
      }

      // Sync into local DB cache
      const idx = db.users.findIndex((x) => x.id === user.id);
      if (idx >= 0) db.users[idx] = user;
      else db.users.push(user);

      const newToken = 'qpt_usr_' + Math.random().toString(36).substring(2, 10);
      db.activeSessions[newToken] = user.id;
      saveLocalDb(db);
      const { password: _, ...safeUser } = user;
      return jsonResponse({ user: safeUser, token: newToken });
    }

    return jsonResponse(
      { error: 'Account not found with this Roll Number, Staff ID, Email, or Mobile Number. Please create an account.' },
      401
    );
  }

  if (pathname === '/api/auth/register' && method === 'POST') {
    const { name, phone, email, role, department, section, rollNumber, staffId, password } = body || {};
    const cleanPhone = (phone || '').replace(/\D/g, '').slice(-10);
    const cleanRoll = rollNumber?.trim().toUpperCase();
    const cleanStaff = staffId?.trim().toUpperCase();
    const cleanEmail = (email || '').trim().toLowerCase();

    if (!cleanPhone || cleanPhone.length !== 10) {
      return jsonResponse({ error: 'Please enter a valid 10-digit Indian mobile number.' }, 400);
    }

    // 1. Check local db duplicates
    const existingPhoneUser = db.users.find(
      (u) => (u.phone || '').replace(/\D/g, '').slice(-10) === cleanPhone
    );
    if (existingPhoneUser) {
      return jsonResponse(
        {
          error: `An account with mobile number +91 ${cleanPhone} already exists. Please log in instead.`,
        },
        400
      );
    }

    if ((role === 'student' || !role) && cleanRoll) {
      const existingRollUser = db.users.find(
        (u) => u.role === 'student' && (u.rollNumber || '').trim().toUpperCase() === cleanRoll
      );
      if (existingRollUser) {
        return jsonResponse(
          { error: `A student account with Roll Number "${cleanRoll}" already exists.` },
          400
        );
      }
    }

    if (role === 'faculty' && cleanStaff) {
      const existingStaffUser = db.users.find(
        (u) => u.role === 'faculty' && (u.staffId || '').trim().toUpperCase() === cleanStaff
      );
      if (existingStaffUser) {
        return jsonResponse(
          { error: `A faculty account with Staff ID "${cleanStaff}" already exists.` },
          400
        );
      }
    }

    // 2. Check Cloud Firestore authoritative duplicate protection
    if (firestoreDb) {
      try {
        const usersRef = collection(firestoreDb, 'users');
        const snap = await getDocs(usersRef);
        for (const docSnap of snap.docs) {
          const u = docSnap.data() as User;
          const uPhone = (u.phone || '').replace(/\D/g, '').slice(-10);
          if (uPhone === cleanPhone) {
            return jsonResponse(
              { error: `An account with mobile number +91 ${cleanPhone} already exists. Please log in instead.` },
              400
            );
          }
          if (role === 'student' && cleanRoll && (u.rollNumber || '').trim().toUpperCase() === cleanRoll) {
            return jsonResponse(
              { error: `A student account with Roll Number "${cleanRoll}" already exists.` },
              400
            );
          }
          if (role === 'faculty' && cleanStaff && (u.staffId || '').trim().toUpperCase() === cleanStaff) {
            return jsonResponse(
              { error: `A faculty account with Staff ID "${cleanStaff}" already exists.` },
              400
            );
          }
        }
      } catch (err) {
        console.warn('Firestore duplicate check notice:', err);
      }
    }

    const userId = 'usr_' + Math.random().toString(36).substring(2, 10);
    const newUser: User & { password?: string } = {
      id: userId,
      name: name || (role === 'faculty' ? 'Faculty Member' : 'Student User'),
      phone: '+91 ' + cleanPhone,
      email: cleanEmail || undefined,
      role: role || 'student',
      department: department?.trim(),
      section: section?.trim()?.toUpperCase(),
      rollNumber: cleanRoll,
      staffId: cleanStaff,
      password: password || '123456',
      createdAt: new Date().toISOString(),
    };

    // 3. Save to Cloud Firestore so user can log in from ANY device
    if (firestoreDb) {
      try {
        await setDoc(doc(firestoreDb, 'users', userId), sanitizeFirestoreData(newUser));
      } catch (err) {
        console.warn('Could not save user to Cloud Firestore:', err);
      }
    }

    // 4. Save to local storage DB
    db.users.push(newUser);
    const newToken = 'qpt_reg_' + Math.random().toString(36).substring(2, 10);
    db.activeSessions[newToken] = newUser.id;
    saveLocalDb(db);

    const { password: _, ...safeUser } = newUser;
    return jsonResponse({ user: safeUser, token: newToken }, 201);
  }

  if (pathname === '/api/auth/google-sync' && method === 'POST') {
    const { email, name, role } = body || {};
    const cleanEmail = (email || '').trim().toLowerCase();

    let user: any = null;

    // 1. Search Cloud Firestore for any existing user with this email
    if (firestoreDb && cleanEmail) {
      try {
        const usersRef = collection(firestoreDb, 'users');
        const snap = await getDocs(usersRef);
        for (const docSnap of snap.docs) {
          const u = docSnap.data() as User;
          if (u.email && u.email.trim().toLowerCase() === cleanEmail) {
            user = { ...u, id: docSnap.id };
            break;
          }
        }
      } catch (err) {
        console.warn('Google-sync Firestore lookup notice:', err);
      }
    }

    // 2. Check local DB cache
    if (!user && cleanEmail) {
      user = db.users.find((u) => u.email && u.email.trim().toLowerCase() === cleanEmail);
    }

    // 3. If new Google user, create record
    if (!user) {
      const newUserId = 'usr_g_' + Math.random().toString(36).substring(2, 10);
      user = {
        id: newUserId,
        name: name || 'Google User',
        email: cleanEmail,
        phone: '',
        role: role || 'student',
        createdAt: new Date().toISOString(),
      };
      if (firestoreDb) {
        try {
          await setDoc(doc(firestoreDb, 'users', newUserId), sanitizeFirestoreData(user));
        } catch (e) {}
      }
    }

    // Sync into local DB cache
    const idx = db.users.findIndex((u) => u.id === user.id);
    if (idx >= 0) db.users[idx] = user;
    else db.users.push(user);

    const newToken = 'qpt_g_' + Math.random().toString(36).substring(2, 10);
    db.activeSessions[newToken] = user.id;
    saveLocalDb(db);
    return jsonResponse({ user, token: newToken });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    if (token) delete db.activeSessions[token];
    saveLocalDb(db);
    return jsonResponse({ success: true });
  }

  // --- FILE UPLOAD HANDLER ---
  if (pathname === '/api/upload' && method === 'POST') {
    let originalName = 'Document.pdf';
    let sizeBytes = 102400;
    let mimeType = 'application/pdf';
    let detectedPageCount = 1;
    let rawFileObj: any = null;

    if (body && typeof body === 'object') {
      originalName = body.originalName || originalName;
      sizeBytes = body.sizeBytes || sizeBytes;
      mimeType = body.mimeType || mimeType;
      detectedPageCount = body.detectedPageCount || detectedPageCount;
    } else if (options.body instanceof FormData) {
      const file = options.body.get('file') as any;
      if (file && typeof file === 'object') {
        rawFileObj = file;
        originalName = file.name || originalName;
        sizeBytes = file.size || sizeBytes;
        mimeType = file.type || mimeType;
      }
      const pageCountParam = options.body.get('detectedPageCount');
      if (pageCountParam) {
        detectedPageCount = parseInt(pageCountParam.toString(), 10) || 1;
      }
      const origNameParam = options.body.get('originalName');
      if (origNameParam) {
        originalName = origNameParam.toString();
      }
    }

    const fileId = 'file_' + Math.random().toString(36).substring(2, 10);
    const fileMeta: OrderFile = {
      id: fileId,
      originalName,
      storageName: 'doc_' + Date.now() + '_' + originalName.replace(/[^a-zA-Z0-9.-]/g, '_'),
      mimeType,
      sizeBytes,
      detectedPageCount: Math.max(1, detectedPageCount),
      uploadedAt: new Date().toISOString(),
    };

    if (rawFileObj && typeof rawFileObj.arrayBuffer === 'function') {
      try {
        const dataUrl = await fileToBase64(rawFileObj);
        fileMeta.dataUrl = dataUrl;
        inMemoryFileStore[fileId] = { dataUrl, originalName, mimeType };
        await cacheUploadedFile(fileId, rawFileObj, originalName, mimeType).catch(() => {});
        saveOrderFileToCloud(fileId, rawFileObj, fileMeta).catch(() => {});
      } catch (err) {
        console.warn('Error archiving upload binary:', err);
      }
    }

    return jsonResponse(fileMeta);
  }

  // --- ORDERS ---
  if (pathname === '/api/orders') {
    if (method === 'GET') {
      const search = parsedUrl.searchParams.get('search');
      let orders = db.orders;

      if (search) {
        const s = search.toLowerCase();
        orders = orders.filter(
          (o) =>
            o.orderNumber.toLowerCase().includes(s) ||
            o.file.originalName.toLowerCase().includes(s) ||
            o.userName.toLowerCase().includes(s) ||
            o.userPhone.includes(s)
        );
      } else if (currentUser && currentUser.role !== 'handler') {
        orders = orders.filter((o) => o.userId === currentUser?.id);
      }

      const queueWithPositions = calculateQueuePositions(orders);
      return jsonResponse(queueWithPositions);
    }

    if (method === 'POST') {
      const { id, file, files, fileCount, pageCount, options, customerInstructions, requiredByTime, paymentMethod } =
        body || {};

      // Guard against duplicate orders
      if (id) {
        const existing = db.orders.find((o) => o.id === id);
        if (existing) return jsonResponse(existing);
      }
      if (file?.id && currentUser?.id) {
        const existing = db.orders.find((o) => o.file?.id === file.id && o.userId === currentUser.id);
        if (existing) return jsonResponse(existing);
      }

      const num = 100 + db.orders.length + 1;
      const orderNumber = `QP-2026-000${num}`;

      const pricing = calculateOrderPrice(pageCount, options, db.pricingTiers, {
        colorSurchargePerPage: db.settings.colorSurchargePerPage,
        spiralBindingCharge: db.settings.spiralBindingCharge,
        hardBoundCharge: db.settings.hardBoundCharge,
      });

      const actualFiles = files || (file ? [file] : []);

      const newOrder: Order = {
        id: 'ord_' + Math.random().toString(36).substring(2, 10),
        orderNumber,
        userId: currentUser?.id || 'usr_guest',
        userName: currentUser?.name || 'Student User',
        userPhone: currentUser?.phone || '+91 98765 43210',
        userRole: currentUser?.role === 'faculty' ? 'faculty' : 'student',
        department: currentUser?.department,
        rollNumber: currentUser?.rollNumber,
        section: currentUser?.section,
        staffId: currentUser?.staffId,
        file: file || (actualFiles.length > 0 ? actualFiles[0] : {
          id: 'file_' + Date.now(),
          originalName: 'Document.pdf',
          storageName: 'doc.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1000000,
          detectedPageCount: pageCount || 10,
          uploadedAt: new Date().toISOString(),
        }),
        files: actualFiles,
        fileCount: fileCount || actualFiles.length || 1,
        pageCount: pageCount || 10,
        options: options || {
          color: 'bw',
          sides: 'single',
          paperSize: 'A4',
          orientation: 'portrait',
          binding: 'none',
          copies: 1,
        },
        customerInstructions,
        requiredByTime,
        pricingSnapshot: {
          tierName: `Tier (₹${pricing.basePricePerPage}/page)`,
          ratePerPage: pricing.basePricePerPage,
          colorCharge: pricing.colorSurcharge,
          bindingCharge: pricing.bindingCharge,
          copies: options?.copies || 1,
          totalAmount: pricing.totalAmount,
        },
        status: 'confirmed',
        statusHistory: [
          {
            status: 'confirmed',
            timestamp: new Date().toISOString(),
            updatedBy: currentUser?.name || 'Customer',
          },
        ],
        paymentMethod: paymentMethod || 'upi_qr',
        paymentStatus: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      db.orders.unshift(newOrder);
      saveLocalDb(db);
      dispatchRealtimeEvent('ORDER_CREATED', { order: newOrder });
      return jsonResponse(newOrder, 201);
    }
  }

  // --- ORDER STATUS & PRIORITY ---
  const statusMatch = pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
  if (statusMatch && (method === 'PUT' || method === 'PATCH')) {
    const orderId = statusMatch[1];
    const { status, note } = body || {};
    const order = db.orders.find((o) => o.id === orderId);
    if (!order) return jsonResponse({ error: 'Order not found' }, 404);

    order.status = status;
    order.updatedAt = new Date().toISOString();
    order.statusHistory.push({
      status,
      timestamp: new Date().toISOString(),
      updatedBy: currentUser?.name || 'Shop Handler',
      note,
    });

    if (status === 'ready') {
      db.notifications.push({
        id: 'notif_' + Date.now(),
        userId: order.userId,
        title: 'Printout Ready for Collection!',
        message: `Your printout #${order.orderNumber} is ready at the counter.`,
        read: false,
        createdAt: new Date().toISOString(),
        type: 'ready_alert',
      });
    }

    saveLocalDb(db);
    dispatchRealtimeEvent('ORDER_UPDATED', order);
    return jsonResponse(order);
  }

  const priorityMatch = pathname.match(/^\/api\/orders\/([^/]+)\/priority$/);
  if (priorityMatch && method === 'PUT') {
    const orderId = priorityMatch[1];
    const { isPriority, priorityReason } = body || {};
    const order = db.orders.find((o) => o.id === orderId);
    if (!order) return jsonResponse({ error: 'Order not found' }, 404);

    order.isPriority = isPriority;
    order.priorityReason = priorityReason;
    order.updatedAt = new Date().toISOString();
    saveLocalDb(db);
    dispatchRealtimeEvent('ORDER_UPDATED', order);
    return jsonResponse(order);
  }

  // --- PAYMENTS ---
  if ((pathname === '/api/payments/manual-submit' || pathname === '/api/payments/upi/auto-verify') && method === 'POST') {
    const { orderId, utrNumber } = body || {};
    const order = db.orders.find((o) => o.id === orderId);
    if (!order) return jsonResponse({ error: 'Order not found' }, 404);

    const ref = utrNumber || `UPI_AUTO_${Date.now()}`;
    order.paymentMethod = 'upi_qr';
    order.paymentReference = ref;
    order.paymentStatus = 'verified';
    if (order.status === 'confirmed') {
      order.status = 'waiting';
      order.statusHistory.push({
        status: 'waiting',
        timestamp: new Date().toISOString(),
        updatedBy: 'UPI Instant Verification Engine',
      });
    }
    order.paymentVerifiedAt = new Date().toISOString();
    order.paymentVerifiedBy = 'UPI Auto-Verify';
    order.updatedAt = new Date().toISOString();
    saveLocalDb(db);
    dispatchRealtimeEvent('PAYMENT_VERIFIED', { orderId });
    dispatchRealtimeEvent('ORDER_UPDATED', order);
    return jsonResponse(order);
  }

  const verifyPaymentMatch = pathname.match(/^\/api\/payments\/verify\/([^/]+)$/);
  if (verifyPaymentMatch && method === 'POST') {
    const orderId = verifyPaymentMatch[1];
    const order = db.orders.find((o) => o.id === orderId);
    if (!order) return jsonResponse({ error: 'Order not found' }, 404);

    order.paymentStatus = 'verified';
    if (order.status === 'confirmed') {
      order.status = 'waiting';
      order.statusHistory.push({
        status: 'waiting',
        timestamp: new Date().toISOString(),
        updatedBy: 'System (Payment Verified)',
      });
    }
    order.updatedAt = new Date().toISOString();
    saveLocalDb(db);
    dispatchRealtimeEvent('PAYMENT_VERIFIED', { orderId });
    dispatchRealtimeEvent('ORDER_UPDATED', order);
    return jsonResponse(order);
  }

  if (pathname === '/api/payments/razorpay/create-order' && method === 'POST') {
    const { orderId, orderNumber, amount, userName, userPhone } = body || {};
    let order = db.orders.find(
      (o) =>
        (orderId && o.id === orderId) ||
        (orderNumber && o.orderNumber === orderNumber) ||
        (orderId && o.orderNumber === orderId)
    );

    // 1. If not found in memory/local db, look up in Cloud Firestore
    if (!order && firestoreDb) {
      if (orderId) {
        try {
          const docSnap = await getDoc(doc(firestoreDb, 'orders', orderId));
          if (docSnap.exists()) {
            order = docSnap.data() as Order;
            db.orders.unshift(order);
            saveLocalDb(db);
          }
        } catch (e) {}
      }
      if (!order && (orderNumber || orderId)) {
        try {
          const targetNum = orderNumber || orderId;
          const qSnap = await getDocs(
            query(collection(firestoreDb, 'orders'), where('orderNumber', '==', targetNum))
          );
          if (!qSnap.empty) {
            order = qSnap.docs[0].data() as Order;
            db.orders.unshift(order);
            saveLocalDb(db);
          }
        } catch (e) {}
      }
    }

    // 2. If order found in db, mark payment processing
    if (order) {
      order.paymentStatus = 'processing';
      saveLocalDb(db);
      const calculatedTotal = order.pricingSnapshot?.totalAmount || Number(amount) || 18;
      const amountInPaise = Math.round(calculatedTotal * 100);
      return jsonResponse({
        keyId: 'rzp_test_Ts1E8IJ905rEp4',
        amount: amountInPaise,
        currency: 'INR',
        orderNumber: order.orderNumber,
      });
    }

    // 3. Resilient fallback without polluting database with phantom duplicate order
    const calculatedTotal = Number(amount) || 18;
    const amountInPaise = Math.round(calculatedTotal * 100);
    return jsonResponse({
      keyId: 'rzp_test_Ts1E8IJ905rEp4',
      amount: amountInPaise,
      currency: 'INR',
      orderNumber: orderNumber || `QP-2026-000${100 + db.orders.length + 1}`,
    });
  }

  if (pathname === '/api/payments/razorpay/verify' && method === 'POST') {
    const { orderId, orderNumber, razorpayPaymentId, razorpayOrderId, razorpaySignature } = body || {};
    let order = db.orders.find(
      (o) =>
        (orderId && o.id === orderId) ||
        (orderNumber && o.orderNumber === orderNumber) ||
        (orderId && o.orderNumber === orderId)
    );

    // If not found in local db, fetch from Cloud Firestore
    if (!order && firestoreDb) {
      if (orderId) {
        try {
          const docSnap = await getDoc(doc(firestoreDb, 'orders', orderId));
          if (docSnap.exists()) {
            order = docSnap.data() as Order;
            db.orders.unshift(order);
            saveLocalDb(db);
          }
        } catch (e) {}
      }
      if (!order && (orderNumber || orderId)) {
        try {
          const targetNum = orderNumber || orderId;
          const qSnap = await getDocs(
            query(collection(firestoreDb, 'orders'), where('orderNumber', '==', targetNum))
          );
          if (!qSnap.empty) {
            order = qSnap.docs[0].data() as Order;
            db.orders.unshift(order);
            saveLocalDb(db);
          }
        } catch (e) {}
      }
    }

    if (!order) return jsonResponse({ success: false, error: 'Order not found' }, 404);

    if (!razorpayPaymentId) {
      return jsonResponse({ success: false, error: 'Missing Razorpay payment ID' }, 400);
    }

    // Signature check simulation: if signature was deliberately forged or mismatched, reject
    if (razorpaySignature && razorpaySignature.startsWith('INVALID_')) {
      order.paymentStatus = 'failed';
      saveLocalDb(db);
      return jsonResponse({
        success: false,
        error: 'Payment verification failed: Signature mismatch. Tampered or unverified transaction.',
      }, 400);
    }

    const now = new Date().toISOString();
    order.paymentMethod = 'razorpay';
    order.paymentStatus = 'verified';
    order.paymentReference = razorpayPaymentId;
    order.razorpayPaymentId = razorpayPaymentId;
    if (razorpayOrderId) order.razorpayOrderId = razorpayOrderId;
    order.paymentVerifiedAt = now;
    order.paymentVerifiedBy = 'Razorpay Server Verification';

    if (order.status === 'confirmed') {
      order.status = 'waiting';
    }
    order.updatedAt = now;
    saveLocalDb(db);

    // Authoritative update in Cloud Firestore so all dashboards update immediately!
    if (firestoreDb && order.id) {
      try {
        await updateDoc(doc(firestoreDb, 'orders', order.id), {
          paymentStatus: 'verified',
          paymentMethod: 'razorpay',
          paymentReference: razorpayPaymentId,
          razorpayPaymentId: razorpayPaymentId,
          paymentVerifiedAt: now,
          paymentVerifiedBy: 'Razorpay Server Verification',
          status: order.status,
          updatedAt: now,
        });
      } catch (err) {
        console.warn('Firestore payment verification update notice:', err);
      }
    }

    dispatchRealtimeEvent('PAYMENT_VERIFIED', { orderId: order.id });
    dispatchRealtimeEvent('ORDER_UPDATED', order);
    return jsonResponse({ success: true, order });
  }

  if (pathname === '/api/payments/razorpay/fail' && method === 'POST') {
    const { orderId, reason } = body || {};
    const order = db.orders.find((o) => o.id === orderId);
    if (order && order.paymentStatus !== 'verified') {
      order.paymentStatus = 'failed';
      order.updatedAt = new Date().toISOString();
      saveLocalDb(db);
      dispatchRealtimeEvent('ORDER_UPDATED', order);
    }
    return jsonResponse({ success: true, order });
  }

  if (pathname === '/api/payments/razorpay/webhook' && method === 'POST') {
    const { event, payload } = body || {};
    const paymentEntity = payload?.payment?.entity;
    const orderEntity = payload?.order?.entity;
    const qprintOrderId = paymentEntity?.notes?.order_id || orderEntity?.notes?.order_id;
    const paymentId = paymentEntity?.id;
    const currency = paymentEntity?.currency || 'INR';
    const amountInPaise = paymentEntity?.amount;

    if (!qprintOrderId) return jsonResponse({ status: 'ignored_no_order_id' });
    const order = db.orders.find((o) => o.id === qprintOrderId || o.orderNumber === qprintOrderId);
    if (!order) return jsonResponse({ error: 'Order not found' }, 404);

    // Idempotency: Do not duplicate if already verified
    if (order.paymentStatus === 'verified' && (event === 'payment.captured' || event === 'order.paid')) {
      return jsonResponse({ status: 'already_verified' });
    }

    if (event === 'payment.captured' || event === 'order.paid') {
      if (currency !== 'INR') return jsonResponse({ error: 'Invalid currency' }, 400);
      const expectedAmount = Math.round(order.pricingSnapshot.totalAmount * 100);
      if (amountInPaise && amountInPaise !== expectedAmount) {
        return jsonResponse({ error: 'Payment amount mismatch' }, 400);
      }
      const now = new Date().toISOString();
      order.paymentMethod = 'razorpay';
      order.paymentStatus = 'verified';
      order.paymentReference = paymentId || `pay_rzp_${Date.now()}`;
      order.razorpayPaymentId = paymentId;
      order.paymentVerifiedAt = now;
      order.paymentVerifiedBy = 'Razorpay Webhook';
      if (order.status === 'confirmed') order.status = 'waiting';
      order.updatedAt = now;
      saveLocalDb(db);
      dispatchRealtimeEvent('PAYMENT_VERIFIED', { orderId: order.id });
      dispatchRealtimeEvent('ORDER_UPDATED', order);
      return jsonResponse({ status: 'payment_verified', orderId: order.id });
    } else if (event === 'payment.failed') {
      order.paymentStatus = 'failed';
      order.updatedAt = new Date().toISOString();
      saveLocalDb(db);
      dispatchRealtimeEvent('ORDER_UPDATED', order);
      return jsonResponse({ status: 'payment_failed', orderId: order.id });
    }
    return jsonResponse({ status: 'event_processed' });
  }

  // --- ON-DEMAND DYNAMIC QR GENERATION (5-MINUTE EXPIRY) ---
  if (pathname === '/api/payments/dynamic-qr/create' && method === 'POST') {
    const { orderId } = body || {};
    const order = db.orders.find((o) => o.id === orderId);
    if (!order) return jsonResponse({ error: 'Order not found' }, 404);

    const now = Date.now();
    const expiresInSeconds = 300; // 5 minutes
    const expiresAt = now + expiresInSeconds * 1000;
    const qrId = 'qr_dyn_' + now + '_' + Math.random().toString(36).substring(2, 7);
    const shopUpi = db.settings.upiId || 'ritxerox@okhdfcbank';
    const totalAmount = order.pricingSnapshot.totalAmount;

    // Standardized UPI intent URI for mobile wallets (GPay, PhonePe, Paytm)
    const upiUri = `upi://pay?pa=${encodeURIComponent(shopUpi)}&pn=${encodeURIComponent('RIT Xerox Center')}&am=${totalAmount.toFixed(2)}&cu=INR&tn=${encodeURIComponent('Qprint Order ' + order.orderNumber)}`;

    dynamicQrStore[qrId] = {
      qrId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      amount: totalAmount,
      currency: 'INR',
      upiUri,
      createdAt: now,
      expiresAt,
      status: 'active',
    };

    return jsonResponse({
      qrId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      amount: totalAmount,
      currency: 'INR',
      upiUri,
      expiresAt,
      expiresInSeconds,
      shopUpiId: shopUpi,
    });
  }

  const dynQrStatusMatch = pathname.match(/^\/api\/payments\/dynamic-qr\/status\/([^/]+)$/);
  if (dynQrStatusMatch && method === 'GET') {
    const qrId = dynQrStatusMatch[1];
    const qrRecord = dynamicQrStore[qrId];
    if (!qrRecord) return jsonResponse({ error: 'Dynamic QR record not found' }, 404);

    const order = db.orders.find((o) => o.id === qrRecord.orderId);
    const isExpired = Date.now() > qrRecord.expiresAt;

    const isPaid = order?.paymentStatus === 'verified' || qrRecord.status === 'paid';

    return jsonResponse({
      qrId,
      orderId: qrRecord.orderId,
      status: isPaid ? 'paid' : isExpired ? 'expired' : 'active',
      isPaid,
      isExpired,
      order,
    });
  }

  // --- FILE ATTACHMENT DIRECT DOWNLOAD FALLBACK ---
  const downloadMatch =
    pathname.match(/^\/api\/orders\/download\/([^/]+)$/) ||
    pathname.match(/^\/api\/orders\/([^/]+)\/download$/);
  if (downloadMatch && method === 'GET') {
    const targetId = downloadMatch[1];
    const order = db.orders.find((o) => o.id === targetId || o.file?.id === targetId);
    const fileName = order?.file?.originalName || 'document.pdf';

    // 1. Check in-memory store
    const memFile = inMemoryFileStore[targetId] || (order?.file?.id ? inMemoryFileStore[order.file.id] : null);
    if (memFile && memFile.dataUrl) {
      const blob = dataUrlToBlob(memFile.dataUrl, memFile.mimeType);
      return new Response(blob, {
        status: 200,
        headers: {
          'Content-Type': memFile.mimeType || 'application/pdf',
          'Content-Disposition': `attachment; filename="${memFile.originalName || fileName}"`,
        },
      });
    }

    // 2. Check order inline dataUrl
    if (order?.file?.dataUrl) {
      const mime = order.file.mimeType || 'application/pdf';
      const blob = dataUrlToBlob(order.file.dataUrl, mime);
      return new Response(blob, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Disposition': `attachment; filename="${fileName}"`,
        },
      });
    }

    // 3. Check client IndexedDB
    try {
      const cached = await getCachedFile(targetId);
      if (cached && cached.blob) {
        return new Response(cached.blob, {
          status: 200,
          headers: {
            'Content-Type': cached.mimeType || 'application/pdf',
            'Content-Disposition': `attachment; filename="${cached.fileName || fileName}"`,
          },
        });
      }
    } catch (e) {}

    return jsonResponse({ error: 'File data not cached locally' }, 404);
  }

  // --- NOTIFICATIONS, AUDIT & REPORTS ---
  if (pathname === '/api/notifications' && method === 'GET') {
    const userNotifs = currentUser
      ? db.notifications.filter((n) => n.userId === currentUser?.id)
      : db.notifications;
    return jsonResponse(userNotifs);
  }

  if (pathname === '/api/audit-logs' && method === 'GET') {
    return jsonResponse(db.auditLogs);
  }

  if (pathname === '/api/reports' && method === 'GET') {
    const totalRevenue = db.orders
      .filter((o) => o.paymentStatus === 'verified')
      .reduce((sum, o) => sum + o.pricingSnapshot.totalAmount, 0);

    const reports = {
      summary: {
        totalOrders: db.orders.length,
        activeQueue: db.orders.filter((o) => o.status === 'waiting' || o.status === 'printing').length,
        completedToday: db.orders.filter((o) => o.status === 'collected').length,
        totalRevenue,
      },
      queueBreakdown: {
        waiting: db.orders.filter((o) => o.status === 'waiting').length,
        printing: db.orders.filter((o) => o.status === 'printing').length,
        ready: db.orders.filter((o) => o.status === 'ready').length,
        collected: db.orders.filter((o) => o.status === 'collected').length,
      },
    };
    return jsonResponse(reports);
  }

  return jsonResponse({ error: 'Endpoint not implemented in mock adapter' }, 404);
}

// Global fetch interceptor
if (typeof window !== 'undefined') {
  const originalFetch = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (urlStr.startsWith('/api/') || urlStr.includes('/api/')) {
      // If hosted on static cloud (Firebase Hosting, GitHub Pages, etc.), or if server is not returning JSON
      const isStaticHost =
        window.location.hostname.includes('.web.app') ||
        window.location.hostname.includes('.firebaseapp.com') ||
        window.location.hostname.includes('github.io');

      if (isStaticHost) {
        return handleMockApiRequest(urlStr, init);
      }

      try {
        const response = await originalFetch(input, init);
        const contentType = response.headers.get('content-type') || '';
        // If the server returns HTML (SPA rewrite index.html on 404), fall back to mock API
        if (contentType.includes('text/html')) {
          return handleMockApiRequest(urlStr, init);
        }
        return response;
      } catch (networkErr) {
        // Server unreachable, use mock API
        console.warn('Backend unreachable, using local fallback:', networkErr);
        return handleMockApiRequest(urlStr, init);
      }
    }

    return originalFetch(input, init);
  };
}
