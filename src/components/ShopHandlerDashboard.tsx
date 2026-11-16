import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Printer,
  Clock,
  PackageCheck,
  CheckCircle2,
  DollarSign,
  TrendingUp,
  Search,
  Filter,
  FileText,
  User as UserIcon,
  Building2,
  Flame,
  ArrowUpDown,
  Settings,
  History,
  QrCode,
  CreditCard,
  BarChart3,
  RefreshCw,
  Upload,
  Plus,
  Trash2,
  AlertCircle,
  Save,
  Check,
  Download
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { Order, OrderStatus, PricingTier, ShopSettings, AuditLog } from '../types';
import {
  subscribeOrders,
  updateOrderStatus,
  verifyPayment,
  updateOrderPriority,
  subscribeShopSettings,
  updateShopSettings,
  updatePricingTiers,
  uploadShopQr,
  subscribeAuditLogs,
} from '../lib/firestoreService';
import { downloadOrderFile } from '../utils/fileDownloader';

interface ShopHandlerDashboardProps {
  onSelectOrder: (order: Order) => void;
}

export const ShopHandlerDashboard: React.FC<ShopHandlerDashboardProps> = ({
  onSelectOrder,
}) => {
  const { user, token } = useAuth();
  const { refreshKey, triggerRefresh } = useRealtime();

  const [activeTab, setActiveTab] = useState<
    | 'active_orders'
    | 'ready_orders'
    | 'completed'
    | 'queue'
    | 'payments'
    | 'pricing'
    | 'qr_mgmt'
    | 'reports'
    | 'settings'
    | 'audit_log'
  >('active_orders');

  const [orders, setOrders] = useState<Order[]>([]);
  const [pricingTiers, setPricingTiers] = useState<PricingTier[]>([]);
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // 1. Authoritative Real-Time Cloud Firestore Subscriptions
  useEffect(() => {
    setIsLoading(true);

    // Live Orders Subscription: pushes any order created by students or faculty in real time!
    const unsubOrders = subscribeOrders(
      (newOrders) => {
        setOrders(newOrders);
        setIsLoading(false);
      },
      { role: 'handler' }
    );

    // Live Shop Settings & Pricing Subscription
    const unsubSettings = subscribeShopSettings((newSettings, newTiers) => {
      setSettings(newSettings);
      setPricingTiers(newTiers);
    });

    // Live Audit Log Subscription
    const unsubLogs = subscribeAuditLogs((logs) => {
      setAuditLogs(logs);
    });

    return () => {
      unsubOrders();
      unsubSettings();
      unsubLogs();
    };
  }, [user]);

  // Status transition shortcut (e.g. printing, ready, collected)
  const handleQuickStatus = async (orderId: string, newStatus: string) => {
    try {
      // 1. Direct authoritative update in Cloud Firestore
      await updateOrderStatus(
        orderId,
        newStatus as OrderStatus,
        user?.name || 'Shop Handler'
      );

      // 2. Synchronize to legacy endpoint
      try {
        await fetch(`/api/orders/${orderId}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status: newStatus }),
        });
      } catch (e) { }

      triggerRefresh();
    } catch (err: any) {
      console.error('Error updating order status:', err);
      alert(err.message || 'Failed to update order status');
    }
  };

  // Payment verification shortcut
  const handleVerifyPayment = async (orderId: string, verified: boolean) => {
    try {
      // 1. Authoritative update in Cloud Firestore
      await verifyPayment(orderId, verified, undefined, user?.name || 'Shop Handler');

      // 2. Inform legacy endpoint
      try {
        await fetch(`/api/payments/verify/${orderId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ verified }),
        });
      } catch (e) { }

      triggerRefresh();
    } catch (err: any) {
      console.error('Error verifying payment:', err);
      alert(err.message || 'Failed to verify payment');
    }
  };

  // Save pricing tiers
  const handleSavePricing = async () => {
    try {
      await updatePricingTiers(pricingTiers);
      try {
        await fetch('/api/pricing-tiers', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ tiers: pricingTiers }),
        });
      } catch (e) { }

      setSaveSuccess('Pricing tiers updated and published live successfully!');
      setTimeout(() => setSaveSuccess(null), 3000);
      triggerRefresh();
    } catch (err: any) {
      console.error('Error saving pricing tiers:', err);
      alert(err.message || 'Failed to save pricing tiers');
    }
  };

  // Save shop settings
  const handleSaveSettings = async () => {
    if (!settings) return;
    try {
      await updateShopSettings(settings);
      try {
        await fetch('/api/settings', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(settings),
        });
      } catch (e) { }

      setSaveSuccess('Shop operational settings saved successfully!');
      setTimeout(() => setSaveSuccess(null), 3000);
      triggerRefresh();
    } catch (err: any) {
      console.error('Error saving settings:', err);
      alert(err.message || 'Failed to save shop settings');
    }
  };

  // Upload and compress QR code image
  const handleQrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.match(/^image\/(png|jpe?g|webp)$/)) {
      alert('Please upload a valid image file (PNG, JPG, or WebP).');
      return;
    }

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const rawDataUrl = event.target?.result as string;
        if (!rawDataUrl) return;

        // Use HTML Canvas to resize and optimize image (max 500x500) so it fits comfortably in Firestore doc
        const img = new Image();
        img.onload = async () => {
          const maxDim = 500;
          let width = img.width;
          let height = img.height;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.85);

            // Persist durably into Cloud Firestore settings
            await uploadShopQr(optimizedDataUrl);

            // Update in-memory settings state
            if (settings) {
              setSettings({ ...settings, activeQrUrl: optimizedDataUrl });
            }

            // Also inform local backend interceptor
            try {
              await fetch('/api/settings', {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ activeQrUrl: optimizedDataUrl }),
              });
            } catch (e) { }

            setSaveSuccess('New UPI Payment QR uploaded and activated live for all students & faculty!');
            setTimeout(() => setSaveSuccess(null), 3000);
            triggerRefresh();
          }
        };
        img.src = rawDataUrl;
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      console.error('Error uploading QR code:', err);
      alert(err.message || 'Failed to upload QR code');
    }
  };

  // Real-time calculated reports based on live Firestore orders
  const today = new Date().toISOString().split('T')[0];
  const currentMonth = today.substring(0, 7);

  const verifiedOrders = orders.filter((o) => o.paymentStatus === 'verified');
  const todayVerifiedCollections = verifiedOrders
    .filter((o) => o.createdAt.startsWith(today) || (o.paymentVerifiedAt && o.paymentVerifiedAt.startsWith(today)))
    .reduce((sum, o) => sum + (o.pricingSnapshot?.totalAmount || 0), 0);

  const monthlyVerifiedCollections = verifiedOrders
    .filter((o) => o.createdAt.startsWith(currentMonth))
    .reduce((sum, o) => sum + (o.pricingSnapshot?.totalAmount || 0), 0);

  const grossVerifiedRevenue = verifiedOrders.reduce(
    (sum, o) => sum + (o.pricingSnapshot?.totalAmount || 0),
    0
  );

  const totalPagesPrinted = orders
    .filter((o) => o.status === 'printing' || o.status === 'ready' || o.status === 'collected')
    .reduce((sum, o) => sum + ((o.pageCount || 1) * (o.options?.copies || 1)), 0);

  const reports = {
    totalOrdersCount: orders.length,
    activeOrdersCount: orders.filter((o) => o.status !== 'collected' && o.status !== 'cancelled').length,
    waitingOrdersCount: orders.filter((o) => o.status === 'waiting').length,
    printingOrdersCount: orders.filter((o) => o.status === 'printing').length,
    readyOrdersCount: orders.filter((o) => o.status === 'ready').length,
    completedOrdersCount: orders.filter((o) => o.status === 'collected').length,
    pendingPaymentsCount: orders.filter((o) => o.paymentStatus === 'submitted' || o.paymentStatus === 'pending').length,
    studentOrdersCount: orders.filter((o) => o.userRole === 'student').length,
    facultyOrdersCount: orders.filter((o) => o.userRole === 'faculty').length,
    todayVerifiedCollections,
    monthlyVerifiedCollections,
    grossVerifiedRevenue,
    totalPagesPrinted,
    totalPrintedPages: totalPagesPrinted,
  };

  // Filtered lists
  const readyOrders = orders.filter((o) => o.status === 'ready');
  const studentOrders = orders.filter(
    (o) =>
      o.userRole === 'student' &&
      o.status !== 'collected' &&
      o.status !== 'cancelled' &&
      o.status !== 'ready'
  );
  const facultyOrders = orders.filter(
    (o) =>
      o.userRole === 'faculty' &&
      o.status !== 'collected' &&
      o.status !== 'cancelled' &&
      o.status !== 'ready'
  );
  const queueOrders = orders
    .filter((o) => (o.status === 'waiting' || o.status === 'printing') && o.paymentStatus === 'verified')
    .sort((a, b) => (a.queuePosition || 99) - (b.queuePosition || 99));
  const completedOrders = orders.filter((o) => o.status === 'collected');
  const pendingPayments = orders.filter(
    (o) =>
      (o.paymentStatus === 'submitted' || o.paymentStatus === 'pending') &&
      o.status !== 'cancelled'
  );

  const filterOrderList = (list: Order[]) => {
    return list.filter((o) => {
      const q = searchQuery.toLowerCase();
      const matchSearch =
        o.orderNumber.toLowerCase().includes(q) ||
        o.userName.toLowerCase().includes(q) ||
        o.file.originalName.toLowerCase().includes(q) ||
        (o.files && o.files.some((f) => f.originalName.toLowerCase().includes(q))) ||
        o.rollNumber?.toLowerCase().includes(q) ||
        o.department?.toLowerCase().includes(q);

      const matchStatus = statusFilter === 'all' || o.status === statusFilter;
      return matchSearch && matchStatus;
    });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Handler Control Bar */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-purple-950 text-white shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 text-xs font-semibold mb-2 border border-purple-500/30">
            <ShieldAlert className="w-3.5 h-3.5 text-purple-400" />
            <span>Master Shop Operations Panel</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight">
            RIT Xerox & Print Center
          </h1>
          <p className="text-xs text-purple-200 mt-0.5">
            Operator Account: <span className="font-bold text-white">RITXeroxShop</span> • Live Station
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right px-3 py-1.5 rounded-xl bg-white/10 backdrop-blur-xs">
            <span className="text-[10px] text-purple-200 block uppercase font-bold">
              Today's Collections
            </span>
            <span className="text-base font-black text-emerald-400">
              ₹{(reports?.todayVerifiedCollections || 0).toFixed(2)}
            </span>
          </div>

          <button
            onClick={() => triggerRefresh()}
            className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="Refresh All Records"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 11 Key Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
        <div
          onClick={() => setActiveTab('active_orders')}
          className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-purple-400 transition-colors"
        >
          <span className="text-[10px] font-bold text-slate-400 uppercase">Active Orders</span>
          <span className="text-xl font-black text-slate-900 mt-1 block">
            {reports?.activeOrdersCount || 0}
          </span>
        </div>
        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase">In Queue</span>
          <span className="text-xl font-black text-amber-600 mt-1 block">
            {reports?.waitingOrdersCount || 0}
          </span>
        </div>
        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase">Printing Now</span>
          <span className="text-xl font-black text-indigo-600 mt-1 block">
            {reports?.printingOrdersCount || 0}
          </span>
        </div>
        <div
          onClick={() => setActiveTab('ready_orders')}
          className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-xs cursor-pointer hover:border-emerald-400 transition-colors"
        >
          <span className="text-[10px] font-bold text-slate-400 uppercase">Ready for Pickup</span>
          <span className="text-xl font-black text-emerald-600 mt-1 block">
            {reports?.readyOrdersCount || 0}
          </span>
        </div>
        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase">Pending Payments</span>
          <span className="text-xl font-black text-rose-600 mt-1 block">
            {reports?.pendingPaymentsCount || 0}
          </span>
        </div>
        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase">Monthly Verified</span>
          <span className="text-xl font-black text-emerald-600 mt-1 block">
            ₹{(reports?.monthlyVerifiedCollections || 0).toFixed(0)}
          </span>
        </div>
      </div>

      {saveSuccess && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-xs font-semibold text-emerald-800 flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>{saveSuccess}</span>
        </div>
      )}

      {/* Main Tab Navigation */}
      <div className="flex overflow-x-auto border-b border-slate-200 gap-1 pb-1 text-xs font-semibold">
        {[
          { id: 'active_orders', label: `Active Orders (${studentOrders.length + facultyOrders.length})` },
          { id: 'ready_orders', label: `Ready to Collect (${readyOrders.length})` },
          { id: 'completed', label: `Orders Finished (${completedOrders.length})` },
          { id: 'queue', label: `Live Queue (${queueOrders.length})` },
          { id: 'payments', label: `Payment Verification (${pendingPayments.length})` },
          { id: 'pricing', label: 'Pricing Tiers' },
          { id: 'qr_mgmt', label: 'Payment QR' },
          { id: 'reports', label: 'Reports & Analytics' },
          { id: 'settings', label: 'Shop Settings' },
          { id: 'audit_log', label: 'Audit Log' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as any)}
            className={`px-3.5 py-2 rounded-xl whitespace-nowrap transition-all ${activeTab === t.id
                ? 'bg-purple-600 text-white shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* SEARCH & FILTERS BAR (For order lists) */}
      {(activeTab === 'active_orders' ||
        activeTab === 'ready_orders' ||
        activeTab === 'completed' ||
        activeTab === 'queue') && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by order number, customer name, roll number, or file..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs outline-none bg-transparent"
              />
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium"
              >
                <option value="all">All Statuses</option>
                <option value="waiting">Waiting</option>
                <option value="printing">Printing</option>
                <option value="ready">Ready for Collection</option>
                <option value="collected">Collected</option>
              </select>
            </div>
          </div>
        )}

      {/* --- TAB 1: SIDE-BY-SIDE ACTIVE ORDERS (STUDENTS ON ONE SIDE, FACULTY ON ANOTHER) --- */}
      {activeTab === 'active_orders' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-900/5 via-purple-900/5 to-indigo-900/5 border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Active Print Orders — Side-by-Side Station
              </h2>
              <p className="text-slate-500 text-[11px]">
                Student orders are on the left; Faculty orders are on the right. Once marked ready, orders move directly to the "Ready to Collect" counter.
              </p>
            </div>
            <div className="flex gap-2 font-bold text-[11px]">
              <span className="px-2.5 py-1 bg-blue-100 text-blue-800 rounded-lg">
                👨‍🎓 {filterOrderList(studentOrders).length} Student Active
              </span>
              <span className="px-2.5 py-1 bg-indigo-100 text-indigo-800 rounded-lg">
                👨‍🏫 {filterOrderList(facultyOrders).length} Faculty Active
              </span>
            </div>
          </div>

          {/* Quick Notice if Ready Orders are Available */}
          {readyOrders.length > 0 && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-300 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs shadow-xs">
              <div className="flex items-center gap-2.5 text-emerald-900 font-medium">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                  <PackageCheck className="w-4.5 h-4.5" />
                </div>
                <div>
                  <span className="font-bold text-emerald-950">
                    {readyOrders.length} order(s) printed & ready at the counter!
                  </span>
                  <p className="text-[11px] text-emerald-700">
                    Orders marked as ready have moved to the dedicated "Ready to Collect" tab for customer handover.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('ready_orders')}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-colors shrink-0 cursor-pointer shadow-sm"
              >
                Go to Ready to Collect ({readyOrders.length}) →
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* ======================================================== */}
            {/* LEFT COLUMN: ACTIVE STUDENT ORDERS                      */}
            {/* ======================================================== */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
              <div className="p-4 border-b border-slate-200 bg-blue-50/70 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm text-blue-950 flex items-center gap-1.5">
                    <UserIcon className="w-4 h-4 text-blue-600" />
                    <span>Active Student Orders</span>
                  </h3>
                  <p className="text-[11px] text-blue-700">
                    Student assignments, lab records, notes & projects
                  </p>
                </div>
                <span className="text-xs font-bold px-2.5 py-0.5 bg-blue-200 text-blue-900 rounded-full">
                  {filterOrderList(studentOrders).length}
                </span>
              </div>

              {filterOrderList(studentOrders).length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-400">
                  No active student orders in queue.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 p-3 space-y-3">
                  {filterOrderList(studentOrders).map((order) => (
                    <div
                      key={order.id}
                      className="p-4 rounded-xl border border-slate-200/90 hover:border-blue-300 bg-white shadow-xs space-y-3 transition-all"
                    >
                      {/* Top Header of Card */}
                      <div className="flex items-center justify-between">
                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                          <span className="font-mono font-bold text-sm text-slate-900">
                            #{order.orderNumber}
                          </span>
                          <span
                            className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${order.status === 'ready'
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                : order.status === 'printing'
                                  ? 'bg-indigo-100 text-indigo-800 border border-indigo-200 animate-pulse'
                                  : 'bg-amber-100 text-amber-800 border border-amber-200'
                              }`}
                          >
                            {order.status.replace('_', ' ')}
                          </span>

                          {/* Distinct Verified Payment Badge */}
                          {order.paymentStatus === 'verified' ? (
                            order.paymentMethod === 'razorpay' || order.razorpayPaymentId ? (
                              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-300 flex items-center gap-1 shadow-xs">
                                <CreditCard className="w-3 h-3 text-blue-600" />
                                <span>Verified (Razorpay)</span>
                              </span>
                            ) : (
                              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1 shadow-xs">
                                <QrCode className="w-3 h-3 text-emerald-600" />
                                <span>Verified (UPI QR)</span>
                              </span>
                            )
                          ) : order.paymentStatus === 'submitted' ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                              Payment Submitted
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                              Unpaid
                            </span>
                          )}
                        </div>
                        <span className="font-black text-sm text-slate-900">
                          ₹{order.pricingSnapshot.totalAmount.toFixed(2)}
                        </span>
                      </div>

                      {/* Customer Info (Name, Phone, Roll, Department) */}
                      <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                        <div>
                          <span className="text-slate-400 text-[10px] block">Student Name</span>
                          <span className="font-bold text-slate-900">{order.userName}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 text-[10px] block">Mobile Number</span>
                          <a
                            href={`tel:${order.userPhone}`}
                            className="font-bold text-blue-600 hover:underline"
                          >
                            {order.userPhone}
                          </a>
                        </div>
                        <div>
                          <span className="text-slate-400 text-[10px] block">Roll Number</span>
                          <span className="font-mono font-bold text-slate-800">
                            {order.rollNumber || 'Not Provided'} {order.section ? `(Sec ${order.section})` : ''}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 text-[10px] block">Department</span>
                          <span className="font-semibold text-slate-800">
                            {order.department || 'General'}
                          </span>
                        </div>
                      </div>

                      {/* Document & Print Specs */}
                      <div className="text-xs text-slate-700 space-y-1">
                        <p className="font-semibold text-slate-900 truncate" title={order.files && order.files.length > 1 ? order.files.map(f => f.originalName).join(', ') : order.file.originalName}>
                          📄 {order.files && order.files.length > 1 ? `${order.files.length} Files: ${order.files.map(f => f.originalName).join(', ')}` : order.file.originalName}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                          <span className="font-bold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded">
                            Files: {order.fileCount || (order.files ? order.files.length : 1)} • {order.pageCount} Pages
                          </span>
                          <span>×</span>
                          <span><b>{order.options.copies}</b> set</span>
                          <span>•</span>
                          <span>{order.options.color === 'color' ? '🎨 Full Color' : '⬛ B&W'}</span>
                          <span>•</span>
                          <span>{order.options.sides === 'double' ? '2-Sided' : '1-Sided'}</span>
                          <span>•</span>
                          <span className="capitalize">{order.options.binding.replace('_', ' ')}</span>
                        </div>
                      </div>

                      {/* Customer Description / Needs Box */}
                      {order.customerInstructions && (
                        <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs">
                          <span className="font-bold block text-[10px] uppercase text-amber-800 tracking-wide">
                            Customer Instructions:
                          </span>
                          <p className="mt-0.5 leading-relaxed">{order.customerInstructions}</p>
                        </div>
                      )}

                      {/* Workflow Buttons */}
                      <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100">
                        <div className="flex flex-wrap items-center gap-2">
                          {(order.status === 'confirmed' || order.status === 'waiting') && (
                            <button
                              type="button"
                              onClick={() => {
                                if (order.paymentStatus !== 'verified') {
                                  alert('Cannot start printing: Payment has not been verified yet.');
                                  return;
                                }
                                handleQuickStatus(order.id, 'printing');
                              }}
                              disabled={order.paymentStatus !== 'verified'}
                              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              title={order.paymentStatus !== 'verified' ? 'Payment must be verified before printing' : 'Start printing job'}
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>Start Printing</span>
                            </button>
                          )}

                          {order.status === 'printing' && (
                            <button
                              type="button"
                              onClick={() => handleQuickStatus(order.id, 'ready')}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm flex items-center gap-1.5 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Mark Ready for Collection</span>
                            </button>
                          )}

                          {order.status === 'ready' && (
                            <button
                              type="button"
                              onClick={() => handleQuickStatus(order.id, 'collected')}
                              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm flex items-center gap-1.5 cursor-pointer"
                            >
                              <PackageCheck className="w-3.5 h-3.5" />
                              <span>Mark as Collected</span>
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => downloadOrderFile(order.file, order.orderNumber)}
                            className="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-xs border border-blue-200 flex items-center gap-1 cursor-pointer transition-colors"
                            title="Download document directly"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onSelectOrder(order)}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs cursor-pointer"
                          >
                            View Details
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ======================================================== */}
            {/* RIGHT COLUMN: ACTIVE FACULTY ORDERS                     */}
            {/* ======================================================== */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
              <div className="p-4 border-b border-slate-200 bg-indigo-50/70 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm text-indigo-950 flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-indigo-600" />
                    <span>Active Faculty Orders</span>
                  </h3>
                  <p className="text-[11px] text-indigo-700">
                    Professor lecture notes, exam papers, syllabus & circulars
                  </p>
                </div>
                <span className="text-xs font-bold px-2.5 py-0.5 bg-indigo-200 text-indigo-900 rounded-full">
                  {filterOrderList(facultyOrders).length}
                </span>
              </div>

              {filterOrderList(facultyOrders).length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-400">
                  No active faculty orders in queue.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 p-3 space-y-3">
                  {filterOrderList(facultyOrders).map((order) => (
                    <div
                      key={order.id}
                      className="p-4 rounded-xl border border-slate-200/90 hover:border-indigo-300 bg-white shadow-xs space-y-3 transition-all"
                    >
                      {/* Top Header of Card */}
                      <div className="flex items-center justify-between">
                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                          <span className="font-mono font-bold text-sm text-slate-900">
                            #{order.orderNumber}
                          </span>
                          <span
                            className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${order.status === 'ready'
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                : order.status === 'printing'
                                  ? 'bg-indigo-100 text-indigo-800 border border-indigo-200 animate-pulse'
                                  : 'bg-amber-100 text-amber-800 border border-amber-200'
                              }`}
                          >
                            {order.status.replace('_', ' ')}
                          </span>

                          {/* Distinct Verified Payment Badge */}
                          {order.paymentStatus === 'verified' ? (
                            order.paymentMethod === 'razorpay' || order.razorpayPaymentId ? (
                              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-300 flex items-center gap-1 shadow-xs">
                                <CreditCard className="w-3 h-3 text-blue-600" />
                                <span>Verified (Razorpay)</span>
                              </span>
                            ) : (
                              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1 shadow-xs">
                                <QrCode className="w-3 h-3 text-emerald-600" />
                                <span>Verified (UPI QR)</span>
                              </span>
                            )
                          ) : order.paymentStatus === 'submitted' ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                              Payment Submitted
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                              Unpaid
                            </span>
                          )}
                        </div>
                        <span className="font-black text-sm text-slate-900">
                          ₹{order.pricingSnapshot.totalAmount.toFixed(2)}
                        </span>
                      </div>

                      {/* Faculty Info (Name, Phone, Staff ID, Department) */}
                      <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                        <div>
                          <span className="text-slate-400 text-[10px] block">Faculty / Professor</span>
                          <span className="font-bold text-slate-900">{order.userName}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 text-[10px] block">Mobile Number</span>
                          <a
                            href={`tel:${order.userPhone}`}
                            className="font-bold text-indigo-600 hover:underline"
                          >
                            {order.userPhone}
                          </a>
                        </div>
                        <div>
                          <span className="text-slate-400 text-[10px] block">Staff ID</span>
                          <span className="font-mono font-bold text-slate-800">
                            {order.staffId || 'Not Provided'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 text-[10px] block">Department</span>
                          <span className="font-semibold text-slate-800">
                            {order.department || 'Faculty'}
                          </span>
                        </div>
                      </div>

                      {/* Document & Print Specs */}
                      <div className="text-xs text-slate-700 space-y-1">
                        <p className="font-semibold text-slate-900 truncate" title={order.files && order.files.length > 1 ? order.files.map(f => f.originalName).join(', ') : order.file.originalName}>
                          📄 {order.files && order.files.length > 1 ? `${order.files.length} Files: ${order.files.map(f => f.originalName).join(', ')}` : order.file.originalName}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                          <span className="font-bold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded">
                            Files: {order.fileCount || (order.files ? order.files.length : 1)} • {order.pageCount} Pages
                          </span>
                          <span>×</span>
                          <span><b>{order.options.copies}</b> set</span>
                          <span>•</span>
                          <span>{order.options.color === 'color' ? '🎨 Full Color' : '⬛ B&W'}</span>
                          <span>•</span>
                          <span>{order.options.sides === 'double' ? '2-Sided' : '1-Sided'}</span>
                          <span>•</span>
                          <span className="capitalize">{order.options.binding.replace('_', ' ')}</span>
                        </div>
                      </div>

                      {/* Customer Description / Needs Box */}
                      {order.customerInstructions && (
                        <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs">
                          <span className="font-bold block text-[10px] uppercase text-amber-800 tracking-wide">
                            Special Needs / Instructions:
                          </span>
                          <p className="mt-0.5 leading-relaxed">{order.customerInstructions}</p>
                        </div>
                      )}

                      {/* Workflow Buttons */}
                      <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100">
                        <div className="flex flex-wrap items-center gap-2">
                          {(order.status === 'confirmed' || order.status === 'waiting') && (
                            <button
                              type="button"
                              onClick={() => {
                                if (order.paymentStatus !== 'verified') {
                                  alert('Cannot start printing: Payment has not been verified yet.');
                                  return;
                                }
                                handleQuickStatus(order.id, 'printing');
                              }}
                              disabled={order.paymentStatus !== 'verified'}
                              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              title={order.paymentStatus !== 'verified' ? 'Payment must be verified before printing' : 'Start printing job'}
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>Start Printing</span>
                            </button>
                          )}

                          {order.status === 'printing' && (
                            <button
                              type="button"
                              onClick={() => handleQuickStatus(order.id, 'ready')}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm flex items-center gap-1.5 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Mark Ready for Collection</span>
                            </button>
                          )}

                          {order.status === 'ready' && (
                            <button
                              type="button"
                              onClick={() => handleQuickStatus(order.id, 'collected')}
                              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm flex items-center gap-1.5 cursor-pointer"
                            >
                              <PackageCheck className="w-3.5 h-3.5" />
                              <span>Mark as Collected</span>
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => downloadOrderFile(order.file, order.orderNumber)}
                            className="px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs border border-indigo-200 flex items-center gap-1 cursor-pointer transition-colors"
                            title="Download faculty document directly"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onSelectOrder(order)}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs cursor-pointer"
                          >
                            View Details
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- TAB 2: READY TO COLLECT (COUNTER HANDOVER STATION) --- */}
      {activeTab === 'ready_orders' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-900/10 via-teal-900/10 to-green-900/10 border border-emerald-200/80 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <PackageCheck className="w-4 h-4 text-emerald-600" />
                <span>Ready to Collect — Counter Handover Station</span>
              </h2>
              <p className="text-slate-500 text-[11px] mt-0.5">
                All printed jobs waiting for student or faculty pickup. Once verified and handed over at the counter, click "Mark as Collected" to archive into "Orders Finished".
              </p>
            </div>
            <div className="flex gap-2 font-bold text-[11px]">
              <span className="px-2.5 py-1 bg-blue-100 text-blue-800 rounded-lg">
                👨‍🎓 {filterOrderList(readyOrders.filter((o) => o.userRole === 'student')).length} Student
              </span>
              <span className="px-2.5 py-1 bg-indigo-100 text-indigo-800 rounded-lg">
                👨‍🏫 {filterOrderList(readyOrders.filter((o) => o.userRole === 'faculty')).length} Faculty
              </span>
              <span className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg shadow-xs">
                Total: {filterOrderList(readyOrders).length} Ready
              </span>
            </div>
          </div>

          {filterOrderList(readyOrders).length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-12 text-center space-y-3">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h3 className="font-bold text-sm text-slate-800">
                No Orders Waiting for Collection
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                When active print jobs are marked as <span className="font-semibold text-emerald-700">"Ready for Collection"</span>, they will automatically appear here for customer handover and collection confirmation.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('active_orders')}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl cursor-pointer transition-colors shadow-xs"
              >
                <span>View Active Printing Queue</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filterOrderList(readyOrders).map((order) => (
                <div
                  key={order.id}
                  className="bg-white rounded-2xl border-2 border-emerald-300/80 shadow-xs hover:shadow-md transition-all p-4 space-y-3 flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-black text-sm text-slate-900">
                          #{order.orderNumber}
                        </span>
                        <span
                          className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${order.userRole === 'faculty'
                              ? 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                              : 'bg-blue-100 text-blue-800 border border-blue-200'
                            }`}
                        >
                          {order.userRole}
                        </span>
                      </div>
                      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                        <Check className="w-3 h-3 text-emerald-600" />
                        Ready
                      </span>
                    </div>

                    {/* Customer Info */}
                    <div className="bg-slate-50 rounded-xl p-2.5 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">{order.userName}</span>
                        <span className="text-slate-500 text-[11px]">
                          {order.rollNumber || order.staffId || order.department || ''}
                        </span>
                      </div>
                      {order.userPhone && (
                        <div className="text-[11px] text-slate-600 flex items-center gap-1">
                          <span>📞 {order.userPhone}</span>
                        </div>
                      )}
                    </div>

                    {/* File & Spec Details */}
                    <div className="text-xs space-y-1.5">
                      <div className="flex items-center gap-1.5 font-medium text-slate-800 truncate" title={order.files && order.files.length > 1 ? order.files.map(f => f.originalName).join(', ') : order.file.originalName}>
                        <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{order.files && order.files.length > 1 ? `${order.files.length} Files: ${order.files.map(f => f.originalName).join(', ')}` : order.file.originalName}</span>
                      </div>
                      <div className="flex flex-wrap gap-1 text-[11px] text-slate-600">
                        <span className="px-2 py-0.5 bg-slate-100 rounded-md font-bold text-slate-900">
                          Files: {order.fileCount || (order.files ? order.files.length : 1)} • {order.pageCount} pgs
                        </span>
                        <span className="px-2 py-0.5 bg-slate-100 rounded-md font-semibold">
                          {order.options.copies} {order.options.copies > 1 ? 'copies' : 'copy'}
                        </span>
                        <span className="px-2 py-0.5 bg-slate-100 rounded-md">
                          {order.options.color === 'color' ? '🎨 Color' : '📄 B&W'}
                        </span>
                        <span className="px-2 py-0.5 bg-slate-100 rounded-md">
                          {order.options.binding}
                        </span>
                        {order.options.sides === 'double' && (
                          <span className="px-2 py-0.5 bg-slate-100 rounded-md">
                            2-Sided
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Payment Info */}
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                      <span className="text-slate-500">Amount:</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-black text-slate-900 text-sm">
                          ₹{order.pricingSnapshot.totalAmount.toFixed(2)}
                        </span>
                        {order.paymentStatus === 'verified' ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                            Paid ✓
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                            {order.paymentStatus}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => handleQuickStatus(order.id, 'collected')}
                      className="w-full py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-[0.98]"
                    >
                      <PackageCheck className="w-4 h-4" />
                      <span>Mark as Collected (Handover)</span>
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => downloadOrderFile(order.file, order.orderNumber)}
                        className="flex-1 py-1.5 px-2.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs border border-indigo-200 flex items-center justify-center gap-1 cursor-pointer transition-colors"
                        title="Download file"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectOrder(order)}
                        className="flex-1 py-1.5 px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs flex items-center justify-center cursor-pointer transition-colors"
                      >
                        View Details
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* --- TAB 3: LIVE PRINTING QUEUE --- */}
      {activeTab === 'queue' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-base text-slate-900">
                Authoritative FIFO Printing Queue
              </h3>
              <p className="text-xs text-slate-500">
                Live calculated queue positions • Drag or toggle priority
              </p>
            </div>
            <span className="px-3 py-1 rounded-full bg-purple-100 text-purple-800 font-bold text-xs">
              {queueOrders.length} jobs in queue
            </span>
          </div>

          <div className="space-y-2">
            {queueOrders.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">
                The queue is empty! All print orders are processed.
              </div>
            ) : (
              queueOrders.map((order, idx) => (
                <div
                  key={order.id}
                  className={`p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 text-xs transition-all ${order.status === 'printing'
                      ? 'border-indigo-400 bg-indigo-50/50'
                      : order.isPriority
                        ? 'border-rose-300 bg-rose-50/40'
                        : 'border-slate-200 bg-white'
                    }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs ${order.status === 'printing'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-slate-700'
                        }`}
                    >
                      #{order.queuePosition || idx + 1}
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        <span className="font-mono font-bold text-slate-900">
                          #{order.orderNumber}
                        </span>
                        <span className="font-semibold text-slate-800">
                          {order.userName} ({order.userRole})
                        </span>
                        {/* Verified Payment Badge */}
                        {order.paymentStatus === 'verified' ? (
                          order.paymentMethod === 'razorpay' || order.razorpayPaymentId ? (
                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-300 flex items-center gap-1 shadow-xs">
                              <CreditCard className="w-3 h-3 text-blue-600" />
                              <span>Verified (Razorpay)</span>
                            </span>
                          ) : (
                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1 shadow-xs">
                              <QrCode className="w-3 h-3 text-emerald-600" />
                              <span>Verified (UPI QR)</span>
                            </span>
                          )
                        ) : order.paymentStatus === 'submitted' ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                            Submitted
                          </span>
                        ) : null}
                        {order.isPriority && (
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-rose-500 text-white flex items-center gap-0.5">
                            <Flame className="w-2.5 h-2.5" />
                            Priority
                          </span>
                        )}
                      </div>
                      <p className="text-slate-500 text-[11px] truncate max-w-sm mt-0.5">
                        {order.file.originalName} • {order.pageCount} pgs ({order.options.copies} copies) •{' '}
                        {order.options.color === 'color' ? 'Color' : 'B&W'} • {order.options.binding}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {order.status === 'waiting' && (
                      <button
                        onClick={() => handleQuickStatus(order.id, 'printing')}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs"
                      >
                        Start Printing
                      </button>
                    )}
                    {order.status === 'printing' && (
                      <button
                        onClick={() => handleQuickStatus(order.id, 'ready')}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs"
                      >
                        Ready for Collection
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => downloadOrderFile(order.file, order.orderNumber)}
                      className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded-lg text-xs border border-blue-200 flex items-center gap-1 cursor-pointer transition-colors"
                      title="Download file directly"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </button>
                    <button
                      onClick={() => onSelectOrder(order)}
                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs"
                    >
                      Details
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* --- TAB 4: COMPLETED ORDERS ARCHIVE --- */}
      {activeTab === 'completed' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-base text-slate-900">
                Completed & Collected Orders Archive
              </h3>
              <p className="text-xs text-slate-500">
                Historical records with immutable timestamps & audit integrity
              </p>
            </div>
            <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-100 text-emerald-800">
              {completedOrders.length} collected
            </span>
          </div>

          {filterOrderList(completedOrders).length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">
              No completed orders yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-400 font-semibold uppercase text-[10px]">
                    <th className="py-2.5 px-3">Order</th>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3">Customer</th>
                    <th className="py-2.5 px-3">Pages / Copies</th>
                    <th className="py-2.5 px-3">Amount</th>
                    <th className="py-2.5 px-3">Collection Date</th>
                    <th className="py-2.5 px-3 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {filterOrderList(completedOrders).map((order) => (
                    <tr key={order.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-3 font-mono font-bold text-slate-900">
                        #{order.orderNumber}
                      </td>
                      <td className="py-3 px-3 capitalize font-semibold text-slate-600">
                        {order.userRole}
                      </td>
                      <td className="py-3 px-3 font-bold text-slate-800">
                        {order.userName}
                      </td>
                      <td className="py-3 px-3">
                        {order.pageCount} pgs ({order.options.copies} set)
                      </td>
                      <td className="py-3 px-3 font-bold text-emerald-600">
                        ₹{order.pricingSnapshot.totalAmount.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-slate-500">
                        {order.collectedAt
                          ? new Date(order.collectedAt).toLocaleString()
                          : new Date(order.createdAt).toLocaleString()}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={() => onSelectOrder(order)}
                          className="px-2.5 py-1 text-xs font-semibold text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg"
                        >
                          View Audit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* --- TAB 5: PAYMENT MANAGEMENT --- */}
      {activeTab === 'payments' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
          <div>
            <h3 className="font-bold text-base text-slate-900">
              Payment Verification Desk
            </h3>
            <p className="text-xs text-slate-500">
              Verify manual UPI UTR transaction references against shop bank receipts
            </p>
          </div>

          <div className="space-y-3">
            {pendingPayments.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">
                No pending payment verifications!
              </div>
            ) : (
              pendingPayments.map((order) => (
                <div
                  key={order.id}
                  className="p-4 rounded-xl border border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-slate-900">
                        #{order.orderNumber}
                      </span>
                      <span className="font-bold text-slate-800">{order.userName}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 uppercase font-semibold">
                        {order.paymentMethod.replace('_', ' ')}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap gap-x-3 text-slate-500">
                      <span>Amount: <b className="text-slate-800">₹{order.pricingSnapshot.totalAmount.toFixed(2)}</b></span>
                      {order.paymentReference && (
                        <span className="font-mono text-purple-700 font-bold">
                          UTR: {order.paymentReference}
                        </span>
                      )}
                      <span>Time: {new Date(order.paymentSubmittedAt || order.createdAt).toLocaleTimeString()}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleVerifyPayment(order.id, true)}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs shadow-xs"
                    >
                      Confirm Verified
                    </button>
                    <button
                      onClick={() => handleVerifyPayment(order.id, false)}
                      className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium rounded-lg text-xs"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => onSelectOrder(order)}
                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs"
                    >
                      Details
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* --- TAB 6: PRICING MANAGEMENT --- */}
      {activeTab === 'pricing' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-base text-slate-900">
                College Xerox Pricing Tiers Configuration
              </h3>
              <p className="text-xs text-slate-500">
                Edit approved per-page rates. New rates apply to new orders immediately.
              </p>
            </div>
            <button
              onClick={handleSavePricing}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-md"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Rates</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-400 font-semibold uppercase text-[10px]">
                  <th className="py-2.5 px-3">Bracket ID</th>
                  <th className="py-2.5 px-3">Min Pages</th>
                  <th className="py-2.5 px-3">Max Pages</th>
                  <th className="py-2.5 px-3">Price Per Page (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pricingTiers.map((tier, idx) => (
                  <tr key={tier.id}>
                    <td className="py-3 px-3 font-mono font-bold text-slate-800">
                      {tier.id}
                    </td>
                    <td className="py-3 px-3">
                      <input
                        type="number"
                        value={tier.minPages}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 1;
                          const next = [...pricingTiers];
                          next[idx].minPages = val;
                          setPricingTiers(next);
                        }}
                        className="w-20 px-2 py-1 border border-slate-300 rounded font-semibold"
                      />
                    </td>
                    <td className="py-3 px-3">
                      <input
                        type="number"
                        placeholder="Unlimited"
                        value={tier.maxPages ?? ''}
                        onChange={(e) => {
                          const val = e.target.value ? parseInt(e.target.value) : null;
                          const next = [...pricingTiers];
                          next[idx].maxPages = val;
                          setPricingTiers(next);
                        }}
                        className="w-24 px-2 py-1 border border-slate-300 rounded font-semibold"
                      />
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1">
                        <span className="font-bold text-slate-500">₹</span>
                        <input
                          type="number"
                          step="0.05"
                          value={tier.pricePerPage}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0.5;
                            const next = [...pricingTiers];
                            next[idx].pricePerPage = val;
                            setPricingTiers(next);
                          }}
                          className="w-24 px-2 py-1 border border-slate-300 rounded font-bold text-blue-700"
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- TAB 7: PAYMENT QR MANAGEMENT --- */}
      {activeTab === 'qr_mgmt' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
          <div>
            <h3 className="font-bold text-base text-slate-900">
              UPI Payment QR Code & Instructions
            </h3>
            <p className="text-xs text-slate-500">
              Replace the shop's active payment QR image or update UPI ID
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-start">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col items-center text-center">
              <span className="text-xs font-bold text-slate-800 mb-2">Active Payment QR Code</span>
              <div className="p-3 bg-white rounded-xl shadow-xs border border-slate-200 mb-3">
                <img
                  src={settings?.activeQrUrl || '/assets/sample_qr.svg'}
                  alt="Shop Active UPI QR"
                  className="w-44 h-44 object-contain"
                />
              </div>

              <label className="cursor-pointer px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs shadow-xs transition-colors flex items-center gap-2">
                <Upload className="w-3.5 h-3.5" />
                <span>Upload Replacement QR Image</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={handleQrUpload}
                  className="hidden"
                />
              </label>
              <p className="text-[10px] text-slate-400 mt-2">
                Accepts PNG, JPG, WEBP, or SVG
              </p>
            </div>

            {settings && (
              <div className="space-y-4 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Shop Official UPI ID
                  </label>
                  <input
                    type="text"
                    value={settings.upiId}
                    onChange={(e) => setSettings({ ...settings, upiId: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-semibold"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Payment Instructions for Customers
                  </label>
                  <textarea
                    rows={3}
                    value={settings.paymentInstructions}
                    onChange={(e) => setSettings({ ...settings, paymentInstructions: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>

                <button
                  onClick={handleSaveSettings}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-md"
                >
                  Save UPI Configuration
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- TAB 8: REPORTS & ANALYTICS --- */}
      {activeTab === 'reports' && reports && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-6">
          <div>
            <h3 className="font-bold text-base text-slate-900">
              Operations & Revenue Analytics
            </h3>
            <p className="text-xs text-slate-500">
              Authoritative totals calculated from verified database records
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-slate-400 uppercase font-bold text-[10px] block">
                Total Orders Created
              </span>
              <span className="text-2xl font-black text-slate-900 mt-1 block">
                {reports.totalOrdersCount}
              </span>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-slate-400 uppercase font-bold text-[10px] block">
                Pages Processed
              </span>
              <span className="text-2xl font-black text-blue-600 mt-1 block">
                {reports.totalPagesPrinted}
              </span>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-slate-400 uppercase font-bold text-[10px] block">
                Gross Verified Revenue
              </span>
              <span className="text-2xl font-black text-emerald-600 mt-1 block">
                ₹{reports.grossVerifiedRevenue.toFixed(2)}
              </span>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-slate-400 uppercase font-bold text-[10px] block">
                Monthly Verified
              </span>
              <span className="text-2xl font-black text-purple-600 mt-1 block">
                ₹{reports.monthlyVerifiedCollections.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs">
            <h4 className="font-bold text-slate-800 mb-2">Customer Category Breakdown</h4>
            <div className="flex gap-6">
              <div>
                <span className="text-slate-400 block text-[11px]">Student Orders</span>
                <span className="text-lg font-bold text-blue-700">{reports.studentOrdersCount}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Faculty Orders</span>
                <span className="text-lg font-bold text-indigo-700">{reports.facultyOrdersCount}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Completed & Collected</span>
                <span className="text-lg font-bold text-emerald-700">{reports.completedOrdersCount}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- TAB 9: SHOP SETTINGS --- */}
      {activeTab === 'settings' && settings && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-base text-slate-900">
                Operational Shop Settings
              </h3>
              <p className="text-xs text-slate-500">
                Shop name, contact number, turnaround estimates & open status
              </p>
            </div>
            <button
              onClick={handleSaveSettings}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-md"
            >
              Save Settings
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Shop Name</label>
              <input
                type="text"
                value={settings.shopName}
                onChange={(e) => setSettings({ ...settings, shopName: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Contact Phone</label>
              <input
                type="text"
                value={settings.contactPhone}
                onChange={(e) => setSettings({ ...settings, contactPhone: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Color Print Surcharge (₹ / page)
              </label>
              <input
                type="number"
                value={settings.colorSurchargePerPage}
                onChange={(e) =>
                  setSettings({ ...settings, colorSurchargePerPage: parseFloat(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Spiral Binding Charge (₹)
              </label>
              <input
                type="number"
                value={settings.spiralBindingCharge}
                onChange={(e) =>
                  setSettings({ ...settings, spiralBindingCharge: parseFloat(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Hard Bound Project Charge (₹)
              </label>
              <input
                type="number"
                value={settings.hardBoundCharge}
                onChange={(e) =>
                  setSettings({ ...settings, hardBoundCharge: parseFloat(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Turnaround Estimate (Minutes per 10 pages)
              </label>
              <input
                type="number"
                value={settings.estimatedMinutesPerTenPages}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    estimatedMinutesPerTenPages: parseInt(e.target.value) || 2,
                  })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
          </div>
        </div>
      )}

      {/* --- TAB 10: AUDIT LOG --- */}
      {activeTab === 'audit_log' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
          <div>
            <h3 className="font-bold text-base text-slate-900">
              Immutable System & Operational Audit Log
            </h3>
            <p className="text-xs text-slate-500">
              Audit trails of all price updates, status transitions, priorities, and payments
            </p>
          </div>

          <div className="divide-y divide-slate-100 text-xs">
            {auditLogs.map((log) => (
              <div key={log.id} className="py-2.5 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-bold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">
                      {log.action}
                    </span>
                    <span className="font-semibold text-slate-800">{log.actor}</span>
                    <span className="text-[10px] text-slate-400 capitalize">({log.actorRole})</span>
                  </div>
                  <p className="text-slate-600 mt-0.5">{log.details}</p>
                </div>
                <span className="text-slate-400 font-mono text-[10px] shrink-0">
                  {new Date(log.timestamp).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
