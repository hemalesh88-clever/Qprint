import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransitionStatus, calculateQueuePositions, estimateCollectionMinutes } from './orderRules';
import { Order } from '../types';

test('valid transitions in standard workflow', () => {
  assert.equal(canTransitionStatus('confirmed', 'waiting'), true);
  assert.equal(canTransitionStatus('waiting', 'printing'), true);
  assert.equal(canTransitionStatus('printing', 'ready'), true);
  assert.equal(canTransitionStatus('ready', 'collected'), true);
});

test('invalid transitions rejection', () => {
  // Cannot jump from confirmed straight to collected
  assert.equal(canTransitionStatus('confirmed', 'collected'), false);
  // Cannot move backwards from collected
  assert.equal(canTransitionStatus('collected', 'printing'), false);
  // Cannot transition cancelled orders
  assert.equal(canTransitionStatus('cancelled', 'ready'), false);
});

test('FIFO queue positioning and manual priority override', () => {
  const dummyOrders: Partial<Order>[] = [
    { id: '1', status: 'waiting', createdAt: '2026-10-24T10:00:00Z', isPriority: false },
    { id: '2', status: 'waiting', createdAt: '2026-10-24T10:05:00Z', isPriority: false },
    { id: '3', status: 'waiting', createdAt: '2026-10-24T10:10:00Z', isPriority: true }, // prioritized
    { id: '4', status: 'printing', createdAt: '2026-10-24T09:55:00Z', isPriority: false }, // currently printing
    { id: '5', status: 'ready', createdAt: '2026-10-24T09:50:00Z', isPriority: false }, // already ready (not in queue)
  ];

  const updated = calculateQueuePositions(dummyOrders as Order[]);

  const order4 = updated.find((o) => o.id === '4');
  const order3 = updated.find((o) => o.id === '3');
  const order1 = updated.find((o) => o.id === '1');
  const order2 = updated.find((o) => o.id === '2');
  const order5 = updated.find((o) => o.id === '5');

  // Currently printing is position 1
  assert.equal(order4?.queuePosition, 1);
  // Prioritized waiting order 3 is position 2
  assert.equal(order3?.queuePosition, 2);
  // First waiting FIFO order 1 is position 3
  assert.equal(order1?.queuePosition, 3);
  // Second waiting FIFO order 2 is position 4
  assert.equal(order2?.queuePosition, 4);
  // Ready order has no queue position
  assert.equal(order5?.queuePosition, undefined);
});

test('estimateCollectionMinutes scales with queue position and page count', () => {
  const est1 = estimateCollectionMinutes(1, 10, 2);
  const est3 = estimateCollectionMinutes(3, 10, 2);
  assert.ok(est3 > est1);
});
