import React, { useState } from 'react';
import {
  X,
  Search,
  CheckCircle2,
  Clock,
  Printer,
  PackageCheck,
  AlertCircle,
  Loader2,
  ChevronRight,
  Flame,
  Sparkles
} from 'lucide-react';
import { Order, OrderStatus } from '../types';
import { estimateCollectionMinutes } from '../utils/orderRules';
import { updateOrderStatus } from '../lib/firestoreService';

interface OrderTrackingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onViewOrderDetails: (order: Order) => void;
}

export const OrderTrackingModal: React.FC<OrderTrackingModalProps> = ({
  isOpen,
  onClose,
  onViewOrderDetails,
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isMarkingCollected, setIsMarkingCollected] = useState<boolean>(false);
  const [trackedOrder, setTrackedOrder] = useState<Order | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const handleClientMarkCollected = async () => {
    if (!trackedOrder) return;
    if (!window.confirm('Confirm that you have collected this printout from the Xerox counter?')) return;
    setIsMarkingCollected(true);
    try {
      await updateOrderStatus(trackedOrder.id, 'collected', trackedOrder.userName, 'Confirmed collection via tracker');
      try {
        await fetch(`/api/orders/${trackedOrder.id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'collected', note: 'Customer confirmed collection' }),
        });
      } catch (e) {}
      setTrackedOrder((prev) => (prev ? { ...prev, status: 'collected' } : null));
    } catch (err: any) {
      console.error('Error confirming collection:', err);
    } finally {
      setIsMarkingCollected(false);
    }
  };

  if (!isOpen) return null;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchTerm.trim()) return;

    setIsSearching(true);
    setSearchError(null);
    setTrackedOrder(null);

    try {
      const res = await fetch(`/api/orders?search=${encodeURIComponent(searchTerm.trim())}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to search order.');

      if (Array.isArray(data) && data.length > 0) {
        // Find exact match on order number or first match
        const exact = data.find(
          (o: Order) =>
            o.orderNumber.toLowerCase() === searchTerm.trim().toLowerCase() ||
            o.userPhone.includes(searchTerm.trim())
        );
        setTrackedOrder(exact || data[0]);
      } else {
        setSearchError('No order found matching this Order Number or Phone Number.');
      }
    } catch (err: any) {
      setSearchError(err.message || 'Error tracking order.');
    } finally {
      setIsSearching(false);
    }
  };

  const statusSteps: { key: OrderStatus; label: string; desc: string }[] = [
    { key: 'confirmed', label: 'Order Confirmed', desc: 'Received & price calculated' },
    { key: 'waiting', label: 'In Queue', desc: 'Waiting for xerox operator' },
    { key: 'printing', label: 'Actively Printing', desc: 'Running on high-speed printers' },
    { key: 'ready', label: 'Ready for Collection', desc: 'At RIT Xerox shop counter' },
    { key: 'collected', label: 'Collected', desc: 'Handed over to customer' },
  ];

  const getStepStatus = (stepKey: OrderStatus, current: OrderStatus) => {
    const orderProgression: OrderStatus[] = ['confirmed', 'waiting', 'printing', 'ready', 'collected'];
    const currentIndex = orderProgression.indexOf(current);
    const stepIndex = orderProgression.indexOf(stepKey);

    if (stepIndex < currentIndex) return 'completed';
    if (stepIndex === currentIndex) return 'active';
    return 'upcoming';
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden text-slate-800 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-600" />
              <span>Real-Time Order Tracker</span>
            </h2>
            <p className="text-xs text-slate-500">
              Check live queue position, estimated turnaround & pickup readiness
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Search bar */}
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              placeholder="e.g. QP-2026-000001 or 9840123456"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-xl focus:ring-1 focus:ring-blue-500 font-medium"
            />
            <button
              type="submit"
              disabled={isSearching}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              <span>Track</span>
            </button>
          </form>

          {searchError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{searchError}</span>
            </div>
          )}

          {/* Results Display */}
          {trackedOrder && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* Order Info pill */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-blue-900 to-indigo-900 text-white flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-base">
                      #{trackedOrder.orderNumber}
                    </span>
                    {trackedOrder.isPriority && (
                      <span className="text-[10px] bg-rose-500 text-white font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1">
                        <Flame className="w-2.5 h-2.5" />
                        Priority
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-blue-200 mt-0.5">
                    {trackedOrder.userName} • {trackedOrder.pageCount} pages ({trackedOrder.options.copies} copy)
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-sm font-black text-emerald-400 block">
                    ₹{trackedOrder.pricingSnapshot.totalAmount.toFixed(2)}
                  </span>
                  <span className="text-[10px] text-blue-200 capitalize">
                    {trackedOrder.paymentStatus}
                  </span>
                </div>
              </div>

              {/* Ready for Collection Banner if Ready */}
              {trackedOrder.status === 'ready' && (
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-center space-y-1">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                  <h4 className="text-sm font-black">
                    Your printout is ready for collection!
                  </h4>
                  <p className="text-xs text-emerald-800">
                    Please head over to the RIT Xerox Center counter with order #{trackedOrder.orderNumber}.
                  </p>
                </div>
              )}

              {/* Queue Position and estimated time */}
              {trackedOrder.status === 'waiting' && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-amber-800 font-bold block">
                      Queue Position: #{trackedOrder.queuePosition || 1} in line
                    </span>
                    <span className="text-amber-700 text-[11px]">
                      Estimated ready in ~{estimateCollectionMinutes(trackedOrder.queuePosition, trackedOrder.pageCount)} mins
                    </span>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-amber-200/80 text-amber-900 font-bold text-[11px]">
                    Waiting in Queue
                  </span>
                </div>
              )}

              {/* Status Timeline Stepper */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <h4 className="text-xs font-bold text-slate-800">Operational Timeline</h4>
                <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                  {statusSteps.map((s) => {
                    const state = getStepStatus(s.key, trackedOrder.status);
                    return (
                      <div key={s.key} className="relative flex items-start gap-3 text-xs">
                        <div
                          className={`absolute -left-6 top-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                            state === 'completed'
                              ? 'bg-emerald-600 text-white'
                              : state === 'active'
                              ? 'bg-blue-600 text-white ring-4 ring-blue-100 animate-pulse'
                              : 'bg-slate-200 text-slate-400'
                          }`}
                        >
                          {state === 'completed' ? <CheckCircle2 className="w-3.5 h-3.5" /> : '•'}
                        </div>
                        <div>
                          <p
                            className={`font-bold ${
                              state === 'active'
                                ? 'text-blue-700'
                                : state === 'completed'
                                ? 'text-slate-800'
                                : 'text-slate-400'
                            }`}
                          >
                            {s.label}
                          </p>
                          <p className="text-[11px] text-slate-500">{s.desc}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Ready for Collection Notice & Action */}
              {trackedOrder.status === 'ready' && (
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <p className="font-bold text-emerald-900 flex items-center gap-1.5">
                      <PackageCheck className="w-4 h-4 text-emerald-600" />
                      <span>Ready for Collection!</span>
                    </p>
                    <p className="text-emerald-700 text-[11px] mt-0.5">
                      Available at the Xerox counter now.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleClientMarkCollected}
                    disabled={isMarkingCollected}
                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{isMarkingCollected ? 'Confirming...' : 'I Have Collected'}</span>
                  </button>
                </div>
              )}

              {trackedOrder.status === 'collected' && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-center text-xs font-bold text-emerald-800 flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Order Collected. Thank you!</span>
                </div>
              )}

              {/* View Full Order Details button */}
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onViewOrderDetails(trackedOrder);
                }}
                className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>View Full Order Details</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
