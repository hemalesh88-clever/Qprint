import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  orderBy,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  User,
  Order,
  OrderFile,
  PricingTier,
  ShopSettings,
  AuditLog,
  AppNotification,
  OrderStatus,
  PaymentStatus,
  PrintOptions,
} from '../types';
import { DEFAULT_PRICING_TIERS, calculateOrderPrice } from '../utils/pricing';
import { calculateQueuePositions, canTransitionStatus } from '../utils/orderRules';

export const sanitizeFirestoreData = <T extends Record<string, any>>(obj: T): Partial<T> => {
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        result[key] = sanitizeFirestoreData(value);
      } else if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          item !== null && typeof item === 'object' && !(item instanceof Date)
            ? sanitizeFirestoreData(item)
            : item
        );
      } else {
        result[key] = value;
      }
    }
  }
  return result;
};

export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
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

const LOCAL_STORAGE_KEY = 'qprint_local_db_v2';

// Purge legacy storage and cached orders if present
if (typeof window !== 'undefined') {
  try {
    if (localStorage.getItem('qprint_local_db_v1')) {
      localStorage.removeItem('qprint_local_db_v1');
    }
  } catch (e) {}
}

// Helper to get local orders from storage cache
function getLocalOrders(): Order[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const list = (parsed.orders || []).filter(
        (o: any) => !o.id?.startsWith('ord_init_') && !o.id?.startsWith('ord_demo_')
      );
      const seen = new Set<string>();
      const deduped: Order[] = [];
      for (const order of list) {
        if (!seen.has(order.id)) {
          seen.add(order.id);
          deduped.push(order);
        }
      }
      return deduped;
    }
  } catch (e) {}
  return [];
}

// Helper to save orders to storage cache
function saveLocalOrders(orders: Order[]): void {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      parsed.orders = orders;
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(parsed));
    }
  } catch (e) {}
}

function getLocalSettings(): ShopSettings {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.settings) return parsed.settings;
    }
  } catch (e) {}
  return DEFAULT_SHOP_SETTINGS;
}

function getLocalPricingTiers(): PricingTier[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.pricingTiers && Array.isArray(parsed.pricingTiers)) return parsed.pricingTiers;
    }
  } catch (e) {}
  return DEFAULT_PRICING_TIERS;
}

function saveLocalSettings(settings: ShopSettings): void {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      parsed.settings = settings;
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(parsed));
    }
  } catch (e) {}
}

function saveLocalPricingTiers(tiers: PricingTier[]): void {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      parsed.pricingTiers = tiers;
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(parsed));
    }
  } catch (e) {}
}

function dispatchLocalRealtimeEvent(type: string, payload: unknown): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('qprint:realtime', {
      detail: { type, payload },
    })
  );
  window.dispatchEvent(new Event('storage'));
}

// ==========================================
// 1. REAL-TIME ORDERS SUBSCRIPTION & MANAGEMENT
// ==========================================

export function subscribeOrders(
  onOrdersUpdated: (orders: Order[]) => void,
  filter?: { role?: 'student' | 'faculty' | 'handler'; userId?: string }
): Unsubscribe {
  // 1. Instantly deliver cached local orders so UI never flashes empty
  const initialLocal = getLocalOrders();
  if (initialLocal.length > 0) {
    const positioned = calculateQueuePositions(initialLocal);
    if (filter?.role !== 'handler' && filter?.userId) {
      onOrdersUpdated(positioned.filter((o) => o.userId === filter.userId));
    } else {
      onOrdersUpdated(positioned);
    }
  }

  // 2. Local cross-tab & storage listener for instant 1ms updates
  const handleLocalUpdate = () => {
    const updatedLocal = getLocalOrders();
    const positioned = calculateQueuePositions(updatedLocal);
    if (filter?.role !== 'handler' && filter?.userId) {
      onOrdersUpdated(positioned.filter((o) => o.userId === filter.userId));
    } else {
      onOrdersUpdated(positioned);
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleLocalUpdate);
    window.addEventListener('qprint:realtime', handleLocalUpdate);
  }

  // 3. Authoritative Cloud Firestore real-time onSnapshot listener
  if (!db) {
    console.warn('Firestore is not initialized.');
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleLocalUpdate);
        window.removeEventListener('qprint:realtime', handleLocalUpdate);
      }
    };
  }

  const ordersRef = collection(db, 'orders');

  const unsubFirestore = onSnapshot(
    ordersRef,
    (snapshot) => {
      let allOrders = snapshot.docs
        .map((docSnap) => docSnap.data() as Order)
        .filter((o) => !o.id?.startsWith('ord_init_') && !o.id?.startsWith('ord_demo_'));

      // If Firestore is empty, also check if we have genuine local orders to backfill
      if (allOrders.length === 0) {
        const local = getLocalOrders();
        if (local.length > 0) {
          allOrders = local;
        }
      }

      // Sort by creation descending by default
      allOrders.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      // Save into local database cache for offline/instant resume
      saveLocalOrders(allOrders);

      // Calculate authoritative live FIFO positions with priority support
      const positioned = calculateQueuePositions(allOrders);

      // Apply customer view filtering if not shop handler
      if (filter?.role !== 'handler' && filter?.userId) {
        const userOrders = positioned.filter((o) => o.userId === filter.userId);
        onOrdersUpdated(userOrders);
      } else {
        onOrdersUpdated(positioned);
      }
    },
    (err) => {
      console.warn('Firestore orders subscription notice:', err);
      // Fallback to local storage on error
      handleLocalUpdate();
    }
  );

  return () => {
    unsubFirestore();
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', handleLocalUpdate);
      window.removeEventListener('qprint:realtime', handleLocalUpdate);
    }
  };
}

export function subscribeToOrder(
  orderId: string,
  onOrderUpdated: (order: Order | null) => void
): Unsubscribe {
  // 1. Initial cached order
  const localOrders = getLocalOrders();
  const found = localOrders.find((o) => o.id === orderId);
  if (found) {
    onOrderUpdated(found);
  }

  const handleLocalUpdate = () => {
    const updated = getLocalOrders().find((o) => o.id === orderId);
    if (updated) onOrderUpdated(updated);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleLocalUpdate);
    window.addEventListener('qprint:realtime', handleLocalUpdate);
  }

  if (!db) {
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleLocalUpdate);
        window.removeEventListener('qprint:realtime', handleLocalUpdate);
      }
    };
  }

  const orderDocRef = doc(db, 'orders', orderId);
  const unsubFirestore = onSnapshot(
    orderDocRef,
    (docSnap) => {
      if (docSnap.exists()) {
        const orderData = docSnap.data() as Order;
        onOrderUpdated(orderData);
      } else {
        onOrderUpdated(null);
      }
    },
    (err) => {
      console.warn('subscribeToOrder snapshot notice:', err);
    }
  );

  return () => {
    unsubFirestore();
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', handleLocalUpdate);
      window.removeEventListener('qprint:realtime', handleLocalUpdate);
    }
  };
}

export async function createOrder(orderData: Partial<Order>): Promise<Order> {
  const localOrders = getLocalOrders();
  let count = localOrders.length;

  if (db) {
    try {
      const ordersRef = collection(db, 'orders');
      const snap = await getDocs(ordersRef);
      count = Math.max(count, snap.size);
    } catch (e) {}
  }

  const orderNumber = `QP-2026-000${100 + count + 1}`;
  const orderId = 'ord_' + Math.random().toString(36).substring(2, 10);
  const now = new Date().toISOString();

  const stripLargeDataUrl = (f: OrderFile): OrderFile => {
    if (!f) return f;
    // Strip multi-megabyte base64 from order doc so Firestore 1MB and localStorage 5MB quotas are never exceeded
    // The actual binary is preserved in IndexedDB and in the orderFiles collection!
    if (f.dataUrl && f.dataUrl.length > 20000) {
      const { dataUrl, ...rest } = f;
      return rest as OrderFile;
    }
    return f;
  };

  const primaryFileClean = stripLargeDataUrl(orderData.file!);
  const allFilesClean = (
    orderData.files && orderData.files.length > 0
      ? orderData.files
      : orderData.file
      ? [orderData.file]
      : []
  ).map(stripLargeDataUrl);

  const newOrder: Order = {
    id: orderId,
    orderNumber,
    userId: orderData.userId || 'usr_guest',
    userName: orderData.userName || 'Student User',
    userPhone: orderData.userPhone || '+91 98401 23456',
    userRole: orderData.userRole === 'faculty' ? 'faculty' : 'student',
    department: orderData.department,
    section: orderData.section,
    rollNumber: orderData.rollNumber,
    staffId: orderData.staffId,
    file: primaryFileClean,
    files: allFilesClean,
    fileCount: orderData.fileCount || allFilesClean.length || (primaryFileClean ? 1 : 0),
    pageCount: orderData.pageCount || 1,
    options: orderData.options || {
      color: 'bw',
      sides: 'single',
      paperSize: 'A4',
      orientation: 'portrait',
      binding: 'none',
      copies: 1,
    },
    customerInstructions: orderData.customerInstructions,
    requiredByTime: orderData.requiredByTime,
    pricingSnapshot: orderData.pricingSnapshot!,
    status: 'confirmed',
    statusHistory: [
      {
        status: 'confirmed',
        timestamp: now,
        updatedBy: orderData.userName || 'Customer',
        note: 'Order submitted by customer',
      },
    ],
    paymentMethod: orderData.paymentMethod || 'upi_qr',
    paymentStatus: orderData.paymentStatus || 'pending',
    createdAt: now,
    updatedAt: now,
  };

  // 1. Commit to Cloud Firestore
  if (db) {
    try {
      await setDoc(doc(db, 'orders', orderId), sanitizeFirestoreData(newOrder));
    } catch (err) {
      console.warn('Firestore write warning:', err);
    }
  }

  // 2. Commit to local storage database
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    let parsed: any;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        parsed = { orders: [] };
      }
    } else {
      parsed = { orders: [] };
    }
    const currentOrders = Array.isArray(parsed.orders) ? parsed.orders : [];
    parsed.orders = [newOrder, ...currentOrders.filter((o: any) => o.id !== newOrder.id)];
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(parsed));
  } catch (e) {
    console.warn('LocalStorage save warning:', e);
  }

  // 3. Dispatch real-time events across windows & tabs
  dispatchLocalRealtimeEvent('ORDER_CREATED', { order: newOrder });

  // Log to Audit Trail
  logAuditEvent({
    action: 'ORDER_CREATED',
    actor: newOrder.userName,
    actorRole: newOrder.userRole,
    details: `Order #${newOrder.orderNumber} created (${newOrder.pageCount} pages, ₹${newOrder.pricingSnapshot.totalAmount.toFixed(2)})`,
    targetId: newOrder.id,
  }).catch(() => {});

  return newOrder;
}

export async function updateOrderStatus(
  orderId: string,
  newStatus: OrderStatus,
  actorName = 'Shop Handler',
  note?: string
): Promise<void> {
  const now = new Date().toISOString();
  let updatedOrder: Order | null = null;

  // 1. Update in Cloud Firestore if available
  if (db) {
    try {
      const orderDocRef = doc(db, 'orders', orderId);
      const snap = await getDoc(orderDocRef);
      if (snap.exists()) {
        const order = snap.data() as Order;
        const previousStatus = order.status;

        const updates: Partial<Order> = {
          status: newStatus,
          updatedAt: now,
        };

        if (newStatus === 'printing') {
          updates.startedPrintingAt = now;
        } else if (newStatus === 'ready') {
          updates.readyAt = now;
          sendAppNotification({
            userId: order.userId,
            orderId: order.id,
            title: 'Your printout is ready for collection!',
            message: `Order #${order.orderNumber} (${order.pageCount} pages, ₹${order.pricingSnapshot.totalAmount.toFixed(2)}) is printed and ready at the shop counter!`,
            type: 'ready_alert',
          }).catch(() => {});
        } else if (newStatus === 'collected') {
          updates.collectedAt = now;
          sendAppNotification({
            userId: order.userId,
            orderId: order.id,
            title: 'Order Collected Successfully',
            message: `Order #${order.orderNumber} has been collected. Thank you for using Qprint!`,
            type: 'order_update',
          }).catch(() => {});
        }

        const historyItem = {
          status: newStatus,
          timestamp: now,
          updatedBy: actorName,
          note: note || `Status updated from ${previousStatus} to ${newStatus}`,
        };

        updates.statusHistory = [...(order.statusHistory || []), historyItem];
        await updateDoc(orderDocRef, sanitizeFirestoreData(updates));
        updatedOrder = { ...order, ...updates };
      }
    } catch (err) {
      console.warn('Firestore update warning:', err);
    }
  }

  // 2. Update in local storage DB for instant sync
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const match = (parsed.orders || []).find((o: any) => o.id === orderId);
      if (match) {
        match.status = newStatus;
        match.updatedAt = now;
        match.statusHistory = match.statusHistory || [];
        match.statusHistory.push({
          status: newStatus,
          timestamp: now,
          updatedBy: actorName,
          note: note || `Status updated to ${newStatus}`,
        });
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(parsed));
        if (!updatedOrder) updatedOrder = match;
      }
    }
  } catch (e) {}

  // 3. Dispatch real-time events across windows & tabs
  dispatchLocalRealtimeEvent('ORDER_UPDATED', updatedOrder || { id: orderId, status: newStatus });

  logAuditEvent({
    action: `ORDER_STATUS_${newStatus.toUpperCase()}`,
    actor: actorName,
    actorRole: 'handler',
    details: `Order #${orderId} moved to ${newStatus}`,
    targetId: orderId,
  }).catch(() => {});
}

export async function updateOrderPriority(
  orderId: string,
  isPriority: boolean,
  reason?: string,
  actorName = 'Shop Handler'
): Promise<void> {
  if (!db) throw new Error('Firestore not initialized.');

  const orderDocRef = doc(db, 'orders', orderId);
  const snap = await getDoc(orderDocRef);
  if (!snap.exists()) throw new Error('Order not found.');

  const order = snap.data() as Order;
  const now = new Date().toISOString();

  await updateDoc(
    orderDocRef,
    sanitizeFirestoreData({
      isPriority,
      priorityReason: reason || (isPriority ? 'Prioritized by Shop Handler' : null),
      updatedAt: now,
    })
  );

  await logAuditEvent({
    action: isPriority ? 'ORDER_PRIORITIZED' : 'ORDER_DEPRIORITIZED',
    actor: actorName,
    actorRole: 'handler',
    details: `Order #${order.orderNumber} priority changed to ${isPriority}. Reason: ${reason || 'N/A'}`,
    targetId: order.id,
  });
}

export async function submitManualPayment(
  orderId: string,
  utrNumber: string,
  receiptFileName?: string,
  actorName = 'Customer'
): Promise<void> {
  if (!db) throw new Error('Firestore not initialized.');

  const orderDocRef = doc(db, 'orders', orderId);
  const snap = await getDoc(orderDocRef);
  if (!snap.exists()) throw new Error('Order not found.');

  const order = snap.data() as Order;
  const now = new Date().toISOString();

  const updates: Partial<Order> = {
    paymentMethod: 'upi_qr',
    paymentStatus: 'submitted',
    paymentReference: utrNumber.trim(),
    paymentReceiptFile: receiptFileName,
    paymentSubmittedAt: now,
    updatedAt: now,
  };

  // Move from confirmed to waiting queue upon payment submission
  if (order.status === 'confirmed') {
    updates.status = 'waiting';
    updates.statusHistory = [
      ...(order.statusHistory || []),
      {
        status: 'waiting',
        timestamp: now,
        updatedBy: actorName,
        note: `Payment UTR submitted: ${utrNumber.trim()}`,
      },
    ];
  }

  await updateDoc(orderDocRef, sanitizeFirestoreData(updates));

  await logAuditEvent({
    action: 'PAYMENT_SUBMITTED',
    actor: actorName,
    actorRole: order.userRole,
    details: `UPI UTR ${utrNumber.trim()} submitted for #${order.orderNumber} (₹${order.pricingSnapshot.totalAmount.toFixed(2)})`,
    targetId: order.id,
  });
}

export async function verifyPayment(
  orderId: string,
  verified: boolean,
  note?: string,
  actorName = 'Shop Handler'
): Promise<void> {
  if (!db) throw new Error('Firestore not initialized.');

  const orderDocRef = doc(db, 'orders', orderId);
  const snap = await getDoc(orderDocRef);
  if (!snap.exists()) throw new Error('Order not found.');

  const order = snap.data() as Order;
  const now = new Date().toISOString();

  const updates: Partial<Order> = {
    paymentStatus: verified ? 'verified' : 'failed',
    paymentVerifiedAt: now,
    paymentVerifiedBy: actorName,
    updatedAt: now,
  };

  if (verified && order.status === 'confirmed') {
    updates.status = 'waiting';
    updates.statusHistory = [
      ...(order.statusHistory || []),
      {
        status: 'waiting',
        timestamp: now,
        updatedBy: actorName,
        note: 'Payment verified by handler',
      },
    ];
  }

  await updateDoc(orderDocRef, sanitizeFirestoreData(updates));

  await sendAppNotification({
    userId: order.userId,
    orderId: order.id,
    title: verified ? 'Payment Verified!' : 'Payment Issue Flagged',
    message: verified
      ? `Your payment for Order #${order.orderNumber} has been verified. Printing will start shortly.`
      : `Payment for Order #${order.orderNumber} could not be verified. Please visit the shop counter.`,
    type: 'payment',
  });

  await logAuditEvent({
    action: verified ? 'PAYMENT_VERIFIED' : 'PAYMENT_REJECTED',
    actor: actorName,
    actorRole: 'handler',
    details: `Payment of ₹${order.pricingSnapshot.totalAmount.toFixed(2)} for #${order.orderNumber} ${verified ? 'verified' : 'rejected'}. Note: ${note || 'None'}`,
    targetId: order.id,
  });
}

export async function recordRazorpaySuccess(
  orderId: string,
  razorpayPaymentId: string,
  actorName = 'Razorpay Test Gateway'
): Promise<void> {
  if (!db) throw new Error('Firestore not initialized.');

  const orderDocRef = doc(db, 'orders', orderId);
  const snap = await getDoc(orderDocRef);
  if (!snap.exists()) throw new Error('Order not found.');

  const order = snap.data() as Order;
  const now = new Date().toISOString();

  const updates: Partial<Order> = {
    paymentMethod: 'razorpay',
    paymentStatus: 'verified',
    paymentReference: razorpayPaymentId,
    paymentVerifiedAt: now,
    paymentVerifiedBy: actorName,
    updatedAt: now,
  };

  if (order.status === 'confirmed') {
    updates.status = 'waiting';
    updates.statusHistory = [
      ...(order.statusHistory || []),
      {
        status: 'waiting',
        timestamp: now,
        updatedBy: 'Razorpay System',
        note: `Paid via Razorpay Test Gateway (${razorpayPaymentId})`,
      },
    ];
  }

  await updateDoc(orderDocRef, sanitizeFirestoreData(updates));

  await logAuditEvent({
    action: 'PAYMENT_RAZORPAY_VERIFIED',
    actor: order.userName,
    actorRole: order.userRole,
    details: `Razorpay payment of ₹${order.pricingSnapshot.totalAmount.toFixed(2)} completed for #${order.orderNumber} (${razorpayPaymentId})`,
    targetId: order.id,
  });
}

export async function recordPaymentFailed(
  orderId: string,
  reason = 'Payment failed or cancelled'
): Promise<void> {
  const localOrders = getLocalOrders();
  const order = localOrders.find((o) => o.id === orderId);
  if (order && order.paymentStatus !== 'verified') {
    order.paymentStatus = 'failed';
    saveLocalOrders(localOrders);
  }

  if (!db) return;
  try {
    const orderDocRef = doc(db, 'orders', orderId);
    const snap = await getDoc(orderDocRef);
    if (snap.exists()) {
      const liveOrder = snap.data() as Order;
      if (liveOrder.paymentStatus !== 'verified') {
        const now = new Date().toISOString();
        await updateDoc(orderDocRef, {
          paymentStatus: 'failed',
          updatedAt: now,
          statusHistory: [
            ...(liveOrder.statusHistory || []),
            {
              status: liveOrder.status,
              timestamp: now,
              updatedBy: 'Payment Gateway',
              note: reason,
            },
          ],
        });
      }
    }
  } catch (e) {
    console.warn('recordPaymentFailed notice:', e);
  }
}

export async function recordUpiPaymentSuccess(
  orderId: string,
  upiPaymentId: string,
  actorName = 'UPI Instant Auto-Verification'
): Promise<void> {
  if (!db) return;

  const orderDocRef = doc(db, 'orders', orderId);
  const snap = await getDoc(orderDocRef);
  if (!snap.exists()) return;

  const order = snap.data() as Order;
  const now = new Date().toISOString();

  const updates: Partial<Order> = {
    paymentMethod: 'upi_qr',
    paymentStatus: 'verified',
    paymentReference: upiPaymentId,
    paymentVerifiedAt: now,
    paymentVerifiedBy: actorName,
    updatedAt: now,
  };

  if (order.status === 'confirmed') {
    updates.status = 'waiting';
    updates.statusHistory = [
      ...(order.statusHistory || []),
      {
        status: 'waiting',
        timestamp: now,
        updatedBy: 'UPI Verification Engine',
        note: `Instant Verified UPI Payment (${upiPaymentId})`,
      },
    ];
  }

  await updateDoc(orderDocRef, sanitizeFirestoreData(updates));

  await logAuditEvent({
    action: 'PAYMENT_VERIFIED',
    actor: order.userName || actorName,
    actorRole: order.userRole || 'student',
    details: `UPI payment of ₹${order.pricingSnapshot.totalAmount.toFixed(2)} automatically verified for #${order.orderNumber} (${upiPaymentId})`,
    targetId: order.id,
  });
}


// ==========================================
// 2. SHOP SETTINGS, QR MANAGEMENT & PRICING
// ==========================================

export function subscribeShopSettings(
  callback: (settings: ShopSettings, pricingTiers: PricingTier[]) => void
): Unsubscribe {
  // 1. Instantly provide local cached settings so there is zero latency
  const initialSettings = getLocalSettings();
  const initialTiers = getLocalPricingTiers();
  callback(initialSettings, initialTiers);

  // 2. Cross-tab & local storage listener for immediate updates
  const handleLocalUpdate = () => {
    callback(getLocalSettings(), getLocalPricingTiers());
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleLocalUpdate);
    window.addEventListener('qprint:realtime', handleLocalUpdate);
  }

  // 3. Firestore snapshot listener
  if (!db) {
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleLocalUpdate);
        window.removeEventListener('qprint:realtime', handleLocalUpdate);
      }
    };
  }

  const settingsDocRef = doc(db, 'settings', 'main');

  const unsubFirestore = onSnapshot(
    settingsDocRef,
    (snap) => {
      if (!snap.exists()) {
        // Initialize default settings in Firestore
        setDoc(settingsDocRef, {
          settings: DEFAULT_SHOP_SETTINGS,
          pricingTiers: DEFAULT_PRICING_TIERS,
          qrHistory: [
            {
              id: 'qr_init',
              qrUrl: DEFAULT_SHOP_SETTINGS.activeQrUrl,
              uploadedAt: new Date().toISOString(),
            },
          ],
        }).catch(console.error);

        saveLocalSettings(DEFAULT_SHOP_SETTINGS);
        saveLocalPricingTiers(DEFAULT_PRICING_TIERS);
        callback(DEFAULT_SHOP_SETTINGS, DEFAULT_PRICING_TIERS);
      } else {
        const data = snap.data();
        const settings = data.settings || DEFAULT_SHOP_SETTINGS;
        const tiers = data.pricingTiers || DEFAULT_PRICING_TIERS;
        saveLocalSettings(settings);
        saveLocalPricingTiers(tiers);
        callback(settings, tiers);
      }
    },
    (err) => console.error('Settings subscription error:', err)
  );

  return () => {
    unsubFirestore();
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', handleLocalUpdate);
      window.removeEventListener('qprint:realtime', handleLocalUpdate);
    }
  };
}

export async function updateShopSettings(newSettings: Partial<ShopSettings>): Promise<void> {
  const currentLocal = getLocalSettings();
  const merged = { ...currentLocal, ...newSettings };

  // 1. Save to local storage cache immediately for 0ms UI reactivity
  saveLocalSettings(merged);
  dispatchLocalRealtimeEvent('SETTINGS_UPDATED', { settings: merged });

  // 2. Commit to Cloud Firestore
  if (db) {
    try {
      const settingsDocRef = doc(db, 'settings', 'main');
      await setDoc(settingsDocRef, { settings: merged }, { merge: true });
    } catch (err) {
      console.warn('Firestore settings update error:', err);
    }
  }

  await logAuditEvent({
    action: 'SHOP_SETTINGS_UPDATED',
    actor: 'Shop Handler',
    actorRole: 'handler',
    details: 'Shop configuration details updated.',
  }).catch(() => {});
}

export async function updatePricingTiers(tiers: PricingTier[]): Promise<void> {
  // 1. Save to local storage cache immediately for 0ms UI reactivity
  saveLocalPricingTiers(tiers);
  dispatchLocalRealtimeEvent('SETTINGS_UPDATED', { tiers });

  // 2. Commit to Cloud Firestore
  if (db) {
    try {
      const settingsDocRef = doc(db, 'settings', 'main');
      await setDoc(settingsDocRef, { pricingTiers: tiers }, { merge: true });
    } catch (err) {
      console.warn('Firestore pricing tiers update error:', err);
    }
  }

  await logAuditEvent({
    action: 'PRICING_TIERS_UPDATED',
    actor: 'Shop Handler',
    actorRole: 'handler',
    details: `Updated ${tiers.length} pricing tiers.`,
  }).catch(() => {});
}

export async function uploadShopQr(qrDataUrl: string): Promise<string> {
  if (!db) throw new Error('Firestore not initialized.');

  const settingsDocRef = doc(db, 'settings', 'main');
  const snap = await getDoc(settingsDocRef);
  const currentSettings = snap.exists() ? snap.data().settings || DEFAULT_SHOP_SETTINGS : DEFAULT_SHOP_SETTINGS;
  const currentHistory = snap.exists() ? snap.data().qrHistory || [] : [];

  const newHistoryItem = {
    id: 'qr_' + Date.now(),
    qrUrl: qrDataUrl,
    uploadedAt: new Date().toISOString(),
  };

  await setDoc(
    settingsDocRef,
    {
      settings: {
        ...currentSettings,
        activeQrUrl: qrDataUrl,
      },
      qrHistory: [newHistoryItem, ...currentHistory],
    },
    { merge: true }
  );

  await logAuditEvent({
    action: 'QR_REPLACED',
    actor: 'Shop Handler',
    actorRole: 'handler',
    details: 'New UPI QR Code image activated for customer payments.',
  });

  return qrDataUrl;
}

// ==========================================
// 3. USER PROFILE MANAGEMENT & DUPLICATE VALIDATION
// ==========================================

export async function checkUserDuplicate(
  phone: string,
  role: string,
  rollNumber?: string,
  staffId?: string,
  excludeUserId?: string
): Promise<{ isDuplicate: boolean; message?: string }> {
  const cleanPhone = (phone || '').replace(/\D/g, '').slice(-10);
  const cleanRoll = rollNumber?.trim().toUpperCase();
  const cleanStaff = staffId?.trim().toUpperCase();

  // 1. Check local storage DB cache
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const users: User[] = parsed.users || [];
      for (const u of users) {
        if (excludeUserId && u.id === excludeUserId) continue;
        const uPhone = (u.phone || '').replace(/\D/g, '').slice(-10);
        if (cleanPhone && uPhone && uPhone === cleanPhone) {
          return {
            isDuplicate: true,
            message: `An account with mobile number +91 ${cleanPhone} already exists. Please log in instead.`,
          };
        }
        if (
          role === 'student' &&
          cleanRoll &&
          (u.rollNumber || '').trim().toUpperCase() === cleanRoll
        ) {
          return {
            isDuplicate: true,
            message: `A student account with Roll Number "${cleanRoll}" already exists.`,
          };
        }
        if (
          role === 'faculty' &&
          cleanStaff &&
          (u.staffId || '').trim().toUpperCase() === cleanStaff
        ) {
          return {
            isDuplicate: true,
            message: `A faculty account with Staff ID "${cleanStaff}" already exists.`,
          };
        }
      }
    }
  } catch (e) {}

  // 2. Check Cloud Firestore authoritative users collection
  if (db) {
    try {
      const usersRef = collection(db, 'users');
      const snap = await getDocs(usersRef);
      for (const docSnap of snap.docs) {
        if (excludeUserId && docSnap.id === excludeUserId) continue;
        const u = docSnap.data() as User;
        const uPhone = (u.phone || '').replace(/\D/g, '').slice(-10);
        if (cleanPhone && uPhone && uPhone === cleanPhone) {
          return {
            isDuplicate: true,
            message: `An account with mobile number +91 ${cleanPhone} already exists. Please log in instead.`,
          };
        }
        if (
          role === 'student' &&
          cleanRoll &&
          (u.rollNumber || '').trim().toUpperCase() === cleanRoll
        ) {
          return {
            isDuplicate: true,
            message: `A student account with Roll Number "${cleanRoll}" already exists.`,
          };
        }
        if (
          role === 'faculty' &&
          cleanStaff &&
          (u.staffId || '').trim().toUpperCase() === cleanStaff
        ) {
          return {
            isDuplicate: true,
            message: `A faculty account with Staff ID "${cleanStaff}" already exists.`,
          };
        }
      }
    } catch (e) {
      console.warn('Firestore duplicate check notice:', e);
    }
  }

  return { isDuplicate: false };
}

export async function getUserProfile(userId: string): Promise<User | null> {
  if (!db) return null;
  const userRef = doc(db, 'users', userId);
  const snap = await getDoc(userRef);
  return snap.exists() ? (snap.data() as User) : null;
}

export async function saveUserProfile(
  userId: string,
  profileData: Partial<User>
): Promise<User> {
  if (!db) throw new Error('Firestore not initialized.');

  const userRef = doc(db, 'users', userId);
  const existingSnap = await getDoc(userRef);
  const existing = existingSnap.exists() ? (existingSnap.data() as User) : null;

  const targetPhone = profileData.phone || existing?.phone || '';
  const cleanPhone = (targetPhone || '').replace(/\D/g, '').slice(-10);
  const targetRole = profileData.role || existing?.role || 'student';
  const targetRoll = (profileData.rollNumber || existing?.rollNumber || '').trim().toUpperCase();
  const targetStaff = (profileData.staffId || existing?.staffId || '').trim().toUpperCase();
  const targetEmail = (profileData.email || existing?.email || '').trim().toLowerCase();

  // Look for any existing account in Cloud Firestore with this phone, roll number, or email (cross-device linking)
  let targetDocId = userId;
  let baseData: Partial<User> = existing || {};

  try {
    const usersRef = collection(db, 'users');
    const snap = await getDocs(usersRef);
    for (const d of snap.docs) {
      if (d.id === userId) continue;
      const u = d.data() as User;
      const uPhone = (u.phone || '').replace(/\D/g, '').slice(-10);
      const uRoll = (u.rollNumber || '').trim().toUpperCase();
      const uStaff = (u.staffId || '').trim().toUpperCase();
      const uEmail = (u.email || '').trim().toLowerCase();

      if (
        (cleanPhone && uPhone && uPhone === cleanPhone) ||
        (targetRoll && uRoll && uRoll === targetRoll) ||
        (targetStaff && uStaff && uStaff === targetStaff) ||
        (targetEmail && uEmail && uEmail === targetEmail)
      ) {
        targetDocId = d.id;
        baseData = { ...u, ...baseData };
        break;
      }
    }
  } catch (e) {
    console.warn('Firestore profile merge lookup notice:', e);
  }

  const now = new Date().toISOString();
  const rawUpdatedUser: any = {
    ...baseData,
    id: targetDocId,
    name: profileData.name || baseData.name || 'User',
    phone: targetPhone
      ? (targetPhone.startsWith('+91') ? targetPhone : '+91 ' + cleanPhone)
      : (baseData.phone || ''),
    role: targetRole,
    createdAt: baseData.createdAt || now,
    updatedAt: now,
  };

  if (targetEmail) rawUpdatedUser.email = targetEmail;
  else if (baseData.email) rawUpdatedUser.email = baseData.email;

  if (profileData.department) rawUpdatedUser.department = profileData.department.trim();
  else if (baseData.department) rawUpdatedUser.department = baseData.department.trim();

  if (profileData.section) rawUpdatedUser.section = profileData.section.trim().toUpperCase();
  else if (baseData.section) rawUpdatedUser.section = baseData.section.trim().toUpperCase();

  if (targetRoll) rawUpdatedUser.rollNumber = targetRoll;
  else if (baseData.rollNumber) rawUpdatedUser.rollNumber = baseData.rollNumber;

  if (targetStaff) rawUpdatedUser.staffId = targetStaff;
  else if (baseData.staffId) rawUpdatedUser.staffId = baseData.staffId;

  const sanitizedUser = sanitizeFirestoreData(rawUpdatedUser) as User;

  // Save to authoritative Firestore user doc
  await setDoc(doc(db, 'users', targetDocId), sanitizedUser, { merge: true });
  if (targetDocId !== userId) {
    await setDoc(userRef, sanitizedUser, { merge: true });
  }

  // Update in local storage DB cache as well
  try {
    const rawDb = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (rawDb) {
      const parsed = JSON.parse(rawDb);
      const matchIndex = (parsed.users || []).findIndex(
        (u: any) => u.id === userId || u.id === targetDocId
      );
      if (matchIndex >= 0) {
        parsed.users[matchIndex] = { ...parsed.users[matchIndex], ...sanitizedUser };
      } else {
        parsed.users = parsed.users || [];
        parsed.users.push(sanitizedUser);
      }
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(parsed));
    }
  } catch (e) {}

  await logAuditEvent({
    action: 'PROFILE_UPDATED',
    actor: sanitizedUser.name,
    actorRole: sanitizedUser.role,
    details: `Profile updated for ${sanitizedUser.name} (${sanitizedUser.role})`,
    targetId: targetDocId,
  });

  return sanitizedUser;
}

// Check if a profile is completely filled out
export function isProfileComplete(user: User | null): boolean {
  if (!user) return false;
  if (!user.name?.trim() || !user.phone?.trim()) return false;
  if (user.role === 'student') {
    return Boolean(
      user.department?.trim() &&
        user.section?.trim() &&
        user.rollNumber?.trim()
    );
  }
  if (user.role === 'faculty') {
    return Boolean(user.department?.trim() && user.staffId?.trim());
  }
  return true; // Handler is complete by default
}

// ==========================================
// 4. NOTIFICATIONS & AUDIT LOGS
// ==========================================

export async function sendAppNotification(notif: Omit<AppNotification, 'id' | 'read' | 'createdAt'>): Promise<void> {
  if (!db) return;
  const id = 'notif_' + Math.random().toString(36).substring(2, 10);
  const newNotif: AppNotification = {
    id,
    ...notif,
    read: false,
    createdAt: new Date().toISOString(),
  };
  await setDoc(doc(db, 'notifications', id), sanitizeFirestoreData(newNotif));
}

export function subscribeUserNotifications(
  userId: string,
  callback: (notifications: AppNotification[]) => void
): Unsubscribe {
  if (!db) return () => {};

  const notifsQuery = query(
    collection(db, 'notifications'),
    where('userId', '==', userId)
  );

  return onSnapshot(
    notifsQuery,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as AppNotification);
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      callback(list);
    },
    (err) => console.error('Notifications subscription error:', err)
  );
}

export async function markNotificationRead(notifId: string): Promise<void> {
  if (!db) return;
  await updateDoc(doc(db, 'notifications', notifId), { read: true });
}

export function subscribeAuditLogs(callback: (logs: AuditLog[]) => void): Unsubscribe {
  if (!db) return () => {};

  return onSnapshot(
    collection(db, 'auditLogs'),
    (snap) => {
      const list = snap.docs.map((d) => d.data() as AuditLog);
      list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      callback(list);
    },
    (err) => console.error('Audit logs subscription error:', err)
  );
}

export async function logAuditEvent(event: {
  action: string;
  actor: string;
  actorRole: string;
  details: string;
  targetId?: string;
}): Promise<void> {
  if (!db) return;
  const id = 'log_' + Math.random().toString(36).substring(2, 10);
  const audit: AuditLog = {
    id,
    timestamp: new Date().toISOString(),
    ...event,
  };
  await setDoc(doc(db, 'auditLogs', id), sanitizeFirestoreData(audit));
}

/**
 * Clears all orders across Cloud Firestore, local storage, and IndexedDB cache.
 */
export async function clearAllOrders(): Promise<void> {
  if (db) {
    const firestore = db;
    try {
      const snap = await getDocs(collection(firestore, 'orders'));
      const deletePromises = snap.docs.map((docSnap) => deleteDoc(doc(firestore, 'orders', docSnap.id)));
      await Promise.all(deletePromises);
    } catch (e) {
      console.warn('Firestore clear orders notice:', e);
    }
  }

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      parsed.orders = [];
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(parsed));
    }
  } catch (e) {}

  try {
    if (typeof indexedDB !== 'undefined') {
      indexedDB.deleteDatabase('qprint_files_db');
    }
  } catch (e) {}

  dispatchLocalRealtimeEvent('ORDERS_CLEARED', {});
}

/**
 * Convert a File or Blob to a Base64 data string
 */
export function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * Converts a Base64 string or Data URL into a real authentic Binary Blob.
 * Sanitizes headers, whitespace, URL-safe base64, and padding.
 * Guaranteed never to return a raw text base64 string as a file blob.
 */
export function dataUrlToBlob(dataUrl: string, fallbackMime = 'application/octet-stream'): Blob {
  if (!dataUrl) {
    return new Blob([], { type: fallbackMime });
  }

  try {
    let mime = fallbackMime;
    let base64 = dataUrl;

    const commaIndex = dataUrl.indexOf(',');
    if (commaIndex !== -1) {
      const header = dataUrl.substring(0, commaIndex);
      const mimeMatch = header.match(/:(.*?);/);
      if (mimeMatch && mimeMatch[1]) {
        mime = mimeMatch[1];
      }
      base64 = dataUrl.substring(commaIndex + 1);
    }

    // Strip all whitespaces, tabs, newlines
    base64 = base64.replace(/[\r\n\s]+/g, '');

    // Convert URL-safe characters to standard Base64
    base64 = base64.replace(/-/g, '+').replace(/_/g, '/');

    // Add necessary padding
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }

    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  } catch (e) {
    console.error('Failed to convert base64 dataUrl to Blob:', e);
    return new Blob([], { type: fallbackMime });
  }
}

/**
 * Saves genuine uploaded file binary to Cloud Firestore so the shop handler or any other
 * authorized user can download and open the real authentic document.
 * Files are chunked cleanly to fit within Firestore document limits.
 */
export async function saveOrderFileToCloud(
  fileId: string,
  file: File | Blob,
  meta: { originalName: string; mimeType?: string; sizeBytes?: number }
): Promise<void> {
  if (!db) return;

  try {
    const base64Data = await fileToBase64(file);
    const mimeType = file.type || meta.mimeType || 'application/octet-stream';
    const originalName = meta.originalName || 'Document.pdf';
    const sizeBytes = file.size || meta.sizeBytes || 0;

    const CHUNK_SIZE = 450000; // ~450KB characters per chunk, well within Firestore 1MB doc limit
    const totalLength = base64Data.length;

    if (totalLength <= CHUNK_SIZE) {
      // Single doc storage
      const fileDocRef = doc(db, 'orderFiles', fileId);
      await setDoc(fileDocRef, {
        fileId,
        originalName,
        mimeType,
        sizeBytes,
        totalChunks: 1,
        data: base64Data,
        createdAt: new Date().toISOString(),
      });
    } else {
      // Chunked storage for larger multi-megabyte documents
      const totalChunks = Math.ceil(totalLength / CHUNK_SIZE);
      const fileDocRef = doc(db, 'orderFiles', fileId);

      await setDoc(fileDocRef, {
        fileId,
        originalName,
        mimeType,
        sizeBytes,
        totalChunks,
        createdAt: new Date().toISOString(),
      });

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, totalLength);
        const chunkSlice = base64Data.slice(start, end);
        const chunkDocRef = doc(db, 'orderFiles', fileId, 'chunks', `chunk_${i}`);
        await setDoc(chunkDocRef, {
          index: i,
          data: chunkSlice,
        });
      }
    }
  } catch (err) {
    console.warn('Could not save file to Firestore orderFiles:', err);
  }
}

/**
 * Fetches an uploaded file's genuine binary from Cloud Firestore and reconstructs it into a Blob.
 */
export async function fetchOrderFileFromCloud(
  fileId: string
): Promise<{ blob: Blob; fileName: string; mimeType: string } | null> {
  if (!db) return null;

  try {
    const fileDocRef = doc(db, 'orderFiles', fileId);
    const snap = await getDoc(fileDocRef);
    if (!snap.exists()) return null;

    const fileMeta = snap.data();
    const originalName = fileMeta.originalName || 'document.pdf';
    const mimeType = fileMeta.mimeType || 'application/octet-stream';
    const totalChunks = fileMeta.totalChunks || 1;

    let fullBase64 = '';

    if (totalChunks === 1 && fileMeta.data) {
      fullBase64 = fileMeta.data;
    } else {
      const chunksColRef = collection(db, 'orderFiles', fileId, 'chunks');
      const chunksSnap = await getDocs(chunksColRef);
      const chunkDocs = chunksSnap.docs.map((d) => d.data() as { index: number; data: string });
      chunkDocs.sort((a, b) => a.index - b.index);
      fullBase64 = chunkDocs.map((c) => c.data).join('');
    }

    if (!fullBase64) return null;

    const blob = dataUrlToBlob(fullBase64, mimeType);
    return { blob, fileName: originalName, mimeType };
  } catch (err) {
    console.warn('Error fetching order file from cloud:', err);
    return null;
  }
}
