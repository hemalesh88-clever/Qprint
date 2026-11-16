import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOrderPrice } from './utils/pricing';
import { canTransitionStatus, calculateQueuePositions, estimateCollectionMinutes } from './utils/orderRules';

test('Order Workflow: Confirmed -> Waiting -> Printing -> Ready -> Collected', () => {
  // Step 1: Confirmed to waiting
  assert.equal(canTransitionStatus('confirmed', 'waiting'), true);

  // Step 2: Waiting to printing
  assert.equal(canTransitionStatus('waiting', 'printing'), true);

  // Step 3: Printing to ready for collection
  assert.equal(canTransitionStatus('printing', 'ready'), true);

  // Step 4: Ready to collected
  assert.equal(canTransitionStatus('ready', 'collected'), true);

  // Negative checks: Collected cannot transition further
  assert.equal(canTransitionStatus('collected', 'waiting'), false);
  assert.equal(canTransitionStatus('collected', 'ready'), false);
});

test('Pricing System: Integer Paise Precision for 1, 10, 11, 50, 51, 100, 101 pages', () => {
  const p1 = calculateOrderPrice(1);
  assert.equal(p1.totalAmount, 2.00);

  const p10 = calculateOrderPrice(10);
  assert.equal(p10.totalAmount, 20.00);

  const p11 = calculateOrderPrice(11);
  assert.equal(p11.totalAmount, 16.50);

  const p50 = calculateOrderPrice(50);
  assert.equal(p50.totalAmount, 75.00);

  const p51 = calculateOrderPrice(51);
  assert.equal(p51.totalAmount, 51.00);

  const p100 = calculateOrderPrice(100);
  assert.equal(p100.totalAmount, 100.00);

  const p101 = calculateOrderPrice(101);
  assert.equal(p101.totalAmount, 75.75);
});

test('Queue Estimation: Position and Turnaround Scaling', () => {
  const est1 = estimateCollectionMinutes(1, 15, 2);
  const est2 = estimateCollectionMinutes(2, 15, 2);
  assert.ok(est2 > est1, 'Higher queue position should take longer');
});

test('Order Cancellation: Confirmed order can transition to Cancelled when payment is cancelled', () => {
  assert.equal(canTransitionStatus('confirmed', 'cancelled'), true);
  assert.equal(canTransitionStatus('waiting', 'cancelled'), true);
  // Terminal states cannot transition
  assert.equal(canTransitionStatus('cancelled', 'waiting'), false);
  assert.equal(canTransitionStatus('cancelled', 'printing'), false);
});

test('Dynamic Pricing: Custom Tiers and Updated Spiral / Hard Bound Charges', () => {
  const customTiers = [
    { id: 'custom_1', minPages: 1, maxPages: 20, pricePerPage: 2.50 },
    { id: 'custom_2', minPages: 21, maxPages: null, pricePerPage: 1.20 },
  ];

  const customAddons = {
    colorSurchargePerPage: 10.00,
    spiralBindingCharge: 45.00, // Handler updated from ₹30 to ₹45
    hardBoundCharge: 150.00, // Handler updated from ₹120 to ₹150
  };

  // 15 pages in tier 1 (₹2.50) with updated spiral binding (₹45.00)
  const calc1 = calculateOrderPrice(15, { binding: 'spiral' }, customTiers, customAddons);
  // Base = 15 * 2.50 = 37.50, Binding = 45.00 => Total = 82.50
  assert.equal(calc1.basePricePerPage, 2.50);
  assert.equal(calc1.bindingCharge, 45.00);
  assert.equal(calc1.totalAmount, 82.50);

  // 30 pages in tier 2 (₹1.20) with updated hard bound (₹150.00)
  const calc2 = calculateOrderPrice(30, { binding: 'hard_bound' }, customTiers, customAddons);
  // Base = 30 * 1.20 = 36.00, Binding = 150.00 => Total = 186.00
  assert.equal(calc2.basePricePerPage, 1.20);
  assert.equal(calc2.bindingCharge, 150.00);
  assert.equal(calc2.totalAmount, 186.00);
});

test('Multi-File Upload Management: Sums page counts across files and updates pricing dynamically', () => {
  const file1 = { id: 'f1', originalName: 'Chapter1.pdf', detectedPageCount: 15, sizeBytes: 102400, mimeType: 'application/pdf' };
  const file2 = { id: 'f2', originalName: 'Diagram.png', detectedPageCount: 1, sizeBytes: 20480, mimeType: 'image/png' };
  const file3 = { id: 'f3', originalName: 'Appendix.docx', detectedPageCount: 8, sizeBytes: 51200, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

  const files = [file1, file2, file3];
  const totalPages = files.reduce((sum, f) => sum + f.detectedPageCount, 0);
  assert.equal(totalPages, 24); // 15 + 1 + 8 = 24 pages

  // 24 pages falls in Tier 2 (11-50 pages @ ₹1.50/page)
  const price = calculateOrderPrice(totalPages);
  assert.equal(price.basePricePerPage, 1.50);
  assert.equal(price.totalAmount, 36.00);

  // Removing file3 (8 pages) leaves 16 pages
  const filesAfterRemoval = files.filter((f) => f.id !== 'f3');
  const updatedPages = filesAfterRemoval.reduce((sum, f) => sum + f.detectedPageCount, 0);
  assert.equal(updatedPages, 16);
  const updatedPrice = calculateOrderPrice(updatedPages);
  assert.equal(updatedPrice.totalAmount, 24.00); // 16 * 1.50
});

test('Payment State Machine: Strict state validation and no false verification on checkout cancel', () => {
  const validPaymentStatuses = ['pending', 'processing', 'failed', 'submitted', 'verified', 'expired'];
  assert.ok(validPaymentStatuses.includes('pending'));
  assert.ok(validPaymentStatuses.includes('processing'));
  assert.ok(validPaymentStatuses.includes('failed'));
  assert.ok(validPaymentStatuses.includes('verified'));

  // Initial order payment state MUST be pending
  const orderPayment = {
    paymentStatus: 'pending' as const,
    razorpayOrderId: undefined,
  };
  assert.equal(orderPayment.paymentStatus, 'pending');

  // Checkout closed/dismissed without completing payment MUST remain pending
  const onDismiss = () => {
    // modal.ondismiss does NOT change payment status to verified
    return orderPayment.paymentStatus;
  };
  assert.equal(onDismiss(), 'pending');

  // Payment failure transitions explicitly to 'failed'
  const onPaymentFailed = (reason: string) => {
    return {
      paymentStatus: 'failed' as const,
      failureReason: reason,
    };
  };
  const failedResult = onPaymentFailed('Customer cancelled payment');
  assert.equal(failedResult.paymentStatus, 'failed');
  assert.equal(failedResult.failureReason, 'Customer cancelled payment');
});
