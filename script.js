const MAX_APNG_BYTES = 512 * 1024;
const MAX_APNG_SIZE = 320;
const PNG_SIZES = [112, 128];

const fileInput = document.getElementById("fileInput");
const dropZone = document.getElementById("dropZone");
const pickerArea = document.getElementById("pickerArea");
const processBtn = document.getElementById("processBtn");
const statusEl = document.getElementById("status");

const originalPreview = document.getElementById("originalPreview");
const png112Preview = document.getElementById("png112Preview");
const png128Preview = document.getElementById("png128Preview");
const apngPreview = document.getElementById("apngPreview");
const apngMeta = document.getElementById("apngMeta");

const download112 = document.getElementById("download112");
const download128 = document.getElementById("download128");
const downloadApng = document.getElementById("downloadApng");
const outputFiles = new Map();

let selectedFile = null;

fileInput.addEventListener("change", () => {
  setSelectedFile(fileInput.files?.[0] ?? null);
});

processBtn.addEventListener("click", async () => {
  if (!selectedFile) return;
  try {
    setStatus("Processing...");
    processBtn.disabled = true;
    await buildOutputs(selectedFile);
    setStatus("Done.");
  } catch (error) {
    console.error(error);
    setStatus(`Failed: ${error.message}`);
  } finally {
    processBtn.disabled = false;
  }
});

[download112, download128, downloadApng].forEach((button) => {
  button.addEventListener("click", async () => {
    const entry = outputFiles.get(button.id);
    if (!entry) return;
    await saveOutputFile(entry.blob, entry.filename);
  });
});

["dragenter", "dragover"].forEach((eventName) => {
  pickerArea.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("active");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  pickerArea.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("active");
  });
});

pickerArea.addEventListener("drop", (event) => {
  const droppedFile = event.dataTransfer?.files?.[0] ?? null;
  setSelectedFile(droppedFile);
});

function setStatus(text) {
  statusEl.textContent = text;
}

function isSupportedType(file) {
  return file && (file.type === "image/png" || file.type === "image/gif");
}

function setSelectedFile(file) {
  if (!file) {
    selectedFile = null;
    processBtn.disabled = true;
    resetOutputs();
    setStatus("");
    return;
  }

  if (!isSupportedType(file)) {
    selectedFile = null;
    processBtn.disabled = true;
    resetOutputs();
    setStatus("Only GIF and PNG files are supported.");
    return;
  }

  selectedFile = file;
  processBtn.disabled = false;
  resetOutputs();
  renderOriginalPreview(selectedFile);
  setStatus(`Ready: ${selectedFile.name}`);
}

function resetOutputs() {
  [png112Preview, png128Preview, apngPreview, originalPreview].forEach((el) => {
    if (el !== originalPreview) el.innerHTML = "";
  });
  apngMeta.textContent = "";
  outputFiles.clear();
  [download112, download128, downloadApng].forEach((button) => {
    button.classList.add("hidden");
  });
}

function renderOriginalPreview(file) {
  originalPreview.innerHTML = "";
  const img = document.createElement("img");
  img.src = URL.createObjectURL(file);
  img.alt = "Original preview";
  originalPreview.appendChild(img);
}

async function buildOutputs(file) {
  const sourceFrames = await extractFrames(file);
  const delayArray = sourceFrames.delays;
  const outputIsGif = file.type === "image/gif";
  const originalBaseName = getBaseName(file.name || "image");

  for (const size of PNG_SIZES) {
    const blob = outputIsGif
      ? await renderGifBlob(sourceFrames.frames, delayArray, size, size)
      : await renderPngBlob(sourceFrames.frames[0], size, size);
    const targetPreview = size === 112 ? png112Preview : png128Preview;
    const targetDownload = size === 112 ? download112 : download128;
    const extension = outputIsGif ? "gif" : "png";
    const labelType = outputIsGif ? "GIF" : "PNG";
    targetDownload.textContent = `Download ${size}x${size} ${labelType}`;
    attachPreviewAndDownload(targetPreview, targetDownload, blob, `${originalBaseName}-${size}.${extension}`);
  }

  const apngResult = await createApngWithinLimit(sourceFrames.frames, delayArray, MAX_APNG_SIZE, MAX_APNG_BYTES);
  attachPreviewAndDownload(
    apngPreview,
    downloadApng,
    apngResult.blob,
    `${originalBaseName}-${apngResult.size}.apng`
  );
  apngMeta.textContent = `Size: ${formatBytes(apngResult.blob.size)} | Colors: ${apngResult.colors} | Resolution: ${apngResult.size}x${apngResult.size}`;
}

async function extractFrames(file) {
  const fileType = file.type;
  if (fileType === "image/png") {
    const decoded = await decodeAnimatedFrames(file);
    if (decoded) return decoded;

    const img = await loadImageFromBlob(file);
    return {
      frames: [imageToCanvas(img)],
      delays: [120],
    };
  }

  if (fileType === "image/gif") {
    const omgDecoded = await decodeGifWithOmgGif(file);
    if (omgDecoded) return omgDecoded;

    const decoded = await decodeAnimatedFrames(file);
    if (decoded) return decoded;

    const img = await loadImageFromBlob(file);
    return {
      frames: [imageToCanvas(img)],
      delays: [120],
    };
  }

  throw new Error("Only PNG and GIF are supported.");
}

async function decodeAnimatedFrames(file) {
  if (typeof window.ImageDecoder === "undefined") return null;

  try {
    const data = await file.arrayBuffer();
    const decoder = new ImageDecoder({
      data: new Uint8Array(data),
      type: file.type,
    });

    const track = decoder.tracks?.selectedTrack;
    const frameCount = track?.frameCount || 1;
    const frames = [];
    const delays = [];

    for (let i = 0; i < frameCount; i += 1) {
      const result = await decoder.decode({ frameIndex: i });
      const frame = result.image;
      const canvas = document.createElement("canvas");
      canvas.width = frame.displayWidth;
      canvas.height = frame.displayHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(frame, 0, 0);
      frames.push(canvas);

      const rawDurationUs = frame.duration || 120000;
      delays.push(Math.max(20, Math.round(rawDurationUs / 1000)));
      frame.close();
    }

    decoder.close();
    return { frames, delays };
  } catch (error) {
    console.warn("Animated decode fallback used:", error);
    return null;
  }
}

async function decodeGifWithOmgGif(file) {
  if (typeof window.GifReader !== "function") return null;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const reader = new window.GifReader(bytes);
    const width = reader.width;
    const height = reader.height;
    const frameCount = reader.numFrames();
    if (!frameCount) return null;

    const frames = [];
    const delays = [];

    for (let i = 0; i < frameCount; i += 1) {
      const rgba = new Uint8ClampedArray(width * height * 4);
      reader.decodeAndBlitFrameRGBA(i, rgba);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      const imageData = new ImageData(rgba, width, height);
      ctx.putImageData(imageData, 0, 0);
      frames.push(canvas);

      const info = reader.frameInfo(i);
      const delayCs = info.delay || 12;
      delays.push(Math.max(20, delayCs * 10));
    }

    return { frames, delays };
  } catch (error) {
    console.warn("omggif decode failed, falling back:", error);
    return null;
  }
}

async function renderPngBlob(sourceCanvas, width, height) {
  const canvas = resizeCanvasContain(sourceCanvas, width, height);
  return await canvasToBlob(canvas, "image/png");
}

async function renderGifBlob(frames, delays, width, height) {
  if (typeof window.GifWriter !== "function") {
    throw new Error("GIF encoder not available.");
  }

  const palette = buildGifPalette332();
  const estimatedBytes = Math.max(10240, width * height * frames.length * 5);
  const out = new Uint8Array(estimatedBytes);
  const writer = new window.GifWriter(out, width, height, { loop: 0, palette });

  for (let i = 0; i < frames.length; i += 1) {
    const resized = resizeCanvasContain(frames[i], width, height);
    const rgba = resized.getContext("2d").getImageData(0, 0, width, height).data;
    const indexed = rgbaToIndexed332(rgba);
    const delayCs = Math.max(2, Math.round((delays[i] || 100) / 10));
    writer.addFrame(0, 0, width, height, indexed, {
      delay: delayCs,
      transparent: 0,
      disposal: 2,
    });
  }

  const used = writer.end();
  return new Blob([out.slice(0, used)], { type: "image/gif" });
}

async function createApngWithinLimit(frames, delays, maxSize, maxBytes) {
  const colorTrials = [256, 192, 128, 96, 64];
  const sizeStep = 16;
  let best = null;

  for (let size = maxSize; size >= 64; size -= sizeStep) {
    const resizedBuffers = await Promise.all(
      frames.map(async (frame) => {
        const resized = resizeCanvasContain(frame, size, size);
        return canvasToRgbaBuffer(resized);
      })
    );

    for (const colors of colorTrials) {
      const encoded = UPNG.encode(resizedBuffers, size, size, colors, delays);
      const blob = new Blob([encoded], { type: "image/apng" });
      const candidate = { blob, colors, size };

      if (!best || candidate.blob.size < best.blob.size) best = candidate;
      if (blob.size <= maxBytes) return candidate;
    }
  }

  if (!best) throw new Error("APNG generation failed.");
  return best;
}

function resizeCanvasContain(sourceCanvas, targetWidth, targetHeight) {
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, targetWidth, targetHeight);

  const scale = Math.min(targetWidth / sourceCanvas.width, targetHeight / sourceCanvas.height);
  const drawWidth = Math.round(sourceCanvas.width * scale);
  const drawHeight = Math.round(sourceCanvas.height * scale);
  const dx = Math.floor((targetWidth - drawWidth) / 2);
  const dy = Math.floor((targetHeight - drawHeight) / 2);
  ctx.drawImage(sourceCanvas, dx, dy, drawWidth, drawHeight);
  return canvas;
}

function attachPreviewAndDownload(previewEl, buttonEl, blob, filename) {
  previewEl.innerHTML = "";
  const img = document.createElement("img");
  const url = URL.createObjectURL(blob);
  img.src = url;
  img.alt = filename;
  previewEl.appendChild(img);
  outputFiles.set(buttonEl.id, { blob, filename });
  buttonEl.classList.remove("hidden");
}

function imageToCanvas(img) {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  canvas.getContext("2d").drawImage(img, 0, 0);
  return canvas;
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image."));
    img.src = URL.createObjectURL(blob);
  });
}

function canvasToBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("Canvas conversion failed."));
      else resolve(blob);
    }, type);
  });
}

function canvasToRgbaBuffer(canvas) {
  const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  return data.buffer;
}

function buildGifPalette332() {
  const palette = [];
  for (let r = 0; r < 8; r += 1) {
    for (let g = 0; g < 8; g += 1) {
      for (let b = 0; b < 4; b += 1) {
        const rr = Math.round((r / 7) * 255);
        const gg = Math.round((g / 7) * 255);
        const bb = Math.round((b / 3) * 255);
        palette.push((rr << 16) | (gg << 8) | bb);
      }
    }
  }
  // Reserve index 0 for transparency and keep opaque black at index 1.
  palette[0] = 0x000000;
  palette[1] = 0x000000;
  return palette;
}

function rgbaToIndexed332(rgba) {
  const px = rgba.length / 4;
  const indexed = new Uint8Array(px);
  for (let i = 0, p = 0; i < px; i += 1, p += 4) {
    const alpha = rgba[p + 3];
    if (alpha < 16) {
      indexed[i] = 0;
      continue;
    }
    const r3 = rgba[p] >> 5;
    const g3 = rgba[p + 1] >> 5;
    const b2 = rgba[p + 2] >> 6;
    const paletteIndex = (r3 << 5) | (g3 << 2) | b2;
    indexed[i] = paletteIndex === 0 ? 1 : paletteIndex;
  }
  return indexed;
}

function formatBytes(bytes) {
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function getBaseName(filename) {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) return filename;
  return filename.slice(0, lastDot);
}

function getMimeForFilename(filename) {
  if (filename.endsWith(".gif")) return "image/gif";
  if (filename.endsWith(".apng")) return "image/apng";
  return "image/png";
}

async function saveOutputFile(blob, filename) {
  if (typeof window.showSaveFilePicker === "function") {
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: "Image file",
          accept: {
            [getMimeForFilename(filename)]: [`.${filename.split(".").pop()}`],
          },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }

  const url = URL.createObjectURL(blob);
  const fallbackLink = document.createElement("a");
  fallbackLink.href = url;
  fallbackLink.download = filename;
  fallbackLink.click();
}
