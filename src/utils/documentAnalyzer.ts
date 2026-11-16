/**
 * Qprint Document Analyzer
 * Client-side accurate page count and metadata detection for:
 * - PDF documents (.pdf)
 * - PowerPoint presentations (.pptx, .ppt)
 * - Microsoft Word documents (.docx, .doc)
 * - Image files (.png, .jpg, .jpeg, .webp, .bmp, .svg)
 * - Text/code/data files (.txt, .csv, .md, .json, etc.)
 * - Multiple files & folder uploads (batches)
 */

export interface DetectedDocumentInfo {
  originalName: string;
  sizeBytes: number;
  mimeType: string;
  detectedPageCount: number;
  formatDescription: string;
}

export interface BatchAnalysisResult {
  files: DetectedDocumentInfo[];
  totalPageCount: number;
  totalSizeBytes: number;
  combinedDisplayName: string;
}

/**
 * Detects accurate page count from a PDF file by inspecting binary page tree objects.
 */
export async function detectPdfPageCount(file: File): Promise<number> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const text = new TextDecoder('latin1').decode(bytes);

    // Method 1: Count of /Type /Page (excluding /Pages)
    const pageMatches = text.match(/\/Type\s*\/Page\b/g);
    const pageCount1 = pageMatches ? pageMatches.length : 0;

    // Method 2: Look for root /Count in /Pages catalog
    const countMatches = [...text.matchAll(/\/Count\s+(\d+)/g)]
      .map((m) => parseInt(m[1], 10))
      .filter((n) => !isNaN(n) && n > 0);
    const pageCount2 = countMatches.length > 0 ? Math.max(...countMatches) : 0;

    if (pageCount1 > 0 && pageCount2 > 0) {
      return Math.max(pageCount1, pageCount2);
    }
    if (pageCount1 > 0) return pageCount1;
    if (pageCount2 > 0) return pageCount2;
  } catch (err) {
    console.warn('PDF page detection fallback notice:', err);
  }
  return 1;
}

/**
 * Detects accurate slide count from a PowerPoint presentation (.pptx, .ppt).
 */
export async function detectPptPageCount(file: File, ext: string): Promise<number> {
  if (ext === 'pptx') {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const text = new TextDecoder('latin1').decode(bytes);

      // Method 1: Count unique slide XML entries in the ZIP package
      const slideMatches = text.match(/ppt\/slides\/slide\d+\.xml/g);
      if (slideMatches && slideMatches.length > 0) {
        return new Set(slideMatches).size;
      }

      // Method 2: Extract from <Slides>N</Slides> metadata in docProps/app.xml
      const tagMatch = text.match(/<Slides>(\d+)<\/Slides>/i);
      if (tagMatch && tagMatch[1]) {
        const count = parseInt(tagMatch[1], 10);
        if (count > 0) return count;
      }
    } catch (err) {
      console.warn('PPTX slide detection notice:', err);
    }
  }

  // Legacy .ppt binary fallback: estimate roughly 1 slide per ~50KB
  return Math.max(1, Math.ceil(file.size / 50000));
}

/**
 * Detects accurate page count from a Microsoft Word document (.docx, .doc).
 */
export async function detectDocPageCount(file: File, ext: string): Promise<number> {
  if (ext === 'docx') {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const text = new TextDecoder('latin1').decode(bytes);

      // Check <Pages>N</Pages> in docProps/app.xml
      const pageMatch = text.match(/<Pages>(\d+)<\/Pages>/i);
      if (pageMatch && pageMatch[1]) {
        const count = parseInt(pageMatch[1], 10);
        if (count > 0) return count;
      }

      // Check <Words>N</Words> and estimate ~450 words per standard page
      const wordMatch = text.match(/<Words>(\d+)<\/Words>/i);
      if (wordMatch && wordMatch[1]) {
        const words = parseInt(wordMatch[1], 10);
        if (words > 0) return Math.max(1, Math.ceil(words / 450));
      }
    } catch (err) {
      console.warn('DOCX page detection notice:', err);
    }
  }

  // Legacy .doc binary fallback: estimate roughly 1 page per ~30KB
  return Math.max(1, Math.ceil(file.size / 30000));
}

/**
 * Detects page count for text/source files based on standard lines per page (~50 lines/page).
 */
export async function detectTextPageCount(file: File): Promise<number> {
  try {
    const text = await file.text();
    const lines = text.split('\n').length;
    return Math.max(1, Math.ceil(lines / 50));
  } catch {
    return 1;
  }
}

/**
 * Analyzes a single file and determines its actual page count.
 */
export async function analyzeFile(file: File): Promise<DetectedDocumentInfo> {
  const name = file.name;
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const size = file.size;

  let pageCount = 1;
  let formatDesc = 'Document';

  if (ext === 'pdf' || file.type === 'application/pdf') {
    formatDesc = 'PDF Document';
    pageCount = await detectPdfPageCount(file);
  } else if (
    ext === 'pptx' ||
    ext === 'ppt' ||
    file.type.includes('presentation') ||
    file.type.includes('powerpoint')
  ) {
    formatDesc = ext === 'pptx' ? 'PowerPoint Presentation' : 'Legacy PPT Slide Deck';
    pageCount = await detectPptPageCount(file, ext);
  } else if (
    ext === 'docx' ||
    ext === 'doc' ||
    file.type.includes('word') ||
    file.type.includes('document')
  ) {
    formatDesc = ext === 'docx' ? 'Word Document' : 'Legacy Word Document';
    pageCount = await detectDocPageCount(file, ext);
  } else if (
    ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'svg', 'gif'].includes(ext) ||
    file.type.startsWith('image/')
  ) {
    formatDesc = 'Single Page Image';
    pageCount = 1;
  } else if (
    ['txt', 'csv', 'md', 'json', 'py', 'c', 'cpp', 'java'].includes(ext) ||
    file.type.startsWith('text/')
  ) {
    formatDesc = 'Text Document';
    pageCount = await detectTextPageCount(file);
  } else {
    formatDesc = `${ext.toUpperCase()} File`;
    pageCount = Math.max(1, Math.ceil(size / 50000));
  }

  return {
    originalName: name,
    sizeBytes: size,
    mimeType: file.type || 'application/octet-stream',
    detectedPageCount: Math.max(1, pageCount),
    formatDescription: formatDesc,
  };
}

/**
 * Analyzes a collection of files (e.g. from multi-file selection or folder upload).
 */
export async function analyzeBatchFiles(files: File[]): Promise<BatchAnalysisResult> {
  if (files.length === 0) {
    return {
      files: [],
      totalPageCount: 1,
      totalSizeBytes: 0,
      combinedDisplayName: 'No file selected',
    };
  }

  const results: DetectedDocumentInfo[] = [];
  let totalPages = 0;
  let totalBytes = 0;

  for (const file of files) {
    const info = await analyzeFile(file);
    results.push(info);
    totalPages += info.detectedPageCount;
    totalBytes += info.sizeBytes;
  }

  let combinedName = files[0].name;
  if (files.length > 1) {
    combinedName = `${files[0].name} + ${files.length - 1} other file${files.length > 2 ? 's' : ''}`;
  }

  return {
    files: results,
    totalPageCount: Math.max(1, totalPages),
    totalSizeBytes: totalBytes,
    combinedDisplayName: combinedName,
  };
}
