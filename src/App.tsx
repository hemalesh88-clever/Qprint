import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { RealtimeProvider, useRealtime } from './context/RealtimeContext';
import { Navbar } from './components/Navbar';
import { LandingHero } from './components/LandingHero';
import { StudentDashboard } from './components/StudentDashboard';
import { FacultyDashboard } from './components/FacultyDashboard';
import { ShopHandlerDashboard } from './components/ShopHandlerDashboard';
import { CreateOrderModal } from './components/CreateOrderModal';
import { PaymentModal } from './components/PaymentModal';
import { OrderDetailsModal } from './components/OrderDetailsModal';
import { OrderTrackingModal } from './components/OrderTrackingModal';
import { AuthModals } from './components/AuthModals';
import { ProfileModal } from './components/ProfileModal';
import { isProfileComplete } from './lib/firestoreService';
import { Order } from './types';
import { CheckCircle2, PackageCheck, X, Sparkles } from 'lucide-react';

const AppContent: React.FC = () => {
  const { user } = useAuth();
  const { readyAlertOrder, clearReadyAlert } = useRealtime();

  // Modals state
  const [isAuthOpen, setIsAuthOpen] = useState<boolean>(false);
  const [authInitialTab, setAuthInitialTab] = useState<
    'student_login' | 'faculty_login' | 'handler_login' | 'student_register' | 'faculty_register'
  >('student_login');

  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [isTrackOpen, setIsTrackOpen] = useState<boolean>(false);
  const [isProfileOpen, setIsProfileOpen] = useState<boolean>(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [paymentOrder, setPaymentOrder] = useState<Order | null>(null);
  const [, setRefreshKey] = useState<number>(0);
  const triggerRefresh = () => setRefreshKey((k) => k + 1);

  // Automatically prompt for profile completion upon login if details are missing
  React.useEffect(() => {
    if (user && user.role !== 'handler' && !isProfileComplete(user)) {
      setIsProfileOpen(true);
    }
  }, [user]);

  const handleOpenAuth = (tab: any = 'student_login') => {
    setAuthInitialTab(tab);
    setIsAuthOpen(true);
  };

  const handleOpenCreateOrder = () => {
    if (!user) {
      handleOpenAuth('student_login');
      return;
    }
    // Enforce profile completion before allowing order creation
    if (!isProfileComplete(user)) {
      setIsProfileOpen(true);
      return;
    }
    setIsCreateOpen(true);
  };

  const handleOrderCreated = (order: Order) => {
    // Once created, open payment modal for the customer
    setPaymentOrder(order);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-blue-100 selection:text-blue-900">
      {/* Real-time Floating Ready for Collection Alert Toast */}
      {readyAlertOrder && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm w-full bg-emerald-600 text-white rounded-2xl p-4 shadow-2xl border border-emerald-400 flex items-start gap-3 animate-in slide-in-from-bottom-5 duration-200">
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <PackageCheck className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <h4 className="text-xs font-black uppercase tracking-wider text-emerald-100">
              Collection Alert
            </h4>
            <p className="text-sm font-bold text-white mt-0.5">
              Your printout #{readyAlertOrder} is ready!
            </p>
            <p className="text-[11px] text-emerald-100 mt-1">
              Please proceed to the RIT Xerox Center counter for pickup.
            </p>
          </div>
          <button
            onClick={clearReadyAlert}
            className="text-white/80 hover:text-white p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Navigation */}
      <Navbar
        onOpenAuth={handleOpenAuth}
        onOpenCreateOrder={handleOpenCreateOrder}
        onOpenTrackModal={() => setIsTrackOpen(true)}
        onOpenProfile={() => setIsProfileOpen(true)}
      />

      {/* Main View Switcher based on Authentication & Role */}
      <main className="flex-1">
        {user?.role === 'handler' ? (
          <ShopHandlerDashboard onSelectOrder={(order) => setSelectedOrder(order)} />
        ) : user?.role === 'faculty' ? (
          <FacultyDashboard
            onOpenCreateOrder={handleOpenCreateOrder}
            onOpenTrackModal={() => setIsTrackOpen(true)}
            onSelectOrder={(order) => setSelectedOrder(order)}
            onPayNow={(order) => setPaymentOrder(order)}
            onOpenProfile={() => setIsProfileOpen(true)}
          />
        ) : user?.role === 'student' ? (
          <StudentDashboard
            onOpenCreateOrder={handleOpenCreateOrder}
            onOpenTrackModal={() => setIsTrackOpen(true)}
            onSelectOrder={(order) => setSelectedOrder(order)}
            onPayNow={(order) => setPaymentOrder(order)}
            onOpenProfile={() => setIsProfileOpen(true)}
          />
        ) : (
          <LandingHero
            onOpenCreateOrder={handleOpenCreateOrder}
            onOpenAuth={handleOpenAuth}
            onOpenTrackModal={() => setIsTrackOpen(true)}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900">Qprint</span>
            <span>•</span>
            <span className="font-semibold text-slate-700">by HEMALESH</span>
            <span>•</span>
            <span>Upload. Pay. Track. Print. Collect.</span>
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <span>RIT Xerox & Print Center</span>
            <span>•</span>
            <button
              onClick={() => handleOpenAuth('handler_login')}
              className="text-purple-600 hover:text-purple-800 font-semibold"
            >
              Handler Portal
            </button>
            <span>•</span>
            <span>All rights reserved © 2026</span>
          </div>
        </div>
      </footer>

      {/* Global Modals */}
      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        enforceCompletion={Boolean(user && user.role !== 'handler' && !isProfileComplete(user))}
      />

      <CreateOrderModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onOrderCreated={handleOrderCreated}
        onRequireAuth={() => handleOpenAuth('student_login')}
      />

      <PaymentModal
        order={paymentOrder}
        isOpen={Boolean(paymentOrder)}
        onClose={() => {
          setPaymentOrder(null);
          triggerRefresh();
        }}
        onOrderCancelled={(_orderId) => {
          setPaymentOrder(null);
          triggerRefresh();
        }}
        onPaymentSuccess={(updated) => {
          setSelectedOrder(updated);
          triggerRefresh();
        }}
      />

      <OrderDetailsModal
        order={selectedOrder}
        isOpen={Boolean(selectedOrder)}
        onClose={() => setSelectedOrder(null)}
        onOrderUpdated={(updated) => setSelectedOrder(updated)}
        onPayNow={(order) => {
          setSelectedOrder(null);
          setPaymentOrder(order);
        }}
      />

      <OrderTrackingModal
        isOpen={isTrackOpen}
        onClose={() => setIsTrackOpen(false)}
        onViewOrderDetails={(order) => {
          setIsTrackOpen(false);
          setSelectedOrder(order);
        }}
      />

      <AuthModals
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        initialTab={authInitialTab}
      />
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <RealtimeProvider>
        <AppContent />
      </RealtimeProvider>
    </AuthProvider>
  );
}
