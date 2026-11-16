import React, { useState, useEffect } from 'react';
import {
  UploadCloud,
  Clock,
  Printer,
  PackageCheck,
  CheckCircle2,
  FileText,
  AlertCircle,
  RefreshCw,
  Search,
  ExternalLink,
  CreditCard,
  Sparkles,
  QrCode,
  Download,
  LogOut
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { Order } from '../types';
import { subscribeOrders, isProfileComplete, updateOrderStatus } from '../lib/firestoreService';
import { downloadOrderFile } from '../utils/fileDownloader';

interface StudentDashboardProps {
  onOpenCreateOrder: () => void;
  onOpenTrackModal: () => void;
  onSelectOrder: (order: Order) => void;
  onPayNow: (order: Order) => void;
  onOpenProfile?: () => void;
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  onOpenCreateOrder,
  onOpenTrackModal,
  onSelectOrder,
  onPayNow,
  onOpenProfile,
}) => {
  const { user, token, logout } = useAuth();
  const { refreshKey, triggerRefresh } = useRealtime();

  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [collectingId, setCollectingId] = useState<string | null>(null);

  const handleMarkCollected = async (orderId: string) => {
    if (!window.confirm('Confirm that you have collected this printout from the Xerox counter?')) return;
    setCollectingId(orderId);
    try {
      await updateOrderStatus(orderId, 'collected', user?.name || 'Student Customer', 'Collected by student at counter');
      try {
        await fetch(`/api/orders/${orderId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ status: 'collected', note: 'Collected by student at counter' }),
        });
      } catch (e) {}
      triggerRefresh();
    } catch (err: any) {
      console.error('Error marking order collected:', err);
    } finally {
      setCollectingId(null);
    }
  };

  useEffect(() => {
    setIsLoading(true);
    const unsub = subscribeOrders(
      (newOrders) => {
        setOrders(newOrders);
        setIsLoading(false);
      },
      { role: 'student', userId: user?.id }
    );
    return () => unsub();
  }, [user, refreshKey]);

  const activeOrders = orders.filter((o) => o.status !== 'collected' && o.status !== 'cancelled');
  const readyOrders = orders.filter((o) => o.status === 'ready');
  const completedOrders = orders.filter((o) => o.status === 'collected');
  const inQueueOrders = orders.filter(
    (o) => (o.status === 'waiting' || o.status === 'printing') && o.paymentStatus === 'verified'
  );

  const totalPagesPrinted = orders
    .filter((o) => o.status === 'printing' || o.status === 'ready' || o.status === 'collected')
    .reduce((sum, o) => sum + o.pageCount * (o.options.copies || 1), 0);

  const totalSpent = orders
    .filter((o) => o.paymentStatus === 'verified')
    .reduce((sum, o) => sum + o.pricingSnapshot.totalAmount, 0);

  const filteredOrders = orders.filter(
    (o) =>
      o.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.file.originalName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 space-y-4 sm:space-y-6 max-w-full overflow-x-hidden">
      {/* Welcome Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-blue-700 via-indigo-600 to-sky-600 text-white shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 text-xs font-semibold mb-2">
            <Sparkles className="w-3.5 h-3.5 text-blue-200" />
            <span>Student Print Portal</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
            Welcome back, {user?.name || 'Student'}!
          </h1>
          <p className="text-xs sm:text-sm text-blue-100 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {user?.rollNumber ? <span className="font-semibold">Roll No: {user.rollNumber}</span> : <span>Student Account</span>}
            {user?.department && <span>• {user.department}{user.section ? ` (Sec ${user.section})` : ''}</span>}
            {user?.email && <span className="text-blue-200">• ✉ {user.email}</span>}
            {user?.phone && <span className="text-blue-200">• 📞 {user.phone}</span>}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onOpenProfile && (
            <button
              onClick={onOpenProfile}
              className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-white/20 hover:bg-white/30 text-white font-bold text-xs backdrop-blur-xs transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span>My Profile</span>
            </button>
          )}
          <button
            onClick={onOpenCreateOrder}
            className="px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl bg-white text-blue-700 hover:bg-blue-50 font-bold text-xs shadow-md transition-all flex items-center gap-1.5 sm:gap-2 cursor-pointer"
          >
            <UploadCloud className="w-4 h-4" />
            <span>New Print Order</span>
          </button>
          <button
            onClick={logout}
            className="px-3 sm:px-3.5 py-2 sm:py-2.5 rounded-xl bg-white/10 hover:bg-rose-500/80 text-white font-bold text-xs backdrop-blur-xs transition-all flex items-center gap-1.5 cursor-pointer"
            title="Exit / Log Out"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Exit</span>
          </button>
        </div>
      </div>

      {/* Profile Incomplete Warning Banner */}
      {!isProfileComplete(user) && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 flex flex-wrap items-center justify-between gap-3 text-xs shadow-xs">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <p className="font-bold text-amber-950">Profile Details Incomplete</p>
              <p className="text-[11px] text-amber-800">
                Please complete your Department, Section, and Roll Number to enable placing print orders.
              </p>
            </div>
          </div>
          {onOpenProfile && (
            <button
              onClick={onOpenProfile}
              className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-sm cursor-pointer"
            >
              Complete Profile Now
            </button>
          )}
        </div>
      )}

      {/* Prominent Ready for Collection Banner */}
      {readyOrders.length > 0 && (
        <div className="space-y-2">
          {readyOrders.map((ro) => (
            <div
              key={ro.id}
              className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-700 text-white shadow-lg animate-pulse flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                  <PackageCheck className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-base font-black tracking-tight">
                    Your printout is ready for collection!
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-emerald-100 font-semibold">
                    <span className="font-mono bg-white/20 px-2 py-0.5 rounded-md text-white">
                      #{ro.orderNumber}
                    </span>
                    <span>•</span>
                    <span>{ro.pageCount} pages ({ro.options?.copies || 1} set)</span>
                    <span>•</span>
                    <span className="text-white font-bold">
                      ₹{ro.pricingSnapshot?.totalAmount?.toFixed(2) || '0.00'}
                    </span>
                    <span>•</span>
                    <span className="bg-emerald-500/40 border border-emerald-300/40 px-2 py-0.5 rounded-full text-[11px] uppercase tracking-wider text-white font-bold">
                      Ready for Collection
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleMarkCollected(ro.id)}
                  disabled={collectingId === ro.id}
                  className="px-4 py-2 bg-white text-emerald-800 rounded-xl font-bold text-xs shadow-sm hover:bg-emerald-50 shrink-0 cursor-pointer flex items-center gap-1.5 transition-all disabled:opacity-50"
                  title="Confirm you have picked up your order from the Xerox counter"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>{collectingId === ro.id ? 'Confirming...' : 'I Have Collected'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSelectOrder(ro)}
                  className="px-3 py-2 bg-emerald-800/40 hover:bg-emerald-800/60 text-white rounded-xl font-semibold text-xs border border-white/20 transition-all cursor-pointer"
                >
                  Details
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase block">Total Orders</span>
          <span className="text-2xl font-black text-slate-900 mt-1 block">{orders.length}</span>
        </div>
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase block">Pages Printed</span>
          <span className="text-2xl font-black text-blue-600 mt-1 block">{totalPagesPrinted}</span>
        </div>
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase block">Total Spent</span>
          <span className="text-2xl font-black text-emerald-600 mt-1 block">₹{totalSpent.toFixed(2)}</span>
        </div>
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase block">Active in Queue</span>
          <span className="text-2xl font-black text-amber-600 mt-1 block">{inQueueOrders.length}</span>
        </div>
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs col-span-2 sm:col-span-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase block">Ready for Pickup</span>
          <span className="text-2xl font-black text-indigo-600 mt-1 block">{readyOrders.length}</span>
        </div>
      </div>

      {/* Active Orders Section */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Active Print Orders</h2>
            <p className="text-xs text-slate-500">Live queue status and turnaround progress</p>
          </div>
          <button
            onClick={() => triggerRefresh()}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
            title="Refresh Orders"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {activeOrders.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
            No active orders right now. Click "New Print Order" to upload your next document!
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {activeOrders.map((order) => (
              <div
                key={order.id}
                className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3 text-xs"
              >
                <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                  <div
                    className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center font-bold shrink-0 ${
                      order.status === 'ready'
                        ? 'bg-emerald-100 text-emerald-700'
                        : order.status === 'printing'
                        ? 'bg-indigo-100 text-indigo-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {order.status === 'ready' ? (
                      <PackageCheck className="w-5 h-5" />
                    ) : order.status === 'printing' ? (
                      <Printer className="w-5 h-5" />
                    ) : (
                      <Clock className="w-5 h-5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                      <span className="font-mono font-bold text-slate-900 text-xs sm:text-sm">
                        #{order.orderNumber}
                      </span>
                      <span className="text-[10px] uppercase font-bold px-1.5 sm:px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        {order.status.replace('_', ' ')}
                      </span>
                      {order.queuePosition && order.status === 'waiting' && (
                        <span className="text-[10px] font-bold px-1.5 sm:px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                          Queue #{order.queuePosition}
                        </span>
                      )}
                    </div>
                    <p className="text-slate-500 mt-0.5 truncate max-w-[200px] sm:max-w-xs font-medium text-[11px] sm:text-xs">
                      {order.files && order.files.length > 1
                        ? `Files: ${order.files.length} • ${order.pageCount} pages (${order.options.copies} copy)`
                        : `${order.file.originalName} • ${order.pageCount} pages (${order.options.copies} copy)`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-2.5 sm:gap-3 pt-2 sm:pt-0 border-t border-slate-100 sm:border-0 shrink-0">
                  <div className="text-left sm:text-right">
                    <span className="font-bold text-slate-900 block text-xs sm:text-sm">
                      ₹{order.pricingSnapshot.totalAmount.toFixed(2)}
                    </span>
                    <span
                      className={`text-[10px] font-semibold capitalize ${
                        order.paymentStatus === 'verified'
                          ? 'text-emerald-600'
                          : order.paymentStatus === 'submitted'
                          ? 'text-amber-600'
                          : 'text-rose-600'
                      }`}
                    >
                      {order.paymentStatus === 'verified' ? 'Payment Verified' : order.paymentStatus === 'submitted' ? 'Payment Submitted' : 'Unpaid'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {order.paymentStatus === 'pending' && (
                      <button
                        onClick={() => onPayNow(order)}
                        className="px-2.5 sm:px-3 py-1 sm:py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-[11px] sm:text-xs shadow-xs"
                      >
                        Pay Now
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => downloadOrderFile(order.file, order.orderNumber)}
                      className="px-2.5 sm:px-3 py-1 sm:py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded-lg text-[11px] sm:text-xs border border-blue-200 flex items-center gap-1 cursor-pointer transition-colors"
                      title="Download document directly"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </button>

                    {order.status === 'ready' && (
                      <button
                        type="button"
                        onClick={() => handleMarkCollected(order.id)}
                        disabled={collectingId === order.id}
                        className="px-2.5 sm:px-3 py-1 sm:py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[11px] sm:text-xs shadow-xs flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                        title="Confirm you have collected this printout from the counter"
                      >
                        <PackageCheck className="w-3.5 h-3.5" />
                        <span>{collectingId === order.id ? 'Marking...' : 'Mark Collected'}</span>
                      </button>
                    )}

                    <button
                      onClick={() => onSelectOrder(order)}
                      className="px-2.5 sm:px-3 py-1 sm:py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold text-[11px] sm:text-xs transition-colors cursor-pointer"
                    >
                      Details
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Order History */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Completed Order History</h2>
            <p className="text-xs text-slate-500">Historical records & downloaded documents</p>
          </div>
          <div className="w-full sm:w-64">
            <input
              type="text"
              placeholder="Search by order or filename..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-xl focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {filteredOrders.filter((o) => o.status === 'collected').length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">
            No completed orders yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 font-semibold uppercase text-[10px]">
                  <th className="py-2.5 px-3">Order No</th>
                  <th className="py-2.5 px-3">Document</th>
                  <th className="py-2.5 px-3">Pages / Copies</th>
                  <th className="py-2.5 px-3">Amount</th>
                  <th className="py-2.5 px-3">Collected Date</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredOrders
                  .filter((o) => o.status === 'collected')
                  .map((order) => (
                    <tr key={order.id} className="hover:bg-slate-50/50">
                      <td className="py-3 px-3 font-mono font-bold text-slate-900">
                        #{order.orderNumber}
                      </td>
                      <td className="py-3 px-3 font-medium text-slate-800 truncate max-w-[180px]" title={order.files && order.files.length > 1 ? order.files.map(f => f.originalName).join(', ') : order.file.originalName}>
                        {order.files && order.files.length > 1
                          ? `Files (${order.files.length}): ${order.files[0].originalName}`
                          : order.file.originalName}
                      </td>
                      <td className="py-3 px-3">
                        {order.pageCount} pages ({order.options.copies} set)
                      </td>
                      <td className="py-3 px-3 font-bold text-emerald-600">
                        ₹{order.pricingSnapshot.totalAmount.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-slate-500">
                        {order.collectedAt
                          ? new Date(order.collectedAt).toLocaleDateString()
                          : new Date(order.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => downloadOrderFile(order.file, order.orderNumber)}
                            className="p-1 sm:px-2 sm:py-1 text-xs font-semibold text-slate-600 hover:text-blue-700 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                            title="Download document directly"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Download</span>
                          </button>
                          <button
                            onClick={() => onSelectOrder(order)}
                            className="px-2.5 py-1 text-xs font-semibold text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                          >
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
