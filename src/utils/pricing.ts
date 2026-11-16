import { PricingTier, PrintOptions, PriceCalculation } from '../types';

export const DEFAULT_PRICING_TIERS: PricingTier[] = [
  { id: 'tier_1', minPages: 1, maxPages: 10, pricePerPage: 2.00 },
  { id: 'tier_2', minPages: 11, maxPages: 50, pricePerPage: 1.50 },
  { id: 'tier_3', minPages: 51, maxPages: 100, pricePerPage: 1.00 },
  { id: 'tier_4', minPages: 101, maxPages: null, pricePerPage: 0.75 },
];

export interface AddonRates {
  colorSurchargePerPage?: number; // e.g. 8.00 per page
  spiralBindingCharge?: number; // e.g. 30.00
  hardBoundCharge?: number; // e.g. 120.00
  stapleCharge?: number; // e.g. 5.00
}

/**
 * Finds the applicable tier for a given total page count.
 */
export function getApplicableTier(pageCount: number, tiers: PricingTier[] = DEFAULT_PRICING_TIERS): PricingTier {
  const safeCount = Math.max(1, Math.floor(pageCount));
  const sortedTiers = [...tiers].sort((a, b) => a.minPages - b.minPages);

  for (const tier of sortedTiers) {
    if (tier.maxPages === null) {
      if (safeCount >= tier.minPages) return tier;
    } else {
      if (safeCount >= tier.minPages && safeCount <= tier.maxPages) return tier;
    }
  }

  // Fallback to highest tier if above max or first tier if below min
  return sortedTiers[sortedTiers.length - 1] || DEFAULT_PRICING_TIERS[0];
}

/**
 * Authoritative price calculation using integer paise math to avoid IEEE-754 floating point issues.
 */
export function calculateOrderPrice(
  pageCount: number,
  options: Partial<PrintOptions> = {},
  tiers: PricingTier[] = DEFAULT_PRICING_TIERS,
  addonRates: AddonRates = {}
): PriceCalculation {
  const safePageCount = Math.max(1, Math.floor(pageCount || 1));
  const safeCopies = Math.max(1, Math.floor(options.copies || 1));
  const tier = getApplicableTier(safePageCount, tiers);

  // Convert Rupees to paise (1 Rupee = 100 Paise)
  const rateInPaise = Math.round(tier.pricePerPage * 100);
  const basePrintAmountPaise = safePageCount * rateInPaise * safeCopies;

  let colorSurchargePaise = 0;
  if (options.color === 'color') {
    const colorRatePaise = Math.round((addonRates.colorSurchargePerPage ?? 8.00) * 100);
    colorSurchargePaise = safePageCount * colorRatePaise * safeCopies;
  }

  let bindingChargePaise = 0;
  if (options.binding === 'spiral') {
    bindingChargePaise = Math.round((addonRates.spiralBindingCharge ?? 30.00) * 100) * safeCopies;
  } else if (options.binding === 'hard_bound') {
    bindingChargePaise = Math.round((addonRates.hardBoundCharge ?? 120.00) * 100) * safeCopies;
  } else if (options.binding === 'staple') {
    bindingChargePaise = Math.round((addonRates.stapleCharge ?? 5.00) * 100) * safeCopies;
  }

  const totalPaise = basePrintAmountPaise + colorSurchargePaise + bindingChargePaise;

  return {
    pageCount: safePageCount,
    copies: safeCopies,
    applicableTier: tier,
    basePricePerPage: tier.pricePerPage,
    basePrintAmount: basePrintAmountPaise / 100,
    colorSurcharge: colorSurchargePaise / 100,
    bindingCharge: bindingChargePaise / 100,
    totalAmount: totalPaise / 100,
  };
}
