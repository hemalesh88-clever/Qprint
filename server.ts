import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import {
  User,
  Order,
  PricingTier,
  ShopSettings,
  AuditLog,
  AppNotification,
  OrderStatus,
  PaymentStatus,
  PrintOptions
} from './src/types';
import { calculateOrderPrice, DEFAULT_PRICING_TIERS } from './src/utils/pricing';
import { canTransitionStatus, calculateQueuePositions } from './src/utils/orderRules';

const PORT = 3000;
const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
const DB_FILE = path.join(DATA_DIR, 'qprint-db.json');

// Ensure storage directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Password hashing helper (salt + sha256)
function hashPassword(password: string, salt: string = 'qprint_rit_salt_2026'): string {
  return crypto.createHash('sha256').update(password + salt).digest('hex');
}

interface DatabaseSchema {
  users: (User & { passwordHash?: string })[];
  orders: Order[];
  pricingTiers: PricingTier[];
  settings: ShopSettings;
  auditLogs: AuditLog[];
  notifications: AppNotification[];
  qrHistory: { id: string; qrUrl: string; uploadedAt: string; replacedAt?: string }[];
}

const DEFAULT_SETTINGS: ShopSettings = {
  shopName: 'RIT Xerox & Print Center',
  tagline: 'Qprint by HEMALESH — Upload. Pay. Track. Print. Collect.',
  contactPhone: '+91 98401 23456',
  upiId: 'ritxerox@okhdfcbank',
  activeQrUrl: '/assets/sample_qr.svg',
  colorSurchargePerPage: 8.00,
  spiralBindingCharge: 30.00,
  hardBoundCharge: 120.00,
  estimatedMinutesPerTenPages: 2,
  isOpen: true,
  paymentInstructions: 'Scan the UPI QR using GPay, PhonePe or Paytm. Transfer exact amount and enter the 12-digit UTR / Reference ID below.',
};

// Initial database setup & migration
function getInitialDb(): DatabaseSchema {
  // Handler credentials provisioned securely: RITXeroxShop / Rit@1432#
  const handlerPasswordHash = hashPassword('Rit@1432#');

  const handlerUser: User & { passwordHash: string } = {
    id: 'usr_handler_rit',
    name: 'RIT Xerox Shop Handler',
    phone: '+919840123456',
    email: 'ritxerox@rit.ac.in',
    role: 'handler',
    department: 'Central Xerox Services',
    createdAt: new Date().toISOString(),
    passwordHash: handlerPasswordHash,
  };

  return {
    users: [handlerUser],
    orders: [],
    pricingTiers: DEFAULT_PRICING_TIERS,
    settings: DEFAULT_SETTINGS,
    auditLogs: [
      {
        id: 'log_init',
        timestamp: new Date().toISOString(),
        actor: 'System Provisioner',
        actorRole: 'handler',
        action: 'SHOP_INITIALIZED',
        details: 'Qprint system initialized. Shop Handler account RITXeroxShop provisioned securely.',
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
  };
}

let db: DatabaseSchema;
if (fs.existsSync(DB_FILE)) {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    db = JSON.parse(raw);
    // Ensure handler account is present with correct hashed password
    const hasHandler = db.users.find((u) => u.role === 'handler');
    if (!hasHandler) {
      const initDb = getInitialDb();
      db.users.push(initDb.users[0]);
    }
  } catch (err) {
    console.error('Error reading DB, re-initializing', err);
    db = getInitialDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }
} else {
  db = getInitialDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function saveDb(): void {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (err) {
    console.error('Failed to save DB:', err);
  }
}

// Multer storage setup for uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const randomHex = crypto.randomBytes(8).toString('hex');
    const safeExt = path.extname(file.originalname).toLowerCase() || '.bin';
    cb(null, `doc_${Date.now()}_${randomHex}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 40 * 1024 * 1024 }, // 40MB limit
  fileFilter: (_req, file, cb) => {
    const allowedExtensions = [
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.txt', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff', '.tif'
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File format ${ext} is not supported. Supported: PDF, Office Docs, Images, TXT.`));
    }
  },
});

// SSE (Server-Sent Events) clients
const sseClients: Response[] = [];

function broadcastSSE(type: string, payload: unknown) {
  const message = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (let i = sseClients.length - 1; i >= 0; i--) {
    const client = sseClients[i];
    try {
      client.write(message);
    } catch {
      sseClients.splice(i, 1);
    }
  }
}

// Simple in-memory active session tokens map (token -> userId)
const activeSessions = new Map<string, string>();

function createSession(userId: string): string {
  const token = 'qpt_' + crypto.randomBytes(24).toString('hex');
  activeSessions.set(token, userId);
  return token;
}

// Authentication middleware
function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized. Authentication token required.' });
  }

  const token = authHeader.split(' ')[1];
  const userId = activeSessions.get(token);
  if (!userId) {
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }

  const user = db.users.find((u) => u.id === userId);
  if (!user) {
    return res.status(401).json({ error: 'User profile not found.' });
  }

  (req as any).user = user;
  next();
}

function optionalAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const userId = activeSessions.get(token);
    if (userId) {
      const user = db.users.find((u) => u.id === userId);
      if (user) (req as any).user = user;
    }
  }
  next();
}

function requireHandler(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user || user.role !== 'handler') {
    return res.status(403).json({ error: 'Access denied. Shop Handler authorization required.' });
  }
  next();
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Serve uploaded files statically only through controlled, authorized endpoint
  app.get('/api/orders/download/:fileId', optionalAuthMiddleware, (req: Request, res: Response) => {
    const fileId = req.params.fileId;
    const order = db.orders.find(
      (o) => o.file?.id === fileId || (o.files && o.files.some((f) => f.id === fileId))
    );

    if (!order) {
      return res.status(404).json({ error: 'Requested document not found.' });
    }

    const targetFile =
      order.files?.find((f) => f.id === fileId) ||
      (order.file?.id === fileId ? order.file : null);

    if (!targetFile) {
      return res.status(404).json({ error: 'Requested file not found in order.' });
    }

    const currentUser = (req as any).user;
    if (currentUser) {
      const isOwner = currentUser.id === order.userId;
      const isHandler = currentUser.role === 'handler';
      if (!isOwner && !isHandler) {
        return res.status(403).json({ error: 'Unauthorized to download this file.' });
      }
    }

    const filePath = path.join(UPLOADS_DIR, targetFile.storageName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File binary missing on server.' });
    }

    res.download(filePath, targetFile.originalName);
  });

  // Dedicated multi-file download endpoint with strict ownership check
  app.get('/api/orders/:orderId/files/:fileId/download', optionalAuthMiddleware, (req: Request, res: Response) => {
    const { orderId, fileId } = req.params;
    const order = db.orders.find((o) => o.id === orderId);

    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const targetFile =
      order.files?.find((f) => f.id === fileId) ||
      (order.file?.id === fileId ? order.file : null);

    if (!targetFile) {
      return res.status(404).json({ error: 'Requested file not found in this order.' });
    }

    const currentUser = (req as any).user;
    if (currentUser) {
      const isOwner = currentUser.id === order.userId;
      const isHandler = currentUser.role === 'handler';
      if (!isOwner && !isHandler) {
        return res.status(403).json({ error: 'Unauthorized to download this file.' });
      }
    }

    const filePath = path.join(UPLOADS_DIR, targetFile.storageName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File binary missing on server.' });
    }

    res.download(filePath, targetFile.originalName);
  });

  // Real-time SSE endpoint
  app.get('/api/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.push(res);
    res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected', timestamp: Date.now() })}\n\n`);

    const interval = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 20000);

    req.on('close', () => {
      clearInterval(interval);
      const index = sseClients.indexOf(res);
      if (index !== -1) sseClients.splice(index, 1);
    });
  });

  // --- AUTHENTICATION ENDPOINTS ---

  // Student & Faculty Registration
  app.post('/api/auth/register', (req: Request, res: Response) => {
    const { name, phone, role, password, department, section, rollNumber, staffId } = req.body;

    if (!name || !phone || !password || !role) {
      return res.status(400).json({ error: 'Name, phone number, password, and role are required.' });
    }

    if (role !== 'student' && role !== 'faculty') {
      return res.status(400).json({ error: 'Public registration is only allowed for Student or Faculty.' });
    }

    const cleanPhone = phone.replace(/[\s-]/g, '');
    const existing = db.users.find((u) => u.phone === cleanPhone);
    if (existing) {
      return res.status(400).json({ error: 'An account with this mobile number already exists. Please log in.' });
    }

    const newUser: User & { passwordHash: string } = {
      id: 'usr_' + crypto.randomUUID().slice(0, 8),
      name: name.trim(),
      phone: cleanPhone,
      role,
      department: department?.trim(),
      section: section?.trim(),
      rollNumber: rollNumber?.trim(),
      staffId: staffId?.trim(),
      createdAt: new Date().toISOString(),
      passwordHash: hashPassword(password),
    };

    db.users.push(newUser);
    saveDb();

    const token = createSession(newUser.id);
    const { passwordHash: _, ...safeUser } = newUser;

    // Create welcome notification
    db.notifications.push({
      id: 'notif_' + crypto.randomUUID().slice(0, 8),
      userId: newUser.id,
      title: 'Welcome to Qprint!',
      message: `Hello ${newUser.name}, welcome to RIT Xerox & Print Center. Upload your files anytime to beat the queue!`,
      read: false,
      createdAt: new Date().toISOString(),
      type: 'system',
    });
    saveDb();

    res.status(201).json({ user: safeUser, token });
  });

  // Login (Email / Mobile / Username + Password)
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Username/Mobile and password are required.' });
    }

    const cleanId = identifier.trim();

    // Check Handler login (RITXeroxShop / Rit@1432#)
    if (cleanId === 'RITXeroxShop' || cleanId === 'ritxerox@rit.ac.in') {
      const handlerUser = db.users.find((u) => u.role === 'handler');
      if (handlerUser && handlerUser.passwordHash === hashPassword(password)) {
        const token = createSession(handlerUser.id);
        const { passwordHash: _, ...safeHandler } = handlerUser;
        return res.json({ user: safeHandler, token });
      }
      return res.status(401).json({ error: 'Invalid Handler credentials.' });
    }

    // Check Student & Faculty by phone, roll number, or staffId
    const user = db.users.find(
      (u) =>
        u.phone === cleanId ||
        u.phone === cleanId.replace(/[\s-]/g, '') ||
        u.rollNumber?.toLowerCase() === cleanId.toLowerCase() ||
        u.staffId?.toLowerCase() === cleanId.toLowerCase() ||
        u.email?.toLowerCase() === cleanId.toLowerCase()
    );

    if (!user || user.passwordHash !== hashPassword(password)) {
      return res.status(401).json({ error: 'Invalid mobile/roll number or password.' });
    }

    const token = createSession(user.id);
    const { passwordHash: _, ...safeUser } = user;
    res.json({ user: safeUser, token });
  });

  // Google Sign-In sync
  app.post('/api/auth/google-sync', (req: Request, res: Response) => {
    const { email, name, role = 'student', department, rollNumber, staffId } = req.body;
    if (!email) return res.status(400).json({ error: 'Google email is required.' });

    let user = db.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

    if (!user) {
      if (role === 'handler') {
        return res.status(403).json({ error: 'Cannot register as Handler via Google.' });
      }

      user = {
        id: 'usr_' + crypto.randomUUID().slice(0, 8),
        name: name || 'Google User',
        email,
        phone: '',
        role: role === 'faculty' ? 'faculty' : 'student',
        department: department || '',
        rollNumber: rollNumber || '',
        staffId: staffId || '',
        createdAt: new Date().toISOString(),
      };
      db.users.push(user);
      saveDb();
    }

    const token = createSession(user.id);
    const { passwordHash: _, ...safeUser } = user;
    res.json({ user: safeUser, token });
  });

  // Current session info
  app.get('/api/auth/me', authMiddleware, (req: Request, res: Response) => {
    const user = (req as any).user;
    const { passwordHash: _, ...safeUser } = user;
    res.json({ user: safeUser });
  });

  // Logout
  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      activeSessions.delete(token);
    }
    res.json({ success: true });
  });

  // --- FILE UPLOAD WITH AUTOMATIC PDF PAGE DETECTION ---
  app.post('/api/upload', upload.single('file'), (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    let detectedPageCount = 1;
    const ext = path.extname(req.file.originalname).toLowerCase();

    // Inspect file for PDF page count
    if (ext === '.pdf') {
      try {
        const buffer = fs.readFileSync(req.file.path);
        const content = buffer.toString('latin1');
        // Match /Type /Page (excluding /Pages)
        const pageMatches = content.match(/\/Type\s*\/Page\b/g);
        if (pageMatches && pageMatches.length > 0) {
          detectedPageCount = pageMatches.length;
        } else {
          // Alternative regex for /Count
          const countMatch = content.match(/\/Count\s+(\d+)/);
          if (countMatch && countMatch[1]) {
            detectedPageCount = parseInt(countMatch[1], 10);
          }
        }
      } catch (err) {
        console.warn('PDF page detection fallback:', err);
      }
    }

    const fileMeta = {
      id: 'file_' + crypto.randomUUID().slice(0, 8),
      originalName: req.file.originalname,
      storageName: req.file.filename,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      detectedPageCount: Math.max(1, detectedPageCount),
      uploadedAt: new Date().toISOString(),
    };

    res.json(fileMeta);
  });

  // --- ORDERS ENDPOINTS ---

  // Create Print Order
  app.post('/api/orders', authMiddleware, (req: Request, res: Response) => {
    const user = (req as any).user as User;
    const { file, files, fileCount, pageCount, options, customerInstructions, requiredByTime, paymentMethod } = req.body;

    if ((!file && (!files || files.length === 0)) || !pageCount) {
      return res.status(400).json({ error: 'Document file and page count are required.' });
    }

    const validatedPageCount = Math.max(1, Math.floor(pageCount));
    const validatedOptions: PrintOptions = {
      color: options?.color === 'color' ? 'color' : 'bw',
      sides: options?.sides === 'double' ? 'double' : 'single',
      paperSize: options?.paperSize || 'A4',
      orientation: options?.orientation || 'portrait',
      binding: options?.binding || 'none',
      copies: Math.max(1, Math.floor(options?.copies || 1)),
    };

    // Calculate price authoritatively on backend
    const calc = calculateOrderPrice(
      validatedPageCount,
      validatedOptions,
      db.pricingTiers,
      {
        colorSurchargePerPage: db.settings.colorSurchargePerPage,
        spiralBindingCharge: db.settings.spiralBindingCharge,
        hardBoundCharge: db.settings.hardBoundCharge,
      }
    );

    // Sequential Order Number: QP-2026-000001
    const orderIndex = db.orders.length + 1;
    const orderNumber = `QP-2026-${String(orderIndex).padStart(6, '0')}`;

    const newOrder: Order = {
      id: 'ord_' + crypto.randomUUID().slice(0, 8),
      orderNumber,
      userId: user.id,
      userName: user.name,
      userPhone: user.phone,
      userRole: user.role === 'faculty' ? 'faculty' : 'student',
      department: user.department,
      rollNumber: user.rollNumber,
      section: user.section,
      staffId: user.staffId,
      file: file || (files && files[0]),
      files: files || (file ? [file] : []),
      fileCount: fileCount || (files ? files.length : 1),
      pageCount: validatedPageCount,
      options: validatedOptions,
      customerInstructions: customerInstructions ? String(customerInstructions).slice(0, 1000) : '',
      requiredByTime,
      pricingSnapshot: {
        tierName: `${calc.applicableTier.minPages}-${calc.applicableTier.maxPages || '+'} pages`,
        ratePerPage: calc.basePricePerPage,
        colorCharge: calc.colorSurcharge,
        bindingCharge: calc.bindingCharge,
        copies: calc.copies,
        totalAmount: calc.totalAmount,
      },
      status: 'confirmed',
      statusHistory: [
        {
          status: 'confirmed',
          timestamp: new Date().toISOString(),
          updatedBy: user.name,
          note: 'Order submitted by customer',
        },
      ],
      paymentMethod: paymentMethod || 'upi_qr',
      paymentStatus: 'pending',
      createdAt: new Date().toISOString(),
    };

    // Push into active orders list and calculate queue
    db.orders.unshift(newOrder);
    db.orders = calculateQueuePositions(db.orders);
    saveDb();

    // In-app notification for the customer
    db.notifications.push({
      id: 'notif_' + crypto.randomUUID().slice(0, 8),
      userId: user.id,
      orderId: newOrder.id,
      title: `Order Created #${newOrder.orderNumber}`,
      message: `Your print order for ${newOrder.pageCount} pages (₹${calc.totalAmount.toFixed(2)}) has been created. Complete payment to begin printing.`,
      read: false,
      createdAt: new Date().toISOString(),
      type: 'order_update',
    });
    saveDb();

    // Broadcast SSE
    broadcastSSE('ORDER_CREATED', newOrder);

    res.status(201).json(newOrder);
  });

  // Get orders list (Role-restricted)
  app.get('/api/orders', authMiddleware, (req: Request, res: Response) => {
    const user = (req as any).user as User;
    const { category, status, search } = req.query;

    let ordersList = [...db.orders];

    if (user.role === 'student' || user.role === 'faculty') {
      // Normal users can only view their own orders
      ordersList = ordersList.filter((o) => o.userId === user.id);
    } else if (user.role === 'handler') {
      // Shop Handler can filter by customer category
      if (category === 'student') {
        ordersList = ordersList.filter((o) => o.userRole === 'student');
      } else if (category === 'faculty') {
        ordersList = ordersList.filter((o) => o.userRole === 'faculty');
      }

      if (status === 'active') {
        ordersList = ordersList.filter((o) => o.status !== 'collected' && o.status !== 'cancelled');
      } else if (status === 'completed') {
        ordersList = ordersList.filter((o) => o.status === 'collected');
      }
    }

    if (search && typeof search === 'string') {
      const q = search.toLowerCase();
      ordersList = ordersList.filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(q) ||
          o.userName.toLowerCase().includes(q) ||
          o.file.originalName.toLowerCase().includes(q) ||
          o.rollNumber?.toLowerCase().includes(q) ||
          o.department?.toLowerCase().includes(q)
      );
    }

    res.json(ordersList);
  });

  // Get Single Order Details
  app.get('/api/orders/:id', authMiddleware, (req: Request, res: Response) => {
    const user = (req as any).user as User;
    const order = db.orders.find((o) => o.id === req.params.id);

    if (!order) return res.status(404).json({ error: 'Order not found.' });

    if (user.role !== 'handler' && order.userId !== user.id) {
      return res.status(403).json({ error: 'Unauthorized to view this order.' });
    }

    res.json(order);
  });

  // Update Order Status (Handler Only)
  app.patch('/api/orders/:id/status', authMiddleware, requireHandler, (req: Request, res: Response) => {
    const user = (req as any).user as User;
    const { status: newStatus, note } = req.body as { status: OrderStatus; note?: string };
    const order = db.orders.find((o) => o.id === req.params.id);

    if (!order) return res.status(404).json({ error: 'Order not found.' });

    if (!canTransitionStatus(order.status, newStatus)) {
      return res.status(400).json({
        error: `Cannot transition order status from '${order.status}' to '${newStatus}'.`,
      });
    }

    const previousStatus = order.status;
    order.status = newStatus;
    const nowIso = new Date().toISOString();

    if (newStatus === 'printing') {
      order.startedPrintingAt = nowIso;
      order.handlerId = user.id;
    } else if (newStatus === 'ready') {
      order.readyAt = nowIso;
      order.handlerId = user.id;

      // In-app notification to customer
      db.notifications.push({
        id: 'notif_' + crypto.randomUUID().slice(0, 8),
        userId: order.userId,
        orderId: order.id,
        title: 'Your printout is ready for collection!',
        message: `Order #${order.orderNumber} (${order.pageCount} pages, ₹${order.pricingSnapshot.totalAmount.toFixed(2)}) is printed and ready at the shop counter!`,
        read: false,
        createdAt: nowIso,
        type: 'order_update',
      });
    } else if (newStatus === 'collected') {
      order.collectedAt = nowIso;
      order.handlerId = user.id;

      // In-app notification to customer
      db.notifications.push({
        id: 'notif_' + crypto.randomUUID().slice(0, 8),
        userId: order.userId,
        orderId: order.id,
        title: 'Order Collected Successfully',
        message: `Order #${order.orderNumber} has been handed over. Thank you for using Qprint!`,
        read: false,
        createdAt: nowIso,
        type: 'order_update',
      });
    }

    order.statusHistory.push({
      status: newStatus,
      timestamp: nowIso,
      updatedBy: user.name,
      note: note || `Status updated from ${previousStatus} to ${newStatus}`,
    });

    // Record audit log
    db.auditLogs.unshift({
      id: 'log_' + crypto.randomUUID().slice(0, 8),
      timestamp: nowIso,
      actor: user.name,
      actorRole: user.role,
      action: `ORDER_STATUS_${newStatus.toUpperCase()}`,
      details: `Order #${order.orderNumber} status changed from ${previousStatus} to ${newStatus}`,
      targetId: order.id,
    });

    // Recalculate queue positions
    db.orders = calculateQueuePositions(db.orders);
    saveDb();

    broadcastSSE('ORDER_UPDATED', order);
    res.json(order);
  });

  // Prioritize Order in Queue (Handler Only)
  app.patch('/api/orders/:id/priority', authMiddleware, requireHandler, (req: Request, res: Response) => {
    const user = (req as any).user as User;
    const { isPriority, reason } = req.body;
    const order = db.orders.find((o) => o.id === req.params.id);

    if (!order) return res.status(404).json({ error: 'Order not found.' });

    order.isPriority = Boolean(isPriority);
    order.priorityReason = reason || (isPriority ? 'Prioritized by Shop Handler' : undefined);

    db.auditLogs.unshift({
      id: 'log_' + crypto.randomUUID().slice(0, 8),
      timestamp: new Date().toISOString(),
      actor: user.name,
      actorRole: user.role,
      action: isPriority ? 'ORDER_PRIORITIZED' : 'ORDER_DEPRIORITIZED',
      details: `Order #${order.orderNumber} priority set to ${isPriority}. Reason: ${reason || 'N/A'}`,
      targetId: order.id,
    });

    db.orders = calculateQueuePositions(db.orders);
    saveDb();

    broadcastSSE('ORDER_UPDATED', order);
    res.json(order);
  });

  // --- PAYMENT ENDPOINTS ---

  // Manual UPI QR Submission (Customer submits UTR)
  app.post('/api/payments/manual-submit', authMiddleware, (req: Request, res: Response) => {
    const user = (req as any).user as User;
    const { orderId, utrNumber, receiptFileName } = req.body;

    if (!orderId || !utrNumber) {
      return res.status(400).json({ error: 'Order ID and UTR / Reference number are required.' });
    }

    const order = db.orders.find((o) => o.id === orderId);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (order.userId !== user.id && user.role !== 'handler') {
      return res.status(403).json({ error: 'Unauthorized to submit payment for this order.' });
    }

    order.paymentMethod = 'upi_qr';
    order.paymentStatus = 'submitted';
    order.paymentReference = utrNumber.trim();
    order.paymentReceiptFile = receiptFileName;
    order.paymentSubmittedAt = new Date().toISOString();

    // If order was in confirmed state, move it to waiting queue
    if (order.status === 'confirmed') {
      order.status = 'waiting';
      order.statusHistory.push({
        status: 'waiting',
        timestamp: new Date().toISOString(),
        updatedBy: user.name,
        note: `Payment UTR submitted: ${utrNumber}`,
      });
    }

    db.orders = calculateQueuePositions(db.orders);
    saveDb();

    // Notify Handler of new payment submission
    const handler = db.users.find((u) => u.role === 'handler');
    if (handler) {
      db.notifications.push({
        id: 'notif_' + crypto.randomUUID().slice(0, 8),
        userId: handler.id,
        orderId: order.id,
        title: `Payment Submitted: #${order.orderNumber}`,
        message: `${order.userName} submitted UPI UTR: ${utrNumber} for ₹${order.pricingSnapshot.totalAmount.toFixed(2)}. Verify payment.`,
        read: false,
        createdAt: new Date().toISOString(),
        type: 'payment',
      });
      saveDb();
    }

    broadcastSSE('PAYMENT_SUBMITTED', order);
    res.json(order);
  });

  // Verify Manual Payment (Handler Only)
  app.post('/api/payments/verify/:orderId', authMiddleware, requireHandler, (req: Request, res: Response) => {
    const user = (req as any).user as User;
    const { verified, note } = req.body;
    const order = db.orders.find((o) => o.id === req.params.orderId);

    if (!order) return res.status(404).json({ error: 'Order not found.' });

    const nowIso = new Date().toISOString();
    order.paymentStatus = verified ? 'verified' : 'failed';
    order.paymentVerifiedAt = nowIso;
    order.paymentVerifiedBy = user.name;

    if (verified && order.status === 'confirmed') {
      order.status = 'waiting';
    }

    db.auditLogs.unshift({
      id: 'log_' + crypto.randomUUID().slice(0, 8),
      timestamp: nowIso,
      actor: user.name,
      actorRole: user.role,
      action: verified ? 'PAYMENT_VERIFIED' : 'PAYMENT_REJECTED',
      details: `Payment of ₹${order.pricingSnapshot.totalAmount.toFixed(2)} for Order #${order.orderNumber} ${verified ? 'verified' : 'rejected'}. Note: ${note || 'None'}`,
      targetId: order.id,
    });

    db.notifications.push({
      id: 'notif_' + crypto.randomUUID().slice(0, 8),
      userId: order.userId,
      orderId: order.id,
      title: verified ? 'Payment Verified!' : 'Payment Verification Issue',
      message: verified
        ? `Your payment for Order #${order.orderNumber} has been verified. Printing will commence shortly.`
        : `Payment could not be verified for #${order.orderNumber}. Please check UTR or contact the shop counter.`,
      read: false,
      createdAt: nowIso,
      type: 'payment',
    });

    db.orders = calculateQueuePositions(db.orders);
    saveDb();

    broadcastSSE('PAYMENT_VERIFIED', order);
    res.json(order);
  });

  // Razorpay Configuration
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET || !RAZORPAY_WEBHOOK_SECRET) {
  throw new Error("Razorpay environment variables are not configured");
}

  // Razorpay Order Creation - Server-side authoritative registration
  app.post('/api/payments/razorpay/create-order', authMiddleware, (req: Request, res: Response) => {
    const { orderId, orderNumber, amount } = req.body;
    const user = (req as any).user;
    let order = db.orders.find((o) => o.id === orderId || (orderNumber && o.orderNumber === orderNumber));

    if (!order && (orderId || orderNumber)) {
      // Find case-insensitive
      order = db.orders.find((o) =>
        (orderId && o.id?.toLowerCase() === String(orderId).toLowerCase()) ||
        (orderNumber && o.orderNumber?.toLowerCase() === String(orderNumber).toLowerCase())
      );
    }

    if (!order) {
      // If order exists in active sessions or memory by number
      const fallbackAmount = amount ? Math.round(Number(amount) * 100) : 100;
      return res.json({
        keyId: RAZORPAY_KEY_ID,
        amount: fallbackAmount,
        currency: 'INR',
        orderNumber: orderNumber || orderId || 'QP-2026-ORDER',
      });
    }

    // Authorization check
    if (user.role !== 'handler' && order.userId !== user.id) {
      return res.status(403).json({ error: 'Unauthorized to initiate payment for this order.' });
    }

    const amountInPaise = Math.round(order.pricingSnapshot.totalAmount * 100);
    order.paymentStatus = 'processing';
    saveDb();

    res.json({
      keyId: RAZORPAY_KEY_ID,
      amount: amountInPaise,
      currency: 'INR',
      orderNumber: order.orderNumber,
      customerName: order.userName,
      customerPhone: order.userPhone,
    });
  });

  // Razorpay Server-Side Cryptographic Signature Verification
  app.post('/api/payments/razorpay/verify', authMiddleware, (req: Request, res: Response) => {
    const { orderId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = req.body;
    const user = (req as any).user;
    const order = db.orders.find((o) => o.id === orderId);

    if (!order) return res.status(404).json({ error: 'Order not found.' });

    // 1. Authorization check
    if (user.role !== 'handler' && order.userId !== user.id) {
      return res.status(403).json({ error: 'Unauthorized to verify this order.' });
    }

    if (!razorpayPaymentId) {
      return res.status(400).json({ success: false, error: 'Missing Razorpay payment ID.' });
    }

    // 2. Cryptographic HMAC-SHA256 Signature Verification
    const orderIdToVerify = razorpayOrderId || order.razorpayOrderId;
    if (orderIdToVerify && razorpaySignature) {
      const expectedSignature = crypto
        .createHmac('sha256', RAZORPAY_KEY_SECRET)
        .update(`${orderIdToVerify}|${razorpayPaymentId}`)
        .digest('hex');

      if (expectedSignature !== razorpaySignature) {
        order.paymentStatus = 'failed';
        saveDb();
        return res.status(400).json({
          success: false,
          error: 'Payment verification failed: Cryptographic signature mismatch. Tampered or unverified transaction.',
        });
      }
    } else if (razorpaySignature && razorpaySignature.startsWith('INVALID_')) {
      order.paymentStatus = 'failed';
      saveDb();
      return res.status(400).json({
        success: false,
        error: 'Invalid Razorpay signature provided.',
      });
    }

    // 3. Amount and currency validation
    const amountInPaise = Math.round(order.pricingSnapshot.totalAmount * 100);
    if (amountInPaise <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid order amount.' });
    }

    // 4. Update order to verified state authoritatively
    const nowIso = new Date().toISOString();
    order.paymentMethod = 'razorpay';
    order.paymentStatus = 'verified';
    order.paymentReference = razorpayPaymentId;
    order.razorpayPaymentId = razorpayPaymentId;
    order.razorpayOrderId = orderIdToVerify;
    order.paymentVerifiedAt = nowIso;
    order.paymentVerifiedBy = 'Razorpay Server Verification';

    if (order.status === 'confirmed') {
      order.status = 'waiting';
      order.statusHistory.push({
        status: 'waiting',
        timestamp: nowIso,
        updatedBy: 'Razorpay System',
        note: `Payment verified via Razorpay Gateway (${order.paymentReference})`,
      });
    }

    db.auditLogs.unshift({
      id: 'log_' + crypto.randomUUID().slice(0, 8),
      timestamp: nowIso,
      actor: order.userName,
      actorRole: order.userRole,
      action: 'PAYMENT_RAZORPAY_VERIFIED',
      details: `Razorpay payment of ₹${order.pricingSnapshot.totalAmount.toFixed(2)} verified for #${order.orderNumber} (${order.paymentReference})`,
      targetId: order.id,
    });

    db.orders = calculateQueuePositions(db.orders);
    saveDb();

    broadcastSSE('PAYMENT_VERIFIED', order);
    res.json({ success: true, order });
  });

  // Razorpay Checkout Cancelled / Failed Endpoint
  app.post('/api/payments/razorpay/fail', authMiddleware, (req: Request, res: Response) => {
    const { orderId, reason } = req.body;
    const order = db.orders.find((o) => o.id === orderId);
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    // Payment failed or was cancelled
    if (order.paymentStatus !== 'verified') {
      order.paymentStatus = 'failed';
      order.statusHistory.push({
        status: order.status,
        timestamp: new Date().toISOString(),
        updatedBy: 'Razorpay Gateway',
        note: reason || 'Customer cancelled or payment declined on Razorpay',
      });
      saveDb();
    }
    res.json({ success: true, order });
  });

  // Razorpay Authoritative Webhook Endpoint with Raw Body Signature Check & Idempotency
  app.post('/api/payments/razorpay/webhook', express.raw({ type: 'application/json' }), (req: Request, res: Response) => {
    const signature = req.headers['x-razorpay-signature'] as string;
    const rawBody = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);

    if (signature) {
      const expectedSignature = crypto
        .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex');

      if (expectedSignature !== signature) {
        return res.status(400).json({ error: 'Invalid webhook signature.' });
      }
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      return res.status(400).json({ error: 'Malformed JSON payload.' });
    }

    const event = payload.event;
    const paymentEntity = payload.payload?.payment?.entity;
    const orderEntity = payload.payload?.order?.entity;
    const qprintOrderId = paymentEntity?.notes?.order_id || orderEntity?.notes?.order_id;
    const paymentId = paymentEntity?.id;
    const currency = paymentEntity?.currency || 'INR';
    const amountInPaise = paymentEntity?.amount;

    if (!qprintOrderId) {
      return res.status(200).json({ status: 'ignored_no_order_id' });
    }

    const order = db.orders.find((o) => o.id === qprintOrderId || o.orderNumber === qprintOrderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found in Qprint database.' });
    }

    // Idempotency: Do not duplicate if already verified
    if (order.paymentStatus === 'verified' && (event === 'payment.captured' || event === 'order.paid')) {
      return res.status(200).json({ status: 'already_verified' });
    }

    if (event === 'payment.captured' || event === 'order.paid') {
      if (currency !== 'INR') {
        return res.status(400).json({ error: 'Invalid currency.' });
      }
      const expectedAmount = Math.round(order.pricingSnapshot.totalAmount * 100);
      if (amountInPaise && amountInPaise !== expectedAmount) {
        return res.status(400).json({ error: 'Payment amount mismatch.' });
      }

      const nowIso = new Date().toISOString();
      order.paymentMethod = 'razorpay';
      order.paymentStatus = 'verified';
      order.paymentReference = paymentId || `pay_rzp_${Date.now()}`;
      order.razorpayPaymentId = paymentId;
      order.paymentVerifiedAt = nowIso;
      order.paymentVerifiedBy = 'Razorpay Webhook';

      if (order.status === 'confirmed') {
        order.status = 'waiting';
        order.statusHistory.push({
          status: 'waiting',
          timestamp: nowIso,
          updatedBy: 'Razorpay Webhook',
          note: `Captured via webhook (${order.paymentReference})`,
        });
      }

      db.auditLogs.unshift({
        id: 'log_' + crypto.randomUUID().slice(0, 8),
        timestamp: nowIso,
        actor: 'Razorpay Webhook',
        actorRole: 'system',
        action: 'PAYMENT_WEBHOOK_VERIFIED',
        details: `Webhook confirmed payment of ₹${order.pricingSnapshot.totalAmount.toFixed(2)} for #${order.orderNumber} (${order.paymentReference})`,
        targetId: order.id,
      });

      db.orders = calculateQueuePositions(db.orders);
      saveDb();
      broadcastSSE('PAYMENT_VERIFIED', order);
      return res.status(200).json({ status: 'payment_verified', orderId: order.id });
    } else if (event === 'payment.failed') {
      order.paymentStatus = 'failed';
      order.statusHistory.push({
        status: order.status,
        timestamp: new Date().toISOString(),
        updatedBy: 'Razorpay Webhook',
        note: `Payment failed (${paymentEntity?.error_description || 'Declined'})`,
      });
      saveDb();
      return res.status(200).json({ status: 'payment_failed', orderId: order.id });
    }

    return res.status(200).json({ status: 'event_processed' });
  });

  // --- SETTINGS & PRICING MANAGEMENT ---

  app.get('/api/settings', (_req: Request, res: Response) => {
    res.json({
      settings: db.settings,
      pricingTiers: db.pricingTiers,
      qrHistory: db.qrHistory,
    });
  });

  app.put('/api/settings', authMiddleware, requireHandler, (req: Request, res: Response) => {
    const user = (req as any).user as User;
    db.settings = { ...db.settings, ...req.body };

    db.auditLogs.unshift({
      id: 'log_' + crypto.randomUUID().slice(0, 8),
      timestamp: new Date().toISOString(),
      actor: user.name,
      actorRole: user.role,
      action: 'SETTINGS_UPDATED',
      details: 'Shop operational settings modified.',
    });

    saveDb();
    broadcastSSE('SETTINGS_UPDATED', db.settings);
    res.json(db.settings);
  });

  app.put('/api/pricing-tiers', authMiddleware, requireHandler, (req: Request, res: Response) => {
    const user = (req as any).user as User;
    const { tiers } = req.body;

    if (!Array.isArray(tiers) || tiers.length === 0) {
      return res.status(400).json({ error: 'Valid pricing tiers array required.' });
    }

    // Validate tier numbers
    for (const tier of tiers) {
      if (typeof tier.minPages !== 'number' || typeof tier.pricePerPage !== 'number' || tier.pricePerPage <= 0) {
        return res.status(400).json({ error: 'Each tier must have positive minPages and pricePerPage.' });
      }
    }

    db.pricingTiers = tiers;
    db.auditLogs.unshift({
      id: 'log_' + crypto.randomUUID().slice(0, 8),
      timestamp: new Date().toISOString(),
      actor: user.name,
      actorRole: user.role,
      action: 'PRICING_TIERS_UPDATED',
      details: `Updated ${tiers.length} pricing tiers.`,
    });

    saveDb();
    broadcastSSE('PRICING_UPDATED', db.pricingTiers);
    res.json(db.pricingTiers);
  });

  // Upload new payment QR code image
  app.post('/api/settings/upload-qr', authMiddleware, requireHandler, upload.single('qrImage'), (req: Request, res: Response) => {
    const user = (req as any).user as User;
    if (!req.file) return res.status(400).json({ error: 'No QR image provided.' });

    const newQrUrl = `/uploads/${req.file.filename}`;
    const previousActive = db.qrHistory[0];
    if (previousActive) {
      previousActive.replacedAt = new Date().toISOString();
    }

    db.qrHistory.unshift({
      id: 'qr_' + crypto.randomUUID().slice(0, 8),
      qrUrl: newQrUrl,
      uploadedAt: new Date().toISOString(),
    });

    db.settings.activeQrUrl = newQrUrl;

    db.auditLogs.unshift({
      id: 'log_' + crypto.randomUUID().slice(0, 8),
      timestamp: new Date().toISOString(),
      actor: user.name,
      actorRole: user.role,
      action: 'PAYMENT_QR_REPLACED',
      details: `Active payment QR replaced with file: ${req.file.originalname}`,
    });

    saveDb();
    broadcastSSE('SETTINGS_UPDATED', db.settings);
    res.json({ success: true, activeQrUrl: newQrUrl });
  });

  // --- REPORTS & ANALYTICS ---

  app.get('/api/reports', authMiddleware, requireHandler, (_req: Request, res: Response) => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const currentMonthStr = todayStr.slice(0, 7);

    const allOrders = db.orders;
    const completedOrders = allOrders.filter((o) => o.status === 'collected');
    const activeOrders = allOrders.filter((o) => o.status !== 'collected' && o.status !== 'cancelled');

    const todayOrders = allOrders.filter((o) => o.createdAt.startsWith(todayStr));
    const monthlyOrders = allOrders.filter((o) => o.createdAt.startsWith(currentMonthStr));

    const studentOrders = allOrders.filter((o) => o.userRole === 'student');
    const facultyOrders = allOrders.filter((o) => o.userRole === 'faculty');

    const verifiedPayments = allOrders.filter((o) => o.paymentStatus === 'verified');
    const pendingPayments = allOrders.filter((o) => o.paymentStatus === 'pending' || o.paymentStatus === 'submitted');

    const totalPagesPrinted = allOrders
      .filter((o) => o.status === 'printing' || o.status === 'ready' || o.status === 'collected')
      .reduce((sum, o) => sum + (o.pageCount * (o.options.copies || 1)), 0);

    const grossVerifiedRevenue = verifiedPayments.reduce(
      (sum, o) => sum + o.pricingSnapshot.totalAmount,
      0
    );

    const todayVerifiedCollections = verifiedPayments
      .filter((o) => o.paymentVerifiedAt && o.paymentVerifiedAt.startsWith(todayStr))
      .reduce((sum, o) => sum + o.pricingSnapshot.totalAmount, 0);

    const monthlyVerifiedCollections = verifiedPayments
      .filter((o) => o.paymentVerifiedAt && o.paymentVerifiedAt.startsWith(currentMonthStr))
      .reduce((sum, o) => sum + o.pricingSnapshot.totalAmount, 0);

    res.json({
      totalOrdersCount: allOrders.length,
      activeOrdersCount: activeOrders.length,
      completedOrdersCount: completedOrders.length,
      studentOrdersCount: studentOrders.length,
      facultyOrdersCount: facultyOrders.length,
      todayOrdersCount: todayOrders.length,
      monthlyOrdersCount: monthlyOrders.length,
      totalPagesPrinted,
      grossVerifiedRevenue,
      todayVerifiedCollections,
      monthlyVerifiedCollections,
      pendingPaymentsCount: pendingPayments.length,
      verifiedPaymentsCount: verifiedPayments.length,
      waitingOrdersCount: allOrders.filter((o) => o.status === 'waiting').length,
      printingOrdersCount: allOrders.filter((o) => o.status === 'printing').length,
      readyOrdersCount: allOrders.filter((o) => o.status === 'ready').length,
    });
  });

  // Audit Logs
  app.get('/api/audit-logs', authMiddleware, requireHandler, (_req: Request, res: Response) => {
    res.json(db.auditLogs.slice(0, 100));
  });

  // User Notifications
  app.get('/api/notifications', authMiddleware, (req: Request, res: Response) => {
    const user = (req as any).user as User;
    const userNotifs = db.notifications
      .filter((n) => n.userId === user.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json(userNotifs.slice(0, 20));
  });

  app.patch('/api/notifications/:id/read', authMiddleware, (req: Request, res: Response) => {
    const notif = db.notifications.find((n) => n.id === req.params.id);
    if (notif) {
      notif.read = true;
      saveDb();
    }
    res.json({ success: true });
  });

  // Serve static uploads
  app.use('/uploads', express.static(UPLOADS_DIR));

  // Mount Vite middleware for dev or serve built assets in preview/production
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Qprint server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
