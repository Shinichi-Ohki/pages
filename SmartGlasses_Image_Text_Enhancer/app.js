// Constants
const OUTPUT_WIDTH = 624;
const OUTPUT_HEIGHT = 405;
const UPSCALE_FACTOR = 2;

// DOM Elements
const imageInput = document.getElementById('image-input');
const previewSection = document.getElementById('preview-section');
const progressSection = document.getElementById('progress-section');
const actionSection = document.getElementById('action-section');
const originalCanvas = document.getElementById('original-canvas');
const outputCanvas = document.getElementById('output-canvas');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const processBtn = document.getElementById('process-btn');
const downloadBtn = document.getElementById('download-btn');
const shareBtn = document.getElementById('share-btn');
const skipStartSlider = document.getElementById('skip-start');
const skipEndSlider = document.getElementById('skip-end');
const linesPerPageSlider = document.getElementById('lines-per-page');
const skipStartValue = document.getElementById('skip-start-value');
const skipEndValue = document.getElementById('skip-end-value');
const linesPerPageValue = document.getElementById('lines-per-page-value');

// State
let originalImage = null;
let worker = null;
let outputCanvases = []; // Multiple output canvases

// Initialize
function init() {
  imageInput.addEventListener('change', handleImageSelect);
  processBtn.addEventListener('click', processImage);
  downloadBtn.addEventListener('click', downloadImage);
  shareBtn.addEventListener('click', shareImage);

  // Slider event listeners
  skipStartSlider.addEventListener('input', () => {
    skipStartValue.textContent = `${skipStartSlider.value}行`;
  });
  skipEndSlider.addEventListener('input', () => {
    skipEndValue.textContent = `${skipEndSlider.value}行`;
  });
  linesPerPageSlider.addEventListener('input', () => {
    linesPerPageValue.textContent = `${linesPerPageSlider.value}行`;
  });
}

// Handle image selection
function handleImageSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      originalImage = img;
      drawOriginalImage(img);
      showPreview();
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

// Draw original image to canvas (full size)
function drawOriginalImage(img) {
  const ctx = originalCanvas.getContext('2d');
  originalCanvas.width = img.width;
  originalCanvas.height = img.height;
  ctx.drawImage(img, 0, 0, img.width, img.height);
}

// Show preview section
function showPreview() {
  previewSection.classList.remove('hidden');
  actionSection.classList.remove('hidden');
}

// Process image with Tesseract.js
async function processImage() {
  if (!originalImage) return;

  processBtn.disabled = true;
  progressSection.classList.remove('hidden');
  updateProgress(0, 'Tesseract.js を初期化中...');

  try {
    worker = await Tesseract.createWorker('jpn', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          updateProgress(m.progress * 100, 'テキストを認識中...');
        } else if (m.status === 'loading language traineddata') {
          updateProgress(30, '日本語モデルを読み込み中...');
        }
      },
    });

    updateProgress(50, 'テキストを認識中...');
    const { data } = await worker.recognize(originalImage);
    updateProgress(80, '画像を生成中...');

    drawEnhancedImage(data);
    updateProgress(100, '完了！');
    downloadBtn.disabled = false;

  } catch (error) {
    console.error('Processing error:', error);
    updateProgress(0, 'エラー: ' + error.message);
  } finally {
    if (worker) {
      await worker.terminate();
      worker = null;
    }
    processBtn.disabled = false;
  }
}

// Draw enhanced image (multiple pages)
function drawEnhancedImage(ocrData) {
  // Clear previous output canvases
  outputCanvases = [];

  // Pre-scale original image for better quality
  const upscaledImage = upscaleImage(originalImage, UPSCALE_FACTOR);

  if (!ocrData.lines || ocrData.lines.length === 0) {
    const canvas = createOutputCanvas();
    const ctx = canvas.getContext('2d');
    drawScaledImage(ctx, upscaledImage);
    outputCanvases.push(canvas);
    displayOutputCanvases();
    return;
  }

  // Extract and filter lines (scale coordinates by UPSCALE_FACTOR)
  let lines = ocrData.lines
    .filter(line => line.words && line.words.length > 0)
    .map(line => ({
      text: line.text.trim(),
      x: line.bbox.x0 * UPSCALE_FACTOR,
      y: line.bbox.y0 * UPSCALE_FACTOR,
      width: (line.bbox.x1 - line.bbox.x0) * UPSCALE_FACTOR,
      height: (line.bbox.y1 - line.bbox.y0) * UPSCALE_FACTOR,
      confidence: line.confidence
    }))
    .filter(line => line.text.length > 0 && line.confidence > 20)
    .sort((a, b) => a.y - b.y);

  if (lines.length === 0) {
    const canvas = createOutputCanvas();
    const ctx = canvas.getContext('2d');
    drawScaledImage(ctx, upscaledImage);
    outputCanvases.push(canvas);
    displayOutputCanvases();
    return;
  }

  // Merge overlapping lines
  lines = mergeOverlappingLines(lines, 5 * UPSCALE_FACTOR);

  // Skip lines based on slider settings (before merging short lines)
  const skipStart = parseInt(skipStartSlider.value);
  const skipEnd = parseInt(skipEndSlider.value);
  lines = lines.slice(skipStart, lines.length - skipEnd);

  // Merge short lines horizontally
  lines = mergeShortLines(lines, originalImage.width * UPSCALE_FACTOR);

  // Split lines into pages
  const pages = splitLinesIntoPages(lines);
  console.log(`Split into ${pages.length} pages, ${lines.length} total lines`);

  // Draw each page
  pages.forEach((pageLines, pageIndex) => {
    const canvas = createOutputCanvas();
    const ctx = canvas.getContext('2d');

    // White background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);

    // Layout parameters
    const padding = 4;
    const lineSpacing = 0; // No spacing between lines
    const availableHeight = OUTPUT_HEIGHT - padding * 2;
    const availableWidth = OUTPUT_WIDTH - padding * 2;

    // Calculate uniform height for each line
    const uniformLineHeight = availableHeight / pageLines.length;

    // Calculate scale for each line based on uniform height (height priority)
    // but also ensure it fits within width
    const lineScales = pageLines.map(line => {
      const scaleY = uniformLineHeight / line.height;

      // For merged lines, calculate total width of all parts
      let totalWidth = line.width;
      if (line.parts && line.parts.length > 1) {
        totalWidth = line.parts.reduce((sum, part) => sum + part.width, 0);
      }

      const scaleX = availableWidth / totalWidth;
      // Use the smaller scale to fit both height and width
      return Math.min(scaleY, scaleX, 4);
    });

    // Draw lines with sharp scaling
    let currentY = padding;

    pageLines.forEach((line, index) => {
      const scale = lineScales[index];
      const dstHeight = uniformLineHeight;

      // Check if line has multiple parts (merged short lines)
      if (line.parts && line.parts.length > 1) {
        // Calculate total width of all parts
        let totalPartsWidth = 0;
        line.parts.forEach(part => {
          totalPartsWidth += part.width * scale;
        });

        // Center the group horizontally
        let partX = (OUTPUT_WIDTH - totalPartsWidth) / 2;

        // Draw each part centered vertically within the line
        line.parts.forEach(part => {
          const partDstWidth = part.width * scale;
          const partDstHeight = part.height * scale;

          // Center each part vertically within the line height
          const partY = currentY + (dstHeight - partDstHeight) / 2;

          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(
            upscaledImage,
            part.x, part.y, part.width, part.height,
            partX, partY, partDstWidth, partDstHeight
          );
          ctx.imageSmoothingEnabled = true;

          partX += partDstWidth;
        });
      } else {
        // Single part: draw normally
        const dstWidth = line.width * scale;
        const dstX = (OUTPUT_WIDTH - dstWidth) / 2;

        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          upscaledImage,
          line.x, line.y, line.width, line.height,
          dstX, currentY, dstWidth, dstHeight
        );
        ctx.imageSmoothingEnabled = true;
      }

      currentY += dstHeight;
    });

    outputCanvases.push(canvas);
  });

  displayOutputCanvases();
}

// Upscale image for better quality cropping
function upscaleImage(img, factor) {
  const canvas = document.createElement('canvas');
  canvas.width = img.width * factor;
  canvas.height = img.height * factor;
  const ctx = canvas.getContext('2d');

  // Use high-quality interpolation for upscaling
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return canvas;
}

// Split lines into pages (max lines per page)
function splitLinesIntoPages(lines) {
  const maxLinesPerPage = parseInt(linesPerPageSlider.value);
  const pages = [];

  for (let i = 0; i < lines.length; i += maxLinesPerPage) {
    pages.push(lines.slice(i, i + maxLinesPerPage));
  }

  return pages;
}

// Create a new output canvas
function createOutputCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  return canvas;
}

// Merge short lines that are on the same horizontal level
function mergeShortLines(lines, imageWidth) {
  if (lines.length === 0) return lines;

  const SHORT_WIDTH_THRESHOLD = imageWidth * 0.35; // 35% of image width
  const Y_THRESHOLD = 150 * UPSCALE_FACTOR; // Y coordinate tolerance

  const merged = [];
  let current = { ...lines[0], parts: [{ ...lines[0] }] };
  delete current.parts[0].parts; // Remove nested parts

  for (let i = 1; i < lines.length; i++) {
    const next = lines[i];
    const currentBottom = current.y + current.height;
    const nextBottom = next.y + next.height;

    // Use the last part's Y for comparison (to allow continuous merging)
    const lastPart = current.parts[current.parts.length - 1];
    const lastPartY = lastPart.y;

    // Check if next line is short and on similar Y level
    const nextShort = next.width < SHORT_WIDTH_THRESHOLD;
    const similarY = Math.abs(lastPartY - next.y) < Y_THRESHOLD;

    // Calculate total width of parts (without gaps) for width check
    const totalPartsWidth = current.parts.reduce((sum, part) => sum + part.width, 0) + next.width;
    const fitsWidth = totalPartsWidth < imageWidth * 0.95;

    if (nextShort && similarY && fitsWidth) {
      // Merge: add next as a part
      current.parts.push({ ...next });
      // Expand bounding box (width)
      current.width = Math.max(current.x + current.width, next.x + next.width) - current.x;
      // Keep height as first part's height (treat merged lines as single line)
      // Update y to minimum
      current.y = Math.min(current.y, next.y);
    } else {
      merged.push(current);
      current = { ...next, parts: [{ ...next }] };
      delete current.parts[0].parts;
    }
  }

  merged.push(current);
  return merged;
}

// Display output canvases in the DOM
function displayOutputCanvases() {
  // Clear existing output containers
  const existingContainers = document.querySelectorAll('.output-container');
  existingContainers.forEach(c => c.remove());

  // Find the parent of outputCanvas
  const parent = outputCanvas.parentElement;

  outputCanvases.forEach((canvas, index) => {
    const container = document.createElement('div');
    container.className = 'output-container';

    const label = document.createElement('div');
    label.className = 'output-label';
    label.textContent = `ページ ${index + 1}/${outputCanvases.length}`;
    container.appendChild(label);

    const canvasWrapper = document.createElement('div');
    canvasWrapper.className = 'output-canvas-wrapper';
    canvasWrapper.appendChild(canvas);
    container.appendChild(canvasWrapper);

    parent.insertBefore(container, outputCanvas);
  });

  // Hide the original output canvas
  outputCanvas.classList.add('hidden');

  // Enable download/share buttons
  downloadBtn.disabled = false;
  shareBtn.disabled = false;
}

// Merge overlapping lines
function mergeOverlappingLines(lines, threshold) {
  if (lines.length === 0) return lines;

  const merged = [];
  let current = { ...lines[0] };

  for (let i = 1; i < lines.length; i++) {
    const next = lines[i];
    const currentBottom = current.y + current.height;
    const nextBottom = next.y + next.height;

    // Skip duplicates (same Y position)
    if (Math.abs(current.y - next.y) < threshold && Math.abs(currentBottom - nextBottom) < threshold) {
      continue;
    }

    const overlapTop = Math.max(current.y, next.y);
    const overlapBottom = Math.min(currentBottom, nextBottom);

    if (overlapBottom > overlapTop) {
      // Merge overlapping lines
      current.x = Math.min(current.x, next.x);
      current.y = Math.min(current.y, next.y);
      current.width = Math.max(current.x + current.width, next.x + next.width) - current.x;
      current.height = Math.max(currentBottom, nextBottom) - current.y;
    } else {
      merged.push(current);
      current = { ...next };
    }
  }

  merged.push(current);
  return merged;
}

// Draw scaled image (fallback)
function drawScaledImage(ctx, img) {
  const scale = Math.min(OUTPUT_WIDTH / img.width, OUTPUT_HEIGHT / img.height);
  const width = img.width * scale;
  const height = img.height * scale;
  ctx.drawImage(img, (OUTPUT_WIDTH - width) / 2, (OUTPUT_HEIGHT - height) / 2, width, height);
}

// Update progress bar
function updateProgress(percent, text) {
  progressFill.style.width = `${percent}%`;
  progressText.textContent = text;
}

// Download images (as zip or individual)
async function downloadImage() {
  if (outputCanvases.length === 0) return;

  // Download each image
  for (let i = 0; i < outputCanvases.length; i++) {
    const canvas = outputCanvases[i];
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `enhanced_page${i + 1}_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    // Small delay between downloads
    if (i < outputCanvases.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
}

// Share images (iOS Safari)
async function shareImage() {
  if (!navigator.share) {
    alert('このブラウザは共有機能に対応していません');
    return;
  }

  if (outputCanvases.length === 0) return;

  try {
    const files = await Promise.all(
      outputCanvases.map((canvas, i) =>
        new Promise(resolve => canvas.toBlob(blob => {
          resolve(new File([blob], `enhanced_page${i + 1}.png`, { type: 'image/png' }));
        }, 'image/png'))
      )
    );
    await navigator.share({ files, title: 'Enhanced Images' });
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('Share error:', error);
    }
  }
}

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', init);
