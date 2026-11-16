import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { AppNotification } from '../types';
import { useAuth } from './AuthContext';

interface RealtimeContextType {
  refreshKey: number;
  triggerRefresh: () => void;
  notifications: AppNotification[];
  unreadCount: number;
  markAsRead: (id: string) => Promise<void>;
  readyAlertOrder: string | null;
  clearReadyAlert: () => void;
}

const RealtimeContext = createContext<RealtimeContextType | undefined>(undefined);

export const RealtimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, token } = useAuth();
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [readyAlertOrder, setReadyAlertOrder] = useState<string | null>(null);

  const triggerRefresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  const fetchNotifications = useCallback(async () => {
    if (!token) {
      setNotifications([]);
      return;
    }
    try {
      const res = await fetch('/api/notifications', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
      }
    } catch (err) {
      console.warn('Failed to fetch notifications:', err);
    }
  }, [token]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications, refreshKey]);

  useEffect(() => {
    const eventSource = new EventSource('/api/events');

    eventSource.addEventListener('ORDER_CREATED', () => {
      triggerRefresh();
    });

    eventSource.addEventListener('ORDER_UPDATED', (e: any) => {
      try {
        const order = JSON.parse(e.data);
        if (order.status === 'ready' && user && order.userId === user.id) {
          setReadyAlertOrder(order.orderNumber);
        }
      } catch {}
      triggerRefresh();
    });

    eventSource.addEventListener('PAYMENT_SUBMITTED', () => {
      triggerRefresh();
    });

    eventSource.addEventListener('PAYMENT_VERIFIED', () => {
      triggerRefresh();
    });

    eventSource.addEventListener('SETTINGS_UPDATED', () => {
      triggerRefresh();
    });

    eventSource.addEventListener('PRICING_UPDATED', () => {
      triggerRefresh();
    });

    eventSource.onerror = () => {
      // EventSource reconnects automatically
    };

    return () => {
      eventSource.close();
    };
  }, [triggerRefresh, user]);

  const markAsRead = async (id: string) => {
    if (!token) return;
    try {
      await fetch(`/api/notifications/${id}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    } catch (err) {
      console.warn('Error marking notification read:', err);
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <RealtimeContext.Provider
      value={{
        refreshKey,
        triggerRefresh,
        notifications,
        unreadCount,
        markAsRead,
        readyAlertOrder,
        clearReadyAlert: () => setReadyAlertOrder(null),
      }}
    >
      {children}
    </RealtimeContext.Provider>
  );
};

export const useRealtime = () => {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error('useRealtime must be used within a RealtimeProvider');
  }
  return context;
};
