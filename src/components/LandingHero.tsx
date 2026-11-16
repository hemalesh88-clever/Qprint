import React, { useState, useEffect } from 'react';
import {
  UploadCloud,
  QrCode,
  Compass,
  Printer,
  PackageCheck,
  ChevronRight,
  Sparkles,
  ShieldCheck,
  Calculator,
  Clock,
  ArrowRight,
  FileText,
  CreditCard,
  Building2,
  GraduationCap
} from 'lucide-react';
import { ShopSettings, PricingTier } from '../types';
import { subscribeShopSettings } from '../lib/firestoreService';
import { DEFAULT_PRICING_TIERS, calculateOrderPrice } from '../utils/pricing';

interface LandingHeroProps {
  onOpenCreateOrder: () => void;
  onOpenAuth: (tab: 'student_login' | 'faculty_login' | 'handler_login') => void;
  onOpenTrackModal: () => void;
}

export const LandingHero: React.FC<LandingHeroProps> = ({
  onOpenCreateOrder,
  onOpenAuth,
  onOpenTrackModal,
}) => {
  const [calcPages, setCalcPages] = useState<number>(25);
  const [calcColor, setCalcColor] = useState<'bw' | 'color'>('bw');
  const [calcBinding, setCalcBinding] = useState<'none' | 'spiral' | 'hard_bound'>('none');

  // Live Shop Settings & Pricing Tiers subscription
  const [shopSettings, setShopSettings] = useState<ShopSettings | null>(null);
  const [pricingTiers, setPricingTiers] = useState<PricingTier[]>(DEFAULT_PRICING_TIERS);

  useEffect(() => {
    const unsub = subscribeShopSettings((settings, tiers) => {
      setShopSettings(settings);
      if (tiers && tiers.length > 0) {
        setPricingTiers(tiers);
      }
    });
    return () => unsub();
  }, []);

  const estimate = calculateOrderPrice(
    calcPages,
    {
      color: calcColor,
      binding: calcBinding,
      copies: 1,
    },
    pricingTiers,
    {
      colorSurchargePerPage: shopSettings?.colorSurchargePerPage,
      spiralBindingCharge: shopSettings?.spiralBindingCharge,
      hardBoundCharge: shopSettings?.hardBoundCharge,
      stapleCharge: shopSettings?.stapleCharge,
    }
  );

  return (
    <div className="relative overflow-hidden bg-gradient-to-b from-slate-50 via-white to-slate-100/60 pb-16">
      {/* Decorative gradient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-96 bg-gradient-to-tr from-blue-100/40 via-indigo-100/30 to-sky-100/40 blur-3xl pointer-events-none -z-10" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 sm:pt-14">
        {/* Hero Header */}
        <div className="text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-200/80 text-blue-700 text-xs font-semibold shadow-xs mb-5">
            <Sparkles className="w-3.5 h-3.5 text-blue-600" />
            <span>Smart College Xerox & Printing Automation</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-slate-900 leading-tight">
            Stop waiting in long xerox queues.
            <span className="block mt-1 text-transparent bg-clip-text bg-gradient-to-r from-blue-700 via-indigo-600 to-sky-600">
              Qprint handles it all.
            </span>
          </h1>

          <p className="mt-4 text-base sm:text-lg text-slate-600 font-normal leading-relaxed">
            The official real-time printing management platform for campus students and faculty.
            Direct from your phone or laptop.
          </p>

          <p className="mt-2 text-xs sm:text-sm font-bold text-slate-700 tracking-wider uppercase">
            Upload. Pay. Track. Print. Collect.
          </p>

          {/* Quick CTA Actions */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={onOpenCreateOrder}
              className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shadow-lg shadow-blue-500/25 transition-all hover:-translate-y-0.5 active:translate-y-0 flex items-center gap-2"
            >
              <UploadCloud className="w-4 h-4" />
              <span>Create Print Order</span>
              <ArrowRight className="w-4 h-4 ml-1" />
            </button>

            <button
              onClick={onOpenTrackModal}
              className="px-5 py-3 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-semibold text-sm shadow-xs transition-colors flex items-center gap-2"
            >
              <Clock className="w-4 h-4 text-slate-500" />
              <span>Track Order Status</span>
            </button>
          </div>

          {/* Quick Portal Switcher */}
          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-500">
            <span>Fast Sign In:</span>
            <button
              onClick={() => onOpenAuth('student_login')}
              className="font-semibold text-blue-600 hover:text-blue-800 underline underline-offset-4"
            >
              Student Portal
            </button>
            <span>•</span>
            <button
              onClick={() => onOpenAuth('faculty_login')}
              className="font-semibold text-indigo-600 hover:text-indigo-800 underline underline-offset-4"
            >
              Faculty Portal
            </button>
            <span>•</span>
            <button
              onClick={() => onOpenAuth('handler_login')}
              className="font-semibold text-purple-600 hover:text-purple-800 underline underline-offset-4"
            >
              Shop Handler
            </button>
          </div>
        </div>

        {/* 5-Step Process Timeline Cards */}
        <div className="mt-14 max-w-5xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              {
                step: '01',
                title: 'Upload',
                desc: 'PDF, Word, PPT or Image files',
                icon: UploadCloud,
                color: 'text-blue-600 bg-blue-50 border-blue-200/80',
              },
              {
                step: '02',
                title: 'Pay',
                desc: 'UPI QR scan or Razorpay online',
                icon: QrCode,
                color: 'text-emerald-600 bg-emerald-50 border-emerald-200/80',
              },
              {
                step: '03',
                title: 'Track',
                desc: 'Live FIFO position & countdown',
                icon: Compass,
                color: 'text-amber-600 bg-amber-50 border-amber-200/80',
              },
              {
                step: '04',
                title: 'Print',
                desc: 'Shop executes your exact options',
                icon: Printer,
                color: 'text-indigo-600 bg-indigo-50 border-indigo-200/80',
              },
              {
                step: '05',
                title: 'Collect',
                desc: 'Pickup notification when ready',
                icon: PackageCheck,
                color: 'text-sky-600 bg-sky-50 border-sky-200/80',
              },
            ].map((s, idx) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.step}
                  className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs hover:border-slate-300 transition-all text-left relative"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-black text-slate-400">
                      STEP {s.step}
                    </span>
                    <div className={`p-1.5 rounded-lg border ${s.color}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                  </div>
                  <h3 className="text-sm font-bold text-slate-900">{s.title}</h3>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    {s.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Pricing Tiers & Calculator Section */}
        <div className="mt-14 max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
          {/* Official College Rate Card */}
          <div className="md:col-span-7 bg-white rounded-2xl p-6 border border-slate-200 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Standard College Pricing Tiers
                </h3>
                <p className="text-xs text-slate-500">
                  Approved bulk discounts for all college students & faculty
                </p>
              </div>
              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                Official Rates
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 font-semibold uppercase text-[10px]">
                    <th className="py-2.5 px-3">Page Count Bracket</th>
                    <th className="py-2.5 px-3">Price Per Page</th>
                    <th className="py-2.5 px-3">Example Order</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                  {pricingTiers.map((tier) => {
                    const bracketLabel = tier.maxPages
                      ? `${tier.minPages} – ${tier.maxPages} pages`
                      : `${tier.minPages}+ pages`;

                    // Generate a realistic sample page count in this bracket for the example order
                    const examplePages = !tier.maxPages
                      ? Math.max(tier.minPages + 50, tier.minPages * 2)
                      : tier.maxPages <= 10
                      ? Math.min(5, tier.maxPages)
                      : Math.round(tier.minPages + (tier.maxPages - tier.minPages) * 0.45);
                    const exampleCost = (examplePages * tier.pricePerPage).toFixed(2);

                    return (
                      <tr key={tier.id} className="hover:bg-slate-50/50">
                        <td className="py-3 px-3 font-semibold text-slate-900">{bracketLabel}</td>
                        <td className="py-3 px-3 text-blue-700 font-bold">
                          ₹{tier.pricePerPage.toFixed(2)} / page
                        </td>
                        <td className="py-3 px-3 text-slate-500">
                          {examplePages} pages = ₹{exampleCost}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs text-slate-500 gap-2">
              <span>Color print: +₹{(shopSettings?.colorSurchargePerPage ?? 8).toFixed(2)}/page</span>
              <span>•</span>
              <span>Soft Spiral: +₹{(shopSettings?.spiralBindingCharge ?? 30).toFixed(2)}</span>
              <span>•</span>
              <span>Hard Bound: +₹{(shopSettings?.hardBoundCharge ?? 120).toFixed(2)}</span>
            </div>
          </div>

          {/* Interactive Calculator Box */}
          <div className="md:col-span-5 bg-gradient-to-br from-slate-900 to-indigo-950 text-white rounded-2xl p-6 shadow-xl">
            <div className="flex items-center gap-2 mb-4">
              <Calculator className="w-4 h-4 text-blue-400" />
              <h3 className="text-sm font-bold text-white tracking-wide">
                Instant Price Calculator
              </h3>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <div className="flex justify-between text-slate-300 font-medium mb-1">
                  <span>Number of Pages:</span>
                  <span className="font-bold text-white text-sm">{calcPages}</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="150"
                  value={calcPages}
                  onChange={(e) => setCalcPages(Number(e.target.value))}
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Print Color</label>
                  <select
                    value={calcColor}
                    onChange={(e: any) => setCalcColor(e.target.value)}
                    className="w-full bg-slate-800 text-white rounded-lg p-2 border border-slate-700 text-xs focus:ring-1 focus:ring-blue-400"
                  >
                    <option value="bw">Black & White (B&W)</option>
                    <option value="color">
                      Full Color (+₹{(shopSettings?.colorSurchargePerPage ?? 8).toFixed(2)}/page)
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Binding</label>
                  <select
                    value={calcBinding}
                    onChange={(e: any) => setCalcBinding(e.target.value)}
                    className="w-full bg-slate-800 text-white rounded-lg p-2 border border-slate-700 text-xs focus:ring-1 focus:ring-blue-400"
                  >
                    <option value="none">No Binding (Loose/Staple)</option>
                    <option value="spiral">
                      Spiral Binding (+₹{(shopSettings?.spiralBindingCharge ?? 30).toFixed(2)})
                    </option>
                    <option value="hard_bound">
                      Hard Bound Project (+₹{(shopSettings?.hardBoundCharge ?? 120).toFixed(2)})
                    </option>
                  </select>
                </div>
              </div>

              {/* Estimate Output Card */}
              <div className="mt-4 p-4 rounded-xl bg-white/10 backdrop-blur-sm border border-white/10">
                <div className="flex items-baseline justify-between">
                  <span className="text-slate-300">Estimated Total:</span>
                  <span className="text-2xl font-black text-emerald-400">
                    ₹{estimate.totalAmount.toFixed(2)}
                  </span>
                </div>
                <div className="mt-2 text-[11px] text-slate-400 flex items-center justify-between border-t border-white/10 pt-2">
                  <span>Rate: ₹{estimate.basePricePerPage.toFixed(2)}/page</span>
                  <span>{estimate.applicableTier.minPages}-{estimate.applicableTier.maxPages || '+'} tier</span>
                </div>
              </div>

              <button
                onClick={onOpenCreateOrder}
                className="w-full py-2.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-bold text-xs shadow-md transition-colors flex items-center justify-center gap-1.5"
              >
                <span>Print This Now</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
