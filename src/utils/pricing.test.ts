import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOrderPrice, getApplicableTier, DEFAULT_PRICING_TIERS } from './pricing';

test('boundary test: 1 page tier evaluation (₹2.00 / page)', () => {
  const result = calculateOrderPrice(1, { copies: 1, color: 'bw', binding: 'none' });
  assert.equal(result.basePricePerPage, 2.00);
  assert.equal(result.totalAmount, 2.00);
});

test('boundary test: 10 pages tier evaluation (₹2.00 / page)', () => {
  const result = calculateOrderPrice(10, { copies: 1, color: 'bw', binding: 'none' });
  assert.equal(result.basePricePerPage, 2.00);
  assert.equal(result.totalAmount, 20.00);
});

test('boundary test: 11 pages tier evaluation (₹1.50 / page)', () => {
  const result = calculateOrderPrice(11, { copies: 1, color: 'bw', binding: 'none' });
  assert.equal(result.basePricePerPage, 1.50);
  assert.equal(result.totalAmount, 16.50);
});

test('boundary test: 50 pages tier evaluation (₹1.50 / page)', () => {
  const result = calculateOrderPrice(50, { copies: 1, color: 'bw', binding: 'none' });
  assert.equal(result.basePricePerPage, 1.50);
  assert.equal(result.totalAmount, 75.00);
});

test('boundary test: 51 pages tier evaluation (₹1.00 / page)', () => {
  const result = calculateOrderPrice(51, { copies: 1, color: 'bw', binding: 'none' });
  assert.equal(result.basePricePerPage, 1.00);
  assert.equal(result.totalAmount, 51.00);
});

test('boundary test: 75 pages tier evaluation (₹1.00 / page -> ₹75 total)', () => {
  const result = calculateOrderPrice(75, { copies: 1, color: 'bw', binding: 'none' });
  assert.equal(result.basePricePerPage, 1.00);
  assert.equal(result.totalAmount, 75.00);
});

test('boundary test: 100 pages tier evaluation (₹1.00 / page)', () => {
  const result = calculateOrderPrice(100, { copies: 1, color: 'bw', binding: 'none' });
  assert.equal(result.basePricePerPage, 1.00);
  assert.equal(result.totalAmount, 100.00);
});

test('boundary test: 101 pages tier evaluation (₹0.75 / page)', () => {
  const result = calculateOrderPrice(101, { copies: 1, color: 'bw', binding: 'none' });
  assert.equal(result.basePricePerPage, 0.75);
  assert.equal(result.totalAmount, 75.75);
});

test('copies and add-ons calculation: 20 pages, 2 copies, color, spiral binding', () => {
  const result = calculateOrderPrice(
    20,
    { copies: 2, color: 'color', binding: 'spiral' },
    DEFAULT_PRICING_TIERS,
    { colorSurchargePerPage: 8.00, spiralBindingCharge: 30.00 }
  );
  // Base: 20 pages * 1.50 * 2 = 60
  // Color: 20 pages * 8.00 * 2 = 320
  // Spiral binding: 30 * 2 = 60
  // Total = 440
  assert.equal(result.basePrintAmount, 60.00);
  assert.equal(result.colorSurcharge, 320.00);
  assert.equal(result.bindingCharge, 60.00);
  assert.equal(result.totalAmount, 440.00);
});
