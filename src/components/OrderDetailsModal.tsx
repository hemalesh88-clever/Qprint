import React, { useState } from 'react';
import {
  X,
  FileText,
  Download,
  Clock,
  CheckCircle2,
  AlertCircle,
  Printer,
  PackageCheck,
  ShieldAlert,
  Loader2,
  Calendar,
  Phone,
  User as UserIcon,
  Sparkles,
  CreditCard,
  QrCode,
  Flame
} from 'lucide-react';
import { Order, OrderStatus } from '../types';
import { useAuth } from '../context/AuthContext';
import { updateOrderStatus } from '../lib/firestoreService';
import { downloadOrderFile } from '../utils/fileDownloader';

interface OrderDetailsModalProps {
  order: Order | null;
  isOpen: boolean;
  onClose: () => void;
  onOrderUpdated: (updated: Order) => void;
  onPayNow?: (order: Order) => void;
}

export const OrderDetailsModal: React.FC<OrderDetailsModalProps> = ({
  order,
  isOpen,
  onClose,
  onOrderUpdated,
  onPayNow,
}) => {
  const { user, token } = useAuth();
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!isOpen || !order) return null;

  const isHandler = user?.role === 'handler';

  const handleStatusChange = async (newStatus: OrderStatus, note?: string) => {
    setIsProcessing(true);
    setActionError(null);

    try {
      // 1. Authoritative commit to Cloud Firestore
      await updateOrderStatus(order.id, newStatus, user?.name || 'Shop Handler');

      // 2. Synchronize to backend endpoint
      let updatedOrderData: any = null;
      try {
        const res = await fetch(`/api/orders/${order.id}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status: newStatus, note }),
        });
        if (res.ok) {
          updatedOrderData = await res.json();
        }
      } catch (e) {}

      const updated: Order = updatedOrderData || {
        ...order,
        status: newStatus,
        updatedAt: new Date().toISOString(),
        statusHistory: [
          ...order.statusHistory,
          {
            status: newStatus,
            timestamp: new Date().toISOString(),
            updatedBy: user?.name || 'Shop Handler',
            note: note || `Status updated to ${newStatus}`,
          },
        ],
      };

      onOrderUpdated(updated);
    } catch (err: any) {
      setActionError(err.message || 'Status update error.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleVerifyPayment = async (verified: boolean) => {
    setIsProcessing(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/payments/verify/${order.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ verified }),
      });

      const updated = await res.json();
      if (!res.ok) throw new Error(updated.error || 'Failed to verify payment.');

      onOrderUpdated(updated);
    } catch (err: any) {
      setActionError(err.message || 'Payment verification error.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTogglePriority = async () => {
    setIsProcessing(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/orders/${order.id}/priority`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isPriority: !order.isPriority, reason: 'Handler priority override' }),
      });

      const updated = await res.json();
      if (!res.ok) throw new Error(updated.error || 'Failed to update priority.');

      onOrderUpdated(updated);
    } catch (err: any) {
      setActionError(err.message || 'Priority update error.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden text-slate-800 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-base sm:text-lg text-slate-900">
                #{order.orderNumber}
              </span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                  order.userRole === 'faculty'
                    ? 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                    : 'bg-blue-100 text-blue-700 border border-blue-200'
                }`}
              >
                {order.userRole}
              </span>
              {order.isPriority && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 flex items-center gap-1">
                  <Flame className="w-3 h-3 text-rose-600" />
                  Priority
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Created on {new Date(order.createdAt).toLocaleString()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 max-h-[75vh] overflow-y-auto space-y-4">
          {actionError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{actionError}</span>
            </div>
          )}

          {/* Status Banner */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-[11px] text-slate-500 block">Current Status</span>
              <span
                className={`text-sm font-black uppercase tracking-wide ${
                  order.status === 'ready'
                    ? 'text-emerald-600'
                    : order.status === 'printing'
                    ? 'text-indigo-600'
                    : order.status === 'collected'
                    ? 'text-slate-600'
                    : 'text-blue-600'
                }`}
              >
                {order.status.replace('_', ' ')}
              </span>
            </div>

            {order.queuePosition !== undefined && order.status !== 'collected' && order.status !== 'ready' && (
              <div className="text-right">
                <span className="text-[11px] text-slate-500 block">Queue Position</span>
                <span className="text-sm font-bold text-slate-900">
                  #{order.queuePosition} in line
                </span>
              </div>
            )}

            <div>
              <span className="text-[11px] text-slate-500 block">Payment</span>
              <span
                className={`text-xs font-bold capitalize ${
                  order.paymentStatus === 'verified'
                    ? 'text-emerald-600'
                    : order.paymentStatus === 'submitted'
                    ? 'text-amber-600'
                    : 'text-rose-600'
                }`}
              >
                {order.paymentStatus} ({order.paymentMethod.replace('_', ' ')})
              </span>
            </div>
          </div>

          {/* Customer & Document Information */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            {/* Customer Details */}
            <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2">
              <h4 className="font-bold text-slate-900 flex items-center gap-1.5 border-b border-slate-100 pb-1.5">
                <UserIcon className="w-3.5 h-3.5 text-blue-600" />
                <span>Customer Details</span>
              </h4>
              <p>
                <span className="text-slate-400">Name:</span> <span className="font-semibold text-slate-800">{order.userName}</span>
              </p>
              <p>
                <span className="text-slate-400">Phone:</span> <span className="font-semibold text-slate-800">{order.userPhone}</span>
              </p>
              {order.department && (
                <p>
                  <span className="text-slate-400">Department:</span> {order.department}
                </p>
              )}
              {order.rollNumber && (
                <p>
                  <span className="text-slate-400">Roll No:</span> {order.rollNumber} {order.section ? `(Sec ${order.section})` : ''}
                </p>
              )}
              {order.staffId && (
                <p>
                  <span className="text-slate-400">Staff ID:</span> {order.staffId}
                </p>
              )}
            </div>

            {/* Document Details & Quick Summary */}
            <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2">
              <h4 className="font-bold text-slate-900 flex items-center gap-1.5 border-b border-slate-100 pb-1.5">
                <FileText className="w-3.5 h-3.5 text-indigo-600" />
                <span>Files Overview</span>
              </h4>
              <p className="font-bold text-slate-900">
                {(order.files && order.files.length > 0) ? `${order.files.length} Files Attached` : order.file.originalName}
              </p>
              <p className="text-slate-500">
                {order.pageCount} total pages • {order.options.copies} set ({order.options.color === 'color' ? 'Color' : 'B&W'})
              </p>
              <p className="text-[11px] text-indigo-600 font-semibold">
                See individual file downloads below ↓
              </p>
            </div>
          </div>

          {/* DEDICATED UPLOADED FILES SECTION - Individual Download For Each File */}
          <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-indigo-600" />
                <span>
                  Uploaded Files ({(order.files && order.files.length > 0) ? order.files.length : 1} file{(order.files?.length || 1) > 1 ? 's' : ''} • {order.pageCount} total pages)
                </span>
              </h4>
              <span className="text-[11px] font-semibold text-slate-500">
                Download files separately one by one
              </span>
            </div>

            <div className="space-y-2">
              {((order.files && order.files.length > 0) ? order.files : [order.file]).map((f, idx) => (
                <div
                  key={f.id || idx}
                  className="p-3 rounded-xl bg-slate-50/80 hover:bg-slate-100/70 border border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-6 h-6 rounded-lg bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center shrink-0">
                      #{idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 text-xs truncate max-w-xs sm:max-w-md" title={f.originalName}>
                        {f.originalName}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {f.detectedPageCount} {f.detectedPageCount === 1 ? 'page' : 'pages'} • {(f.sizeBytes / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => downloadOrderFile(f, order.orderNumber)}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer active:scale-95"
                      title={`Download ${f.originalName}`}
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download File #{idx + 1}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Print Specifications */}
          <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2 text-xs">
            <h4 className="font-bold text-slate-900 border-b border-slate-100 pb-1.5">
              Print Configuration & Instructions
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-slate-600">
              <div>
                <span className="text-slate-400 block text-[10px]">Color Mode</span>
                <span className="font-bold text-slate-800">
                  {order.options.color === 'color' ? 'Full Color' : 'Black & White'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">Print Sides</span>
                <span className="font-bold text-slate-800">
                  {order.options.sides === 'double' ? 'Double-sided' : 'Single-sided'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">Copies</span>
                <span className="font-bold text-slate-800">{order.options.copies} set(s)</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">Binding</span>
                <span className="font-bold text-slate-800 capitalize">
                  {order.options.binding.replace('_', ' ')}
                </span>
              </div>
            </div>

            {order.customerInstructions && (
              <div className="mt-2 p-2.5 rounded-lg bg-amber-50/70 border border-amber-200/60 text-amber-900">
                <span className="font-bold block text-[11px] mb-0.5">Special Instructions:</span>
                <p className="text-xs leading-relaxed">{order.customerInstructions}</p>
              </div>
            )}
          </div>

          {/* Pricing & Payment Snapshot */}
          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-2 text-xs">
            <div className="flex justify-between items-baseline">
              <span className="font-bold text-slate-800">Payment Breakdown</span>
              <span className="font-black text-base text-emerald-600">
                Total: ₹{order.pricingSnapshot.totalAmount.toFixed(2)}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 text-[11px] text-slate-500">
              <span>Rate: ₹{order.pricingSnapshot.ratePerPage.toFixed(2)}/page</span>
              {order.pricingSnapshot.colorCharge > 0 && (
                <span>Color: +₹{order.pricingSnapshot.colorCharge.toFixed(2)}</span>
              )}
              {order.pricingSnapshot.bindingCharge > 0 && (
                <span>Binding: +₹{order.pricingSnapshot.bindingCharge.toFixed(2)}</span>
              )}
              {order.paymentReference && (
                <span className="font-mono text-slate-700">Ref/UTR: {order.paymentReference}</span>
              )}
            </div>
          </div>

          {/* Status Timeline History */}
          <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2 text-xs">
            <h4 className="font-bold text-slate-900 border-b border-slate-100 pb-1.5 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>Status Audit Timeline</span>
            </h4>
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {order.statusHistory.map((item, idx) => (
                <div key={idx} className="flex items-start justify-between text-[11px] border-b border-slate-50 pb-1">
                  <div>
                    <span className="font-bold capitalize text-slate-800 mr-2">
                      {item.status.replace('_', ' ')}
                    </span>
                    <span className="text-slate-500">{item.note}</span>
                  </div>
                  <span className="text-slate-400 text-[10px] shrink-0 font-mono">
                    {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* SHOP HANDLER OPERATIONAL ACTIONS */}
          {isHandler && (
            <div className="p-4 rounded-xl bg-purple-50 border border-purple-200 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-purple-900 flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-purple-700" />
                  <span>Shop Handler Actions</span>
                </span>
                <button
                  type="button"
                  onClick={handleTogglePriority}
                  disabled={isProcessing}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                    order.isPriority
                      ? 'bg-rose-100 border-rose-300 text-rose-800'
                      : 'bg-white border-purple-200 text-purple-700 hover:bg-purple-100'
                  }`}
                >
                  {order.isPriority ? 'Remove Priority' : '⚡ Prioritize Order'}
                </button>
              </div>

              {/* Payment verification button for handler */}
              {order.paymentStatus === 'submitted' && (
                <div className="p-2.5 bg-white rounded-lg border border-purple-200 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-800">
                      Payment Submitted (UTR: {order.paymentReference})
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Amount: ₹{order.pricingSnapshot.totalAmount.toFixed(2)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleVerifyPayment(true)}
                      disabled={isProcessing}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs shadow-xs"
                    >
                      Verify Payment
                    </button>
                    <button
                      type="button"
                      onClick={() => handleVerifyPayment(false)}
                      disabled={isProcessing}
                      className="px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg font-medium text-xs"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}

              {/* Order status transition buttons */}
              <div className="flex flex-wrap gap-2 pt-1">
                {(order.status === 'confirmed' || order.status === 'waiting') && (
                  <button
                    type="button"
                    onClick={() => handleStatusChange('printing', 'Printing started by shop handler')}
                    disabled={isProcessing}
                    className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Start Printing</span>
                  </button>
                )}

                {order.status === 'printing' && (
                  <button
                    type="button"
                    onClick={() => handleStatusChange('ready', 'Printout ready at counter for collection')}
                    disabled={isProcessing}
                    className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Mark as Ready for Collection</span>
                  </button>
                )}

                {order.status === 'ready' && (
                  <button
                    type="button"
                    onClick={() => handleStatusChange('collected', 'Customer collected the printout')}
                    disabled={isProcessing}
                    className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <PackageCheck className="w-4 h-4" />
                    <span>Mark as Collected</span>
                  </button>
                )}

                {order.status === 'collected' && (
                  <div className="w-full text-center text-xs font-bold p-3 bg-emerald-50 text-emerald-800 rounded-xl border border-emerald-200 flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Order Collected Successfully.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Customer Action (Mark as Collected if Ready) */}
          {!isHandler && order.status === 'ready' && (
            <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-xs">
              <div>
                <p className="font-bold text-emerald-950 flex items-center gap-1.5 text-xs">
                  <PackageCheck className="w-4 h-4 text-emerald-600" />
                  <span>Your printout is ready at the Xerox counter!</span>
                </p>
                <p className="text-emerald-700 text-[11px] mt-0.5">
                  Picked up your order? Confirm here to finish and archive.
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleStatusChange('collected', 'Customer confirmed collection at counter')}
                disabled={isProcessing}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{isProcessing ? 'Confirming...' : 'I Have Collected My Order'}</span>
              </button>
            </div>
          )}

          {/* Customer Action (Collected notice) */}
          {!isHandler && order.status === 'collected' && (
            <div className="w-full text-center text-xs font-bold p-3.5 bg-emerald-50 text-emerald-800 rounded-xl border border-emerald-200 flex items-center justify-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>You have collected this order. Thank you!</span>
            </div>
          )}

          {/* Customer Action (Pay Now if pending) */}
          {!isHandler && order.paymentStatus === 'pending' && onPayNow && (
            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-between text-xs">
              <div>
                <p className="font-bold text-blue-900">Payment Pending</p>
                <p className="text-blue-700 text-[11px]">Pay now to start printing</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onPayNow(order);
                }}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs"
              >
                Pay ₹{order.pricingSnapshot.totalAmount.toFixed(2)}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
