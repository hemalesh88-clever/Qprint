import { Order, OrderStatus } from '../types';

export const VALID_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  confirmed: ['waiting', 'printing', 'cancelled'],
  waiting: ['printing', 'cancelled'],
  printing: ['ready', 'cancelled'],
  ready: ['collected', 'cancelled'],
  collected: [], // Terminal state
  cancelled: [], // Terminal state
};

/**
 * Validates whether an order status transition is permissible.
 */
export function canTransitionStatus(currentStatus: OrderStatus, newStatus: OrderStatus): boolean {
  if (currentStatus === newStatus) return true;
  const allowed = VALID_STATUS_TRANSITIONS[currentStatus];
  return allowed ? allowed.includes(newStatus) : false;
}

/**
 * Calculates FIFO queue positions for active waiting and printing orders.
 * Orders marked as `isPriority` are positioned before standard FIFO orders.
 */
export function calculateQueuePositions(orders: Order[]): Order[] {
  // Only orders in 'waiting' or 'printing' belong in the active queue
  const queueOrders = orders.filter((o) => o.status === 'waiting' || o.status === 'printing');

  // Sort:
  // 1. Currently printing comes first
  // 2. Then prioritized waiting orders (sorted by createdAt)
  // 3. Then standard waiting orders (sorted by createdAt FIFO)
  const sorted = [...queueOrders].sort((a, b) => {
    if (a.status === 'printing' && b.status !== 'printing') return -1;
    if (b.status === 'printing' && a.status !== 'printing') return 1;

    if (a.isPriority && !b.isPriority) return -1;
    if (!a.isPriority && b.isPriority) return 1;

    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const positionMap = new Map<string, number>();
  sorted.forEach((order, index) => {
    positionMap.set(order.id, index + 1);
  });

  return orders.map((order) => {
    if (positionMap.has(order.id)) {
      return { ...order, queuePosition: positionMap.get(order.id) };
    }
    return { ...order, queuePosition: undefined };
  });
}

/**
 * Estimates turnaround / collection time in minutes based on queue position and page count.
 */
export function estimateCollectionMinutes(
  queuePosition: number | undefined,
  pageCount: number,
  minutesPerTenPages: number = 2
): number {
  if (!queuePosition || queuePosition <= 0) return 3; // Minimal baseline if already ready or next

  const baseMinutesForOrder = Math.max(2, Math.ceil((pageCount / 10) * minutesPerTenPages));
  // Additional waiting minutes for each preceding job in queue
  const queueWaitMinutes = (queuePosition - 1) * 3;

  return baseMinutesForOrder + queueWaitMinutes;
}
