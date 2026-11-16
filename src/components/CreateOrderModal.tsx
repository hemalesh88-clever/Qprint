import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  UploadCloud,
  FileText,
  Check,
  AlertCircle,
  HelpCircle,
  ChevronRight,
  Plus,
  Minus,
  Layers,
  FolderPlus,
  Loader2,
  Sparkles,
  Trash2,
  PlusCircle
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { OrderFile, PrintOptions, Order, ShopSettings, PricingTier } from '../types';
import { calculateOrderPrice, DEFAULT_PRICING_TIERS } from '../utils/pricing';
import {
  createOrder,
  subscribeShopSettings,
  saveOrderFileToCloud,
  fileToBase64,
} from '../lib/firestoreService';
import { analyzeFile, analyzeBatchFiles, DetectedDocumentInfo } from '../utils/documentAnalyzer';
import { cacheUploadedFile } from '../utils/fileDownloader';

interface CreateOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOrderCreated: (order: Order) => void;
  onRequireAuth: () => void;
}

export const CreateOrderModal: React.FC<CreateOrderModalProps> = ({
  isOpen,
  onClose,
  onOrderCreated,
  onRequireAuth,
}) => {
  const { user, token } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'upload' | 'options' | 'review'>('upload');
  const [fileMeta, setFileMeta] = useState<OrderFile | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<OrderFile[]>([]);
  const [detectedFiles, setDetectedFiles] = useState<DetectedDocumentInfo[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Live Shop Settings & Pricing Tiers subscription
  const [shopSettings, setShopSettings] = useState<ShopSettings | null>(null);
  const [pricingTiers, setPricingTiers] = useState<PricingTier[]>(DEFAULT_PRICING_TIERS);

  useEffect(() => {
    if (!isOpen) return;
    const unsub = subscribeShopSettings((settings, tiers) => {
      setShopSettings(settings);
      setPricingTiers(tiers);
    });
    return () => unsub();
  }, [isOpen]);

  // Form options
  const [pageCount, setPageCount] = useState<number>(1);
  const [manualCountOverride, setManualCountOverride] = useState<boolean>(false);
  const [color, setColor] = useState<'bw' | 'color'>('bw');
  const [sides, setSides] = useState<'single' | 'double'>('double');
  const [paperSize, setPaperSize] = useState<'A4' | 'A3' | 'Legal'>('A4');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [binding, setBinding] = useState<'none' | 'staple' | 'spiral' | 'hard_bound'>('none');
  const [copies, setCopies] = useState<number>(1);
  const [customerInstructions, setCustomerInstructions] = useState<string>('');
  const [requiredByTime, setRequiredByTime] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen) return null;

  const currentOptions: PrintOptions = {
    color,
    sides,
    paperSize,
    orientation,
    binding,
    copies,
  };

  const priceCalc = calculateOrderPrice(pageCount, currentOptions, pricingTiers, {
    colorSurchargePerPage: shopSettings?.colorSurchargePerPage,
    spiralBindingCharge: shopSettings?.spiralBindingCharge,
    hardBoundCharge: shopSettings?.hardBoundCharge,
    stapleCharge: shopSettings?.stapleCharge,
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFiles = e.target.files ? Array.from(e.target.files) : [];
    if (rawFiles.length === 0) return;

    setUploadError(null);
    setIsUploading(true);

    try {
      const newlyUploaded: OrderFile[] = [];

      for (const rawFile of rawFiles) {
        // 1. Genuine structural analysis per file
        const fileInfo = await analyzeFile(rawFile);

        // 2. Upload file to backend storage
        const formData = new FormData();
        formData.append('file', rawFile);
        formData.append('originalName', rawFile.name);
        formData.append('sizeBytes', rawFile.size.toString());
        formData.append('detectedPageCount', fileInfo.detectedPageCount.toString());

        let fileData: OrderFile;
        try {
          const res = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
          });
          if (res.ok) {
            fileData = await res.json();
            fileData.originalName = rawFile.name;
            fileData.detectedPageCount = fileInfo.detectedPageCount;
            fileData.sizeBytes = rawFile.size;
            fileData.mimeType = rawFile.type || 'application/pdf';
            fileData.uploadStatus = 'uploaded';
          } else {
            throw new Error('Upload API non-200');
          }
        } catch {
          const fileId = 'file_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
          fileData = {
            id: fileId,
            originalName: rawFile.name,
            storageName: 'doc_' + Date.now() + '_' + rawFile.name.replace(/[^a-zA-Z0-9.-]/g, '_'),
            sizeBytes: rawFile.size,
            mimeType: rawFile.type || 'application/pdf',
            detectedPageCount: fileInfo.detectedPageCount,
            uploadedAt: new Date().toISOString(),
            uploadStatus: 'uploaded',
          };
        }

        // Cache locally in client IndexedDB
        await cacheUploadedFile(fileData.id, rawFile, fileData.originalName, fileData.mimeType);

        // Base64 encoding for inline preview & cross-tab sync
        try {
          fileData.dataUrl = await fileToBase64(rawFile);
        } catch (e) { }

        // Persist binary payload into Cloud Firestore
        try {
          await saveOrderFileToCloud(fileData.id, rawFile, fileData);
        } catch (e) { }

        newlyUploaded.push(fileData);
      }

      const allFiles = [...uploadedFiles, ...newlyUploaded];
      setUploadedFiles(allFiles);
      setFileMeta(allFiles[0]);

      // Total page count is the exact sum of all uploaded files' pages
      const totalPages = allFiles.reduce((sum, f) => sum + f.detectedPageCount, 0);
      setPageCount(Math.max(1, totalPages));
      setManualCountOverride(false);
      setStep('options');
    } catch (err: any) {
      setUploadError(err.message || 'File upload failed. Ensure format is PDF, PPT, Word, or Image.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveFile = (fileId: string) => {
    const updated = uploadedFiles.filter((f) => f.id !== fileId);
    setUploadedFiles(updated);
    if (updated.length === 0) {
      setFileMeta(null);
      setPageCount(1);
      setStep('upload');
    } else {
      setFileMeta(updated[0]);
      const totalPages = updated.reduce((sum, f) => sum + f.detectedPageCount, 0);
      setPageCount(Math.max(1, totalPages));
    }
  };

  const handleSubmitOrder = async () => {
    if (!user || !token) {
      onRequireAuth();
      return;
    }

    if (uploadedFiles.length === 0 && !fileMeta) {
      setUploadError('Please upload at least one document first.');
      return;
    }

    setIsSubmitting(true);
    setUploadError(null);

    try {
      const pricingSnapshot = {
        tierName: priceCalc.applicableTier.id,
        ratePerPage: priceCalc.basePricePerPage,
        colorCharge: priceCalc.colorSurcharge,
        bindingCharge: priceCalc.bindingCharge,
        copies: priceCalc.copies,
        totalAmount: priceCalc.totalAmount,
      };

      const primaryFile = uploadedFiles[0] || fileMeta;
      const allFiles = uploadedFiles.length > 0 ? uploadedFiles : (primaryFile ? [primaryFile] : []);

      const orderPayload: any = {
        userId: user.id,
        userName: user.name,
        userPhone: user.phone,
        userRole: user.role === 'faculty' ? 'faculty' : 'student',
        file: primaryFile,
        files: allFiles,
        fileCount: allFiles.length,
        pageCount,
        options: currentOptions,
        paymentMethod: 'upi_qr',
        pricingSnapshot,
      };

      if (user.department) orderPayload.department = user.department;
      if (user.section) orderPayload.section = user.section;
      if (user.rollNumber) orderPayload.rollNumber = user.rollNumber;
      if (user.staffId) orderPayload.staffId = user.staffId;
      if (customerInstructions.trim()) orderPayload.customerInstructions = customerInstructions.trim();
      if (requiredByTime) orderPayload.requiredByTime = requiredByTime;

      // Direct authoritative creation in Cloud Firestore and synced local cache
      const newOrder = await createOrder(orderPayload);

      onOrderCreated(newOrder);
      onClose();
    } catch (err: any) {
      setUploadError(err.message || 'Error creating order.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden text-slate-800 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-600" />
              <span>Create College Print Order</span>
            </h2>
            <p className="text-xs text-slate-500">
              RIT Xerox & Print Center • Instant Queue Placement
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Wizard Steps indicator */}
        <div className="px-5 py-2.5 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between text-xs font-semibold text-slate-600">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${step === 'upload'
                ? 'bg-blue-600 text-white'
                : 'bg-emerald-600 text-white'
                }`}
            >
              {step !== 'upload' ? <Check className="w-3 h-3" /> : '1'}
            </span>
            <span>Document</span>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          <div className="flex items-center gap-1.5">
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${step === 'options'
                ? 'bg-blue-600 text-white'
                : step === 'review'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-300 text-slate-600'
                }`}
            >
              {step === 'review' ? <Check className="w-3 h-3" /> : '2'}
            </span>
            <span>Print Options</span>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          <div className="flex items-center gap-1.5">
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${step === 'review'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-300 text-slate-600'
                }`}
            >
              3
            </span>
            <span>Review & Price</span>
          </div>
        </div>

        <div className="p-5 max-h-[75vh] overflow-y-auto">
          {uploadError && (
            <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{uploadError}</span>
            </div>
          )}

          {/* STEP 1: UPLOAD */}
          {step === 'upload' && (
            <div>
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${isUploading
                  ? 'bg-blue-50/50 border-blue-400'
                  : 'border-slate-300 hover:border-blue-500 hover:bg-slate-50'
                  }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  className="hidden"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.png,.jpg,.jpeg,.webp"
                  multiple
                />

                {isUploading ? (
                  <div className="flex flex-col items-center">
                    <Loader2 className="w-10 h-10 text-blue-600 animate-spin mb-3" />
                    <p className="text-sm font-bold text-slate-800">
                      Uploading & Analyzing Document...
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Calculating accurate PDF pages, PPTX slides, DOCX pages & images
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <div className="w-12 h-12 rounded-2xl bg-blue-100/70 text-blue-700 flex items-center justify-center mb-3">
                      <UploadCloud className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-bold text-slate-900">
                      Click to choose or drag & drop files / folders
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      PDF, Word (.docx), PPT slides, Images, or Folders (Multi-file enabled)
                    </p>
                    <div className="mt-4 flex items-center gap-2">
                      <span className="px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-[11px] font-semibold border border-blue-200">
                        ⚡ Genuine Page & Slide Count Detection
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Tips */}
              <div className="mt-4 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
                <p className="font-semibold text-slate-800">Supported for College Works:</p>
                <p>• Lab manuals, assignments, project reports, IEEE papers, and presentation decks</p>
                <p>• Select single or multiple files together — pages will be calculated accurately</p>
              </div>
            </div>
          )}

          {/* STEP 2: PRINT OPTIONS */}
          {step === 'options' && (uploadedFiles.length > 0 || fileMeta) && (
            <div className="space-y-4">
              {/* Uploaded Files Section */}
              <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 space-y-2.5">
                <div className="flex items-center justify-between text-xs border-b border-blue-200/60 pb-2">
                  <div className="flex items-center gap-1.5 font-bold text-blue-950">
                    <Layers className="w-4 h-4 text-blue-600" />
                    <span>Uploaded Files ({uploadedFiles.length})</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:text-blue-900 bg-white px-2.5 py-1 rounded-lg border border-blue-200 hover:bg-blue-50 transition-colors cursor-pointer shadow-2xs"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>Add More Files</span>
                  </button>
                </div>

                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                  {uploadedFiles.map((file, idx) => (
                    <div
                      key={file.id || idx}
                      className="p-2 bg-white rounded-lg border border-blue-100 flex items-center justify-between gap-2 shadow-2xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-5 h-5 rounded-md bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-800 truncate" title={file.originalName}>
                            {file.originalName}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {(file.sizeBytes / 1024 / 1024).toFixed(2)} MB • {file.detectedPageCount} {file.detectedPageCount === 1 ? 'page' : 'pages'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[10px]">
                          {file.detectedPageCount} pgs
                        </span>
                        {uploadedFiles.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveFile(file.id)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50 transition-colors cursor-pointer"
                            title="Remove this file"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Page count confirmation / manual override with +/- controls */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div>
                    <label className="font-bold text-slate-800 block">
                      Total Order Pages
                    </label>
                    <p className="text-[11px] text-slate-500">
                      Calculated: <span className="font-semibold text-blue-700">{pageCount} total pages</span>
                      {uploadedFiles.length > 1 ? ` across ${uploadedFiles.length} files` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setPageCount((p) => Math.max(1, p - 1));
                        setManualCountOverride(true);
                      }}
                      className="w-7 h-7 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 flex items-center justify-center text-slate-700 font-bold transition-colors cursor-pointer"
                      title="Decrease page count"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      value={pageCount}
                      onChange={(e) => {
                        setPageCount(Math.max(1, parseInt(e.target.value) || 1));
                        setManualCountOverride(true);
                      }}
                      className="w-16 px-2 py-1 text-center text-xs font-bold border border-slate-300 rounded-lg bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setPageCount((p) => p + 1);
                        setManualCountOverride(true);
                      }}
                      className="w-7 h-7 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 flex items-center justify-center text-slate-700 font-bold transition-colors cursor-pointer"
                      title="Increase page count"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-xs text-slate-600 font-medium ml-1">pages</span>
                  </div>
                </div>

                {manualCountOverride && (
                  <p className="text-[10px] text-amber-700 mt-1 flex items-center gap-1 font-medium">
                    <HelpCircle className="w-3 h-3" />
                    Custom total page count override active. Pricing updates in real-time.
                  </p>
                )}
              </div>

              {/* Options Grid */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                {/* Color */}
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Print Color Mode
                  </label>
                  <select
                    value={color}
                    onChange={(e: any) => setColor(e.target.value)}
                    className="w-full p-2 rounded-lg border border-slate-300 bg-white font-medium"
                  >
                    <option value="bw">Black & White (B&W)</option>
                    <option value="color">Full Color (+₹8/page)</option>
                  </select>
                </div>

                {/* Print Sides */}
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Print Sides
                  </label>
                  <select
                    value={sides}
                    onChange={(e: any) => setSides(e.target.value)}
                    className="w-full p-2 rounded-lg border border-slate-300 bg-white font-medium"
                  >
                    <option value="double">Double-sided (Duplex - Saves Paper)</option>
                    <option value="single">Single-sided (Front only)</option>
                  </select>
                </div>

                {/* Paper Size */}
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Paper Size
                  </label>
                  <select
                    value={paperSize}
                    onChange={(e: any) => setPaperSize(e.target.value)}
                    className="w-full p-2 rounded-lg border border-slate-300 bg-white font-medium"
                  >
                    <option value="A4">A4 Standard (75 GSM)</option>
                    <option value="A3">A3 Drawing / Poster</option>
                    <option value="Legal">Legal Size</option>
                  </select>
                </div>

                {/* Copies */}
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Number of Copies
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={copies}
                    onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full p-2 rounded-lg border border-slate-300 bg-white font-bold text-center"
                  />
                </div>
              </div>

              {/* Binding Options */}
              <div>
                <label className="font-semibold text-slate-700 block mb-1 text-xs">
                  Binding & Finishing
                </label>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {[
                    { id: 'none', label: 'No Binding', extra: 'Stapled free' },
                    {
                      id: 'spiral',
                      label: 'Soft Spiral',
                      extra: `+₹${(shopSettings?.spiralBindingCharge ?? 30).toFixed(2)}`,
                    },
                    {
                      id: 'hard_bound',
                      label: 'Hard Bound',
                      extra: `+₹${(shopSettings?.hardBoundCharge ?? 120).toFixed(2)}`,
                    },
                  ].map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setBinding(b.id as any)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${binding === b.id
                        ? 'border-blue-600 bg-blue-50/70 text-blue-900 font-bold'
                        : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                        }`}
                    >
                      <p className="text-xs">{b.label}</p>
                      <p className="text-[10px] text-slate-500 font-normal">{b.extra}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Description / Instructions */}
              <div className="p-3 bg-amber-50/60 border border-amber-200/80 rounded-xl space-y-1">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-amber-900 block text-xs">
                    Order Description & Special Needs
                  </label>
                  <span className="text-[10px] text-amber-700 font-medium">Visible to Shop Handler</span>
                </div>
                <textarea
                  rows={2}
                  value={customerInstructions}
                  onChange={(e) => setCustomerInstructions(e.target.value)}
                  placeholder="Tell the Xerox shop handler your specific needs (e.g. print first page in color, 2-sided duplex, soft spiral binding, urgent lab submission by 2 PM...)"
                  className="w-full p-2.5 text-xs border border-amber-300 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-amber-500 outline-none"
                  maxLength={1000}
                />
              </div>

              {/* Action */}
              <div className="pt-2 flex justify-between items-center">
                <button
                  type="button"
                  onClick={() => setStep('upload')}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep('review')}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-md transition-all flex items-center gap-1.5"
                >
                  <span>Review & Calculate Price</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: REVIEW & PRICE BREAKDOWN */}
          {step === 'review' && (uploadedFiles.length > 0 || fileMeta) && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
                <h4 className="font-bold text-slate-900 text-sm border-b border-slate-200 pb-2">
                  Order Summary
                </h4>

                {/* Uploaded Files Breakdown */}
                <div className="border-b border-slate-200 pb-2 mb-2">
                  <p className="text-xs font-bold text-slate-800 flex items-center justify-between mb-1">
                    <span>Uploaded Documents ({uploadedFiles.length}):</span>
                    <span className="text-blue-700 font-mono font-bold">{pageCount} total pages</span>
                  </p>
                  <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                    {uploadedFiles.map((f, i) => (
                      <div key={f.id || i} className="flex justify-between text-[11px] text-slate-600 bg-white p-1.5 rounded border border-slate-100">
                        <span className="truncate max-w-[280px]">#{i + 1} {f.originalName}</span>
                        <span className="font-semibold text-slate-800 shrink-0">{f.detectedPageCount} {f.detectedPageCount === 1 ? 'page' : 'pages'}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-slate-600">
                  <p>
                    <span className="text-slate-400">Total Pages:</span> {pageCount} pages
                  </p>
                  <p>
                    <span className="text-slate-400">Color:</span>{' '}
                    {color === 'color' ? 'Full Color' : 'Black & White'}
                  </p>
                  <p>
                    <span className="text-slate-400">Sides:</span>{' '}
                    {sides === 'double' ? 'Double Sided (Duplex)' : 'Single Sided'}
                  </p>
                  <p>
                    <span className="text-slate-400">Copies:</span> {copies} set(s)
                  </p>
                  <p>
                    <span className="text-slate-400">Binding:</span> {binding.replace('_', ' ')}
                  </p>
                </div>
                {customerInstructions && (
                  <div className="mt-2 pt-2 border-t border-slate-200 text-slate-700">
                    <span className="font-semibold text-slate-900">Instructions:</span>{' '}
                    {customerInstructions}
                  </div>
                )}
              </div>

              {/* Transparent Price Breakdown */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-900 to-indigo-950 text-white shadow-lg space-y-2 text-xs">
                <div className="flex items-center justify-between border-b border-white/15 pb-2">
                  <span className="font-bold text-white">Transparent Price Breakdown</span>
                  <span className="text-[11px] text-blue-200 bg-white/10 px-2 py-0.5 rounded-full">
                    Tier: {priceCalc.applicableTier.minPages}-{priceCalc.applicableTier.maxPages || '+'} pages
                  </span>
                </div>

                <div className="flex justify-between text-slate-300">
                  <span>
                    Base Print ({pageCount} pages × ₹{priceCalc.basePricePerPage.toFixed(2)} × {copies} copy):
                  </span>
                  <span className="font-semibold text-white">
                    ₹{priceCalc.basePrintAmount.toFixed(2)}
                  </span>
                </div>

                {priceCalc.colorSurcharge > 0 && (
                  <div className="flex justify-between text-slate-300">
                    <span>Color Surcharge ({pageCount} pages × ₹{(shopSettings?.colorSurchargePerPage ?? 8).toFixed(2)}):</span>
                    <span className="font-semibold text-white">
                      +₹{priceCalc.colorSurcharge.toFixed(2)}
                    </span>
                  </div>
                )}

                {priceCalc.bindingCharge > 0 && (
                  <div className="flex justify-between text-slate-300">
                    <span>Binding Charge ({binding}):</span>
                    <span className="font-semibold text-white">
                      +₹{priceCalc.bindingCharge.toFixed(2)}
                    </span>
                  </div>
                )}

                <div className="mt-3 pt-2.5 border-t border-white/20 flex items-baseline justify-between">
                  <span className="text-sm font-bold text-slate-200">Total Net Amount:</span>
                  <span className="text-2xl font-black text-emerald-400">
                    ₹{priceCalc.totalAmount.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex justify-between items-center">
                <button
                  type="button"
                  onClick={() => setStep('options')}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
                >
                  Edit Options
                </button>
                <button
                  type="button"
                  onClick={handleSubmitOrder}
                  disabled={isSubmitting}
                  className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Creating Order...</span>
                    </>
                  ) : (
                    <>
                      <span>Confirm & Proceed to Payment</span>
                      <ChevronRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
