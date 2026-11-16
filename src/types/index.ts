export type UserRole = 'student' | 'faculty' | 'handler';

export interface User {
  id: string;
  name: string;
  email?: string;
  phone: string;
  role: UserRole;
  department?: string;
  section?: string;
  rollNumber?: string;
  staffId?: string;
  password?: string;
  createdAt: string;
}

export type OrderStatus = 'confirmed' | 'waiting' | 'printing' | 'ready' | 'collected' | 'cancelled';
export type PaymentStatus = 'pending' | 'processing' | 'submitted' | 'verified' | 'failed' | 'expired' | 'refunded';
export type PaymentMethod = 'upi_qr' | 'razorpay' | 'cash';

export interface PricingTier {
  id: string;
  minPages: number;
  maxPages: number | null; // null means and above
  pricePerPage: number; // in Rupees, e.g. 2.00, 1.50, 1.00, 0.75
}

export interface PrintOptions {
  color: 'bw' | 'color'; // B&W or Color
  sides: 'single' | 'double'; // Single-sided or Duplex
  paperSize: 'A4' | 'A3' | 'Legal';
  orientation: 'portrait' | 'landscape';
  binding: 'none' | 'staple' | 'spiral' | 'hard_bound';
  copies: number;
}

export interface PriceCalculation {
  pageCount: number;
  copies: number;
  applicableTier: PricingTier;
  basePricePerPage: number;
  basePrintAmount: number; // in Rupees
  colorSurcharge: number;
  bindingCharge: number;
  totalAmount: number; // in Rupees
}

export interface OrderFile {
  id: string;
  orderId?: string;
  originalName: string;
  storageName: string;
  mimeType: string;
  sizeBytes: number;
  detectedPageCount: number;
  uploadedAt: string;
  dataUrl?: string;
  fileUrl?: string;
  uploadStatus?: 'uploaded' | 'failed' | 'processing';
  uploadedBy?: string;
}

export interface OrderStatusHistoryItem {
  status: OrderStatus;
  timestamp: string;
  updatedBy: string;
  note?: string;
}

export interface Order {
  id: string;
  orderNumber: string; // e.g. QP-2026-000001
  userId: string;
  userName: string;
  userPhone: string;
  userRole: 'student' | 'faculty';
  department?: string;
  rollNumber?: string;
  section?: string;
  staffId?: string;

  file: OrderFile; // Primary/first file for backward compatibility
  files?: OrderFile[]; // Complete list of all uploaded files in this order
  fileCount?: number; // Total number of uploaded files
  pageCount: number;
  options: PrintOptions;
  customerInstructions?: string;
  requiredByTime?: string;

  pricingSnapshot: {
    tierName: string;
    ratePerPage: number;
    colorCharge: number;
    bindingCharge: number;
    copies: number;
    totalAmount: number;
  };

  status: OrderStatus;
  statusHistory: OrderStatusHistoryItem[];
  queuePosition?: number;
  isPriority?: boolean;
  priorityReason?: string;

  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paymentReference?: string; // e.g. UPI UTR number or Razorpay Payment ID
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  razorpaySignature?: string;
  paymentReceiptFile?: string;
  paymentSubmittedAt?: string;
  paymentVerifiedAt?: string;
  paymentVerifiedBy?: string;

  createdAt: string;
  updatedAt?: string;
  startedPrintingAt?: string;
  readyAt?: string;
  collectedAt?: string;
  handlerId?: string;
}

export interface ShopSettings {
  shopName: string;
  tagline: string;
  contactPhone: string;
  upiId: string;
  activeQrUrl: string;
  colorSurchargePerPage: number; // e.g. 8.00
  spiralBindingCharge: number; // e.g. 30.00
  hardBoundCharge: number; // e.g. 120.00
  stapleCharge?: number; // e.g. 5.00
  estimatedMinutesPerTenPages: number; // e.g. 2 minutes
  isOpen: boolean;
  paymentInstructions: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  actor: string;
  actorRole: UserRole | string;
  action: string;
  details: string;
  targetId?: string;
}

export interface AppNotification {
  id: string;
  userId: string;
  orderId?: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  type: 'order_update' | 'payment' | 'system' | 'ready_alert';
}
