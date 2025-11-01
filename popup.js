const $ = s => document.querySelector(s);
const browser = (typeof chrome !== 'undefined') ? chrome : (typeof browser !== 'undefined' ? browser : undefined);

function setStatus(msg) {
  const s = $('#status');
  if (s) s.textContent = msg;
}

function makeStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// Helper: convert data: URL to object URL (works around Firefox rejecting data: URLs in downloads)
async function ensureDownloadableUrl(url) {
  if (!url || !url.startsWith || !url.startsWith('data:')) return url;
  // Use fetch to get a blob from the data URL, then create an object URL
  const resp = await fetch(url);
  const blob = await resp.blob();
  const objectUrl = URL.createObjectURL(blob);
  return objectUrl;
}

// Helper: download a URL, converting data: URLs when needed and revoking object URLs afterwards
async function safeDownload(url, filename) {
  let objectUrl;
  try {
    if (url.startsWith('data:')) {
      objectUrl = await ensureDownloadableUrl(url);
      await browser.downloads.download({ url: objectUrl, filename });
    } else {
      await browser.downloads.download({ url, filename });
    }
  } finally {
    if (objectUrl) {
      // Revoke after a small delay to allow the download to start
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Resize handler
  const resizeBtn = $('#resize');
  if (resizeBtn) resizeBtn.addEventListener('click', async () => {
    const preset = $('#preset').value; // e.g. "800x600"
    const [w, h] = preset.split('x').map(Number);
    setStatus('Resizing window...');
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const win = await browser.windows.get(tab.windowId);
    await browser.windows.update(win.id, { width: w, height: h });
    setStatus(`Window resized to ${w}×${h}`);
  });

  // Store default window size for next time. Doesn't seem to work in Firefox yet.
  const presetEl = $('#preset');
  if (presetEl) {
    // load saved size
    browser.storage.sync.get({ windowWidth: 800, windowHeight: 600 }, (items) => {
      const w = items.windowWidth || 800;
      const h = items.windowHeight || 600;
      presetEl.value = `${w}x${h}`;
    });
    presetEl.addEventListener('change', () => {
      const preset = presetEl.value || '';
      const [w, h] = preset.split('x').map(Number);
      if (w && h) {
        browser.storage.sync.set({ windowWidth: w, windowHeight: h });
      }
    });
  }

  // Capture buttons
  const captureVisibleBtn = $('#capture-visible');
  if (captureVisibleBtn) captureVisibleBtn.addEventListener('click', async () => {
    const filename = `shot-${makeStamp()}.png`;
    const opts = { format: 'png' };
    // TODO: this does not work well in Firefox (it captures an image larger than the visible area, based on the browser window size, not the visible tab area)
    const image = await browser.tabs.captureVisibleTab(null, opts);
    await safeDownload(image, filename);
  });

  const captureFullpageBtn = $('#capture-fullpage');
  if (captureFullpageBtn && browser.tabs.captureTab !== undefined) {
    captureFullpageBtn.addEventListener('click', async () => {
      const filename = `shot-fullpage-${makeStamp()}.png`;
      const image = await browser.tabs.captureTab(null, { format: 'png' });
      await safeDownload(image, filename);
    });
  } else {
    // Disable full page button if API not available
    if (captureFullpageBtn) {
      captureFullpageBtn.disabled = true;
      captureFullpageBtn.title = 'Full page capture not supported in this browser';
    }
  }

});
