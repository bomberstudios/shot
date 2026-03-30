const $ = s => document.querySelector(s);
const browser = chrome || browser; // for compatibility

function setStatus(msg) {
  const s = $('#status');
  if (s) s.textContent = msg;
}

function makeStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function isPreset(value) {
  return [...$("#preset").options].some(
    (o) => o.value === value && o.value !== "custom",
  );
}

document.addEventListener('DOMContentLoaded', () => {
  // Set version
  setStatus(`Shot! v1.1.0 ready to rock.`);

  function updateCustomVisibility() {
    $("#custom-size").hidden = $("#preset").value !== "custom";
  }

  // Resize handler
  const resizeBtn = $('#resize');
  if (resizeBtn) resizeBtn.addEventListener('click', async () => {
    let w, h;
    if ($("#preset").value === "custom") {
      w = Number($("#custom-w").value);
      h = Number($("#custom-h").value);
      if (!w || !h) {
        setStatus("Enter custom width and height.");
        return;
      }
    } else {
      [w, h] = $("#preset").value.split("x").map(Number);
    }
    setStatus('Resizing window...');
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const win = await browser.windows.get(tab.windowId);
    await browser.windows.update(win.id, { width: w, height: h });
    setStatus(`Window resized to ${w}×${h}`);
  });

  // Store default window size for next time
  const presetEl = $('#preset');
  if (presetEl) {
    // load saved size
    browser.storage.sync.get(
      { windowWidth: 800, windowHeight: 600 },
      (items) => {
        const w = items.windowWidth || 800;
        const h = items.windowHeight || 600;
        const key = `${w}x${h}`;
        if (isPreset(key)) {
          presetEl.value = key;
        } else {
          presetEl.value = "custom";
          $("#custom-w").value = w;
          $("#custom-h").value = h;
        }
        updateCustomVisibility();
      },
    );
    presetEl.addEventListener("change", () => {
      updateCustomVisibility();
      if (presetEl.value === "custom") {
        const w = Number($("#custom-w").value);
        const h = Number($("#custom-h").value);
        if (w && h)
          browser.storage.sync.set({ windowWidth: w, windowHeight: h });
      } else {
        const [w, h] = presetEl.value.split("x").map(Number);
        if (w && h)
          browser.storage.sync.set({ windowWidth: w, windowHeight: h });
      }
    });

    function saveCustomDims() {
      const w = Number($("#custom-w").value);
      const h = Number($("#custom-h").value);
      if (w && h) browser.storage.sync.set({ windowWidth: w, windowHeight: h });
    }
    $("#custom-w").addEventListener("input", saveCustomDims);
    $("#custom-h").addEventListener("input", saveCustomDims);
  }

  async function copyImageToClipboard(dataUrl) {
    if (!navigator?.clipboard?.write) {
      throw new Error("Clipboard API not available");
    }
    if (typeof ClipboardItem === "undefined") {
      throw new Error("ClipboardItem API not available");
    }

    let blob;
    if (typeof fetch === "function") {
      const resp = await fetch(dataUrl);
      blob = await resp.blob();
    } else {
      const [meta, payload] = dataUrl.split(",");
      const isBase64 = meta.includes(";base64");
      const raw = isBase64 ? atob(payload) : decodeURIComponent(payload);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
      const mimeType = meta.split(":")[1].split(";")[0];
      blob = new Blob([bytes], { type: mimeType });
    }

    const item = new ClipboardItem({ [blob.type]: blob });
    await navigator.clipboard.write([item]);
  }

  async function captureAndCopy(captureFn) {
    const filename = `@shots/shot-${makeStamp()}.png`;
    const opts = { format: "png" };
    const image = await captureFn(opts);
    browser.downloads.download({ url: image, filename });

    try {
      await copyImageToClipboard(image);
      setStatus("Screenshot saved and copied to clipboard.");
    } catch (err) {
      console.warn("clipboard write failed", err);
      setStatus(
        "Screenshot saved; clipboard copy unavailable in this environment.",
      );
    }
  }

  // Capture buttons
  const captureVisibleBtn = $('#capture-visible');
  if (captureVisibleBtn) captureVisibleBtn.addEventListener('click', async () => {
    await captureAndCopy((opts) => browser.tabs.captureVisibleTab(null, opts));
  });
  const captureFullBtn = $('#capture-full');
  if (captureFullBtn) captureFullBtn.addEventListener('click', async () => {
    await captureAndCopy((opts) => browser.tabs.captureTab(null, opts));
  });

});
