import React, { useState, useEffect } from 'react';
import {
  X,
  CreditCard,
  AlertCircle,
  Loader2,
  ShieldCheck,
  CheckCircle2,
  Sparkles,
  Lock,
  ArrowRight,
  FileText,
  Banknote
} from 'lucide-react';
import { Order, ShopSettings } from '../types';
import { useAuth } from '../context/AuthContext';
import {
  subscribeShopSettings,
  subscribeToOrder,
  recordPaymentFailed,
  recordRazorpaySuccess,
  updateOrderStatus
} from '../lib/firestoreService';

interface PaymentModalProps {
  order: Order | null;
  isOpen: boolean;
  onClose: () => void;
  onPaymentSuccess: (updatedOrder: Order) => void;
  onOrderCancelled?: (orderId: string) => void;
}

type PaymentState = 'idle' | 'initializing' | 'checkout_open' | 'verifying' | 'success' | 'cancelled' | 'failed';

export const PaymentModal: React.FC<PaymentModalProps> = ({
  order,
  isOpen,
  onClose,
  onPaymentSuccess,
  onOrderCancelled,
}) => {
  const { token, user } = useAuth();
  const [paymentState, setPaymentState] = useState<PaymentState>('idle');
  const [isCancellingOrder, setIsCancellingOrder] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [updatedOrder, setUpdatedOrder] = useState<Order | null>(null);
  const [shopSettings, setShopSettings] = useState<ShopSettings | null>(null);
  const [paymentReference, setPaymentReference] = useState<string | null>(null);

  // Subscribe to live shop settings
  useEffect(() => {
    if (!isOpen) return;
    const unsub = subscribeShopSettings((settings) => {
      setShopSettings(settings);
    });
    return () => unsub();
  }, [isOpen]);

  // Reset state on each new order
  useEffect(() => {
    if (!isOpen || !order) return;
    setPaymentState('idle');
    setErrorMessage(null);
    setUpdatedOrder(null);
    setPaymentReference(null);
  }, [isOpen, order?.id]);

  // Real-time Firestore listener — detects server-confirmed payment instantly
  useEffect(() => {
    if (!isOpen || !order?.id || paymentState === 'success') return;

    const unsub = subscribeToOrder(order.id, (latestOrder) => {
      if (latestOrder && latestOrder.paymentStatus === 'verified') {
        setUpdatedOrder(latestOrder);
        setPaymentReference(latestOrder.paymentReference || null);
        setPaymentState('success');
        onPaymentSuccess(latestOrder);
      }
    });

    return () => unsub();
  }, [isOpen, order?.id, paymentState]);

  if (!isOpen || !order) return null;

  const totalAmount = order.pricingSnapshot.totalAmount;
  const totalAmountStr = totalAmount.toFixed(2);

  const handleCancelOrder = async () => {
    if (!order) return;
    setIsCancellingOrder(true);
    try {
      await updateOrderStatus(
        order.id,
        'cancelled',
        user?.name || 'Customer',
        'Customer Cancelled Payment'
      );
      try {
        await fetch(`/api/orders/${order.id}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status: 'cancelled', note: 'Customer Cancelled Payment' }),
        });
      } catch (e) {}

      onOrderCancelled?.(order.id);
      onClose();
    } catch (err: any) {
      console.error('Error cancelling order:', err);
      onOrderCancelled?.(order.id);
      onClose();
    } finally {
      setIsCancellingOrder(false);
    }
  };

  const handleClose = () => {
    if (paymentState === 'success') {
      onClose();
      return;
    }
    if (paymentState === 'initializing' || paymentState === 'checkout_open' || paymentState === 'verifying') {
      // Block close while checkout or verification is in progress
      return;
    }
    if (order && order.paymentStatus === 'pending') {
      if (
        window.confirm(
          'Payment has not been completed. If you close now, your order will be cancelled. Do you want to cancel this order?'
        )
      ) {
        handleCancelOrder();
        return;
      }
      return;
    }
    onClose();
  };

  // === SINGLE RAZORPAY CHECKOUT HANDLER ===
  // Razorpay provides UPI, Cards, Net Banking, Wallets natively in one window.
  // RULE: Opening Razorpay is NOT payment. Returning is NOT payment.
  //       Only server-verified signature confirms payment.
  const handleRazorpayCheckout = async () => {
    setPaymentState('initializing');
    setErrorMessage(null);

    try {
      // Step 1: Create Razorpay order on backend
      const res = await fetch('/api/payments/razorpay/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          orderId: order.id,
          orderNumber: order.orderNumber,
          amount: totalAmount,
          userName: order.userName,
          userPhone: order.userPhone,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to initialize payment. Please try again.');
      }

      const rzpData = await res.json();
      const keyId =
        rzpData.keyId ||
        (import.meta as any).env?.VITE_RAZORPAY_KEY_ID ||
        'rzp_test_Ts1E8IJ905rEp4';
      const razorpayOrderId = rzpData.razorpayOrderId;
      const amountInPaise = rzpData.amount || Math.round(totalAmount * 100);

      // Step 2: Load Razorpay SDK if not already loaded
      if (typeof (window as any).Razorpay === 'undefined') {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () =>
            reject(new Error('Could not load Razorpay Checkout. Check your connection.'));
          document.body.appendChild(script);
        });
      }

      if (typeof (window as any).Razorpay === 'undefined') {
        throw new Error('Razorpay Checkout is unavailable. Check your internet connection.');
      }

      const cleanPhone = (order.userPhone || user?.phone || '9840123456')
        .replace(/\D/g, '')
        .slice(-10);
      const cleanEmail = (
        user?.email ||
        `${order.userId || 'user'}@qprint.rit.ac.in`
      ).trim();

      setPaymentState('checkout_open');

      console.log('[Razorpay Checkout] Launching checkout with options:', {
        key: keyId,
        amount: amountInPaise,
        currency: 'INR',
        orderNumber: order.orderNumber,
        hasServerOrderId: Boolean(razorpayOrderId),
      });

      const options: any = {
        key: keyId,
        amount: amountInPaise,
        currency: 'INR',
        name: 'RIT Xerox & Print Center',
        description: `Print Order #${order.orderNumber} — Qprint`,
        // NOTE: In Razorpay Standard Direct Checkout, order_id must NOT be passed.
        // Razorpay handles UPI, Cards, Net Banking, and Wallets directly using key + amount + currency.
        // Passing any uncreated order_id causes checkout.js to crash with "Oops! Something went wrong. Payment Failed".
        prefill: {
          name: order.userName || 'Student',
          contact: cleanPhone,
          email: cleanEmail,
        },
        notes: {
          qprint_order_id: order.id,
          qprint_order_number: order.orderNumber,
        },
        theme: {
          color: '#2563eb',
        },
        // Razorpay provides ALL payment methods natively in its checkout:
        // UPI (GPay, PhonePe, BHIM, Paytm etc.), Credit Card, Debit Card,
        // Net Banking, Wallets.
        handler: async function (response: any) {
          console.log('[Razorpay Checkout] Payment completed callback received:', {
            paymentId: response.razorpay_payment_id,
            orderId: response.razorpay_order_id,
            signatureReceived: Boolean(response.razorpay_signature),
          });

          // RULE: Payment ID alone is NOT verification.
          // Must send to backend for verification and update authoritative record.
          setPaymentState('verifying');
          setErrorMessage(null);

          try {
            const verifyRes = await fetch('/api/payments/razorpay/verify', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                orderId: order.id,
                orderNumber: order.orderNumber,
                razorpayOrderId: response.razorpay_order_id || razorpayOrderId,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              }),
            });

            const verifyData = await verifyRes.json();
            if (!verifyRes.ok || !verifyData.success) {
              throw new Error(
                verifyData.error ||
                  'Payment verification failed on server. Your bank was not charged.'
              );
            }

            // Sync with Firestore directly for immediate multi-client propagation
            try {
              await recordRazorpaySuccess(order.id, response.razorpay_payment_id, 'Razorpay Verified');
            } catch (fsErr) {
              console.warn('[Firestore] recordRazorpaySuccess notice:', fsErr);
            }

            const verifiedOrder = verifyData.order || {
              ...order,
              status: 'waiting',
              paymentStatus: 'verified',
              paymentMethod: 'razorpay',
              paymentReference: response.razorpay_payment_id,
              paymentVerifiedAt: new Date().toISOString(),
              paymentVerifiedBy: 'Razorpay Gateway Verified',
            };

            setUpdatedOrder(verifiedOrder);
            setPaymentReference(response.razorpay_payment_id);
            setPaymentState('success');
            onPaymentSuccess(verifiedOrder);
          } catch (err: any) {
            console.error('[Razorpay Checkout] Verification error:', err);
            setPaymentState('failed');
            setErrorMessage(
              err.message || 'Payment verification failed. Contact support with your payment ID.'
            );
          }
        },
        modal: {
          ondismiss: function () {
            // User closed Razorpay WITHOUT completing payment
            // RULE: Closing is NOT payment. Order stays unpaid.
            console.log('[Razorpay Checkout] User dismissed payment modal.');
            setPaymentState('cancelled');
            setErrorMessage(
              'Checkout was closed before payment was completed. Your order has NOT been confirmed and no money was charged.'
            );
          },
          confirm_close: true,
          escape: false,
          animation: true,
        },
      };

      const rzpInstance = new (window as any).Razorpay(options);

      rzpInstance.on('payment.failed', async function (response: any) {
        console.error('[Razorpay Payment Failed Callback]', {
          code: response.error?.code,
          description: response.error?.description,
          source: response.error?.source,
          step: response.error?.step,
          reason: response.error?.reason,
          metadata: response.error?.metadata,
        });
        setPaymentState('failed');
        const reason =
          response.error?.description ||
          response.error?.reason ||
          'Payment was declined or failed.';
        setErrorMessage(
          `Payment failed: ${reason}. Your order has NOT been confirmed.`
        );

        try {
          await recordPaymentFailed(order.id, reason);
        } catch (e) {}

        try {
          await fetch('/api/payments/razorpay/fail', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              orderId: order.id,
              reason,
              code: response.error?.code,
            }),
          });
        } catch (e) {}
      });

      rzpInstance.open();
    } catch (err: any) {
      setPaymentState('failed');
      setErrorMessage(err.message || 'Unable to open payment gateway. Please try again.');
    }
  };

  const isLoading =
    paymentState === 'initializing' ||
    paymentState === 'checkout_open' ||
    paymentState === 'verifying';

  const showPayButton =
    paymentState === 'idle' ||
    paymentState === 'cancelled' ||
    paymentState === 'failed';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden text-slate-800 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Lock className="w-4 h-4 text-blue-600" />
              <span>Secure Payment</span>
              <span className="text-[10px] font-medium bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">v2.4 Live</span>
            </h2>
            <p className="text-xs text-slate-500 font-mono">
              #{order.orderNumber} • {order.pageCount} pages ({order.options.copies} set)
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={isLoading}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="Close payment"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5">
          {/* ===== SUCCESS STATE ===== */}
          {paymentState === 'success' ? (
            <div className="text-center py-6 space-y-4">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
                <CheckCircle2 className="w-9 h-9" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 flex items-center justify-center gap-2">
                  <Sparkles className="w-5 h-5 text-emerald-500" />
                  Payment Verified!
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto leading-relaxed">
                  Your payment was verified by Razorpay. Order #{order.orderNumber} is now in the
                  college printing queue.
                </p>
              </div>

              {(paymentReference || updatedOrder?.paymentReference) && (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-left">
                  <span className="text-slate-400 text-[10px] block uppercase font-bold mb-1">
                    Razorpay Payment ID
                  </span>
                  <span className="font-mono font-bold text-slate-800 break-all">
                    {paymentReference || updatedOrder?.paymentReference}
                  </span>
                </div>
              )}

              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-800 font-medium">
                ✅ Confirmed by Razorpay. Your file will be printed shortly.
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-md transition-all cursor-pointer"
              >
                Done • View Print Queue
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* ===== AMOUNT BANNER ===== */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-800 text-white flex items-center justify-between shadow-md">
                <div>
                  <span className="text-[11px] text-blue-200 block uppercase tracking-wide font-semibold">
                    Total Payable Amount
                  </span>
                  <span className="text-3xl font-black text-white font-mono">
                    ₹{totalAmountStr}
                  </span>
                </div>
                <div className="text-right text-[11px] text-blue-200 font-medium space-y-1">
                  <span className="bg-white/15 px-2.5 py-1 rounded-full border border-white/20 block text-center">
                    {order.options.copies} set • {order.options.color === 'color' ? '🎨 Color' : '⬛ B&W'}
                  </span>
                  <span className="bg-white/10 px-2.5 py-1 rounded-full border border-white/15 block text-center">
                    {order.pageCount} pages
                  </span>
                </div>
              </div>

              {/* ===== ORDER SUMMARY ===== */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                <div className="flex items-center gap-2 text-slate-600 font-semibold mb-2">
                  <FileText className="w-3.5 h-3.5 text-slate-400" />
                  <span>Order Summary</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>File</span>
                  <span className="font-medium text-slate-800 max-w-[180px] truncate text-right">
                    {order.file?.originalName || 'Document'}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Print Type</span>
                  <span className="font-medium text-slate-800">
                    {order.options.color === 'color' ? 'Color' : 'Black & White'} •{' '}
                    {order.options.sides === 'double' ? 'Double Sided' : 'Single Sided'}
                  </span>
                </div>
                {order.options.binding && order.options.binding !== 'none' && (
                  <div className="flex justify-between text-slate-600">
                    <span>Binding</span>
                    <span className="font-medium text-slate-800 capitalize">
                      {order.options.binding}
                    </span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-slate-200">
                  <span>Total</span>
                  <span className="font-mono text-blue-700">₹{totalAmountStr}</span>
                </div>
              </div>

              {/* ===== ERROR / STATUS MESSAGES ===== */}
              {errorMessage && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* ===== VERIFYING STATE ===== */}
              {paymentState === 'verifying' && (
                <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 flex items-center gap-3">
                  <Loader2 className="w-5 h-5 text-blue-600 animate-spin shrink-0" />
                  <div>
                    <p className="font-bold text-sm">Verifying payment with Razorpay...</p>
                    <p className="text-xs text-blue-600 mt-0.5">
                      Please wait. Do not close this window.
                    </p>
                  </div>
                </div>
              )}

              {/* ===== INITIALIZING / CHECKOUT OPEN STATE ===== */}
              {(paymentState === 'initializing' || paymentState === 'checkout_open') && (
                <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-800 flex items-center gap-3">
                  <Loader2 className="w-5 h-5 text-indigo-600 animate-spin shrink-0" />
                  <div>
                    <p className="font-bold text-sm">
                      {paymentState === 'initializing'
                        ? 'Opening Razorpay Checkout...'
                        : 'Razorpay Checkout is open'}
                    </p>
                    <p className="text-xs text-indigo-600 mt-0.5">
                      {paymentState === 'initializing'
                        ? 'Connecting to Razorpay secure gateway...'
                        : 'Complete your payment in the Razorpay window.'}
                    </p>
                  </div>
                </div>
              )}

              {/* ===== RAZORPAY PAY BUTTON (IDLE / RETRY) ===== */}
              {showPayButton && (
                <div className="space-y-3">
                  {/* Supported payment methods info */}
                  <div className="p-3.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-600 space-y-2.5">
                    <div className="flex items-center gap-2 font-semibold text-slate-700">
                      <ShieldCheck className="w-4 h-4 text-blue-600" />
                      <span>Pay via Razorpay Secure Checkout</span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Choose any payment method inside Razorpay — UPI (GPay, PhonePe, BHIM, Paytm),
                      Credit/Debit Card, Net Banking, or Wallets.
                    </p>
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {['UPI', 'GPay', 'PhonePe', 'Credit Card', 'Debit Card', 'Net Banking', 'Wallets'].map(
                        (m) => (
                          <span
                            key={m}
                            className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold border border-slate-200"
                          >
                            {m}
                          </span>
                        )
                      )}
                    </div>
                  </div>

                  {/* THE SINGLE PAY BUTTON */}
                  <button
                    type="button"
                    onClick={handleRazorpayCheckout}
                    disabled={isLoading || isCancellingOrder}
                    className="w-full py-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-black text-lg shadow-lg transition-all flex items-center justify-center gap-3 cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Banknote className="w-5 h-5" />
                    <span>Pay ₹{totalAmountStr}</span>
                    <ArrowRight className="w-5 h-5" />
                  </button>

                  {/* Security note */}
                  <p className="text-center text-[10px] text-slate-400 flex items-center justify-center gap-1">
                    <Lock className="w-3 h-3" />
                    <span>Secured by Razorpay • PCI DSS Compliant • 256-bit SSL</span>
                  </p>
                </div>
              )}

              {/* ===== CANCEL ORDER ===== */}
              {showPayButton && (
                <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={handleCancelOrder}
                    disabled={isLoading || isCancellingOrder}
                    className="px-3 py-1.5 rounded-lg text-rose-600 hover:text-rose-800 hover:bg-rose-50 font-bold transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {isCancellingOrder ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Cancelling...</span>
                      </>
                    ) : (
                      <span>Cancel This Order</span>
                    )}
                  </button>
                  <span className="text-[11px] text-slate-400">
                    Order will be removed from printing queue
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
