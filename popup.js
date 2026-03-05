const $ = s => document.querySelector(s);
const browser = chrome || browser; // for compatibility

function setStatus(msg) {
  const s = $('#status');
  if (s) s.textContent = msg;
}

function makeStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

document.addEventListener('DOMContentLoaded', () => {
  // Set version
  setStatus(`Shot! v1.1.0 ready to rock.`);

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

  // Store default window size for next time
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
    const filename = `@shots/shot-${makeStamp()}.png`;
    const opts = { format: 'png' };
    const image = await browser.tabs.captureVisibleTab(null, opts);
    browser.downloads.download({ url: image, filename });
  });
  const captureFullBtn = $('#capture-full');
  if (captureFullBtn) captureFullBtn.addEventListener('click', async () => {
    const filename = `@shots/shot-${makeStamp()}.png`;
    const opts = { format: 'png' };
    const image = await browser.tabs.captureTab(null, opts);
    browser.downloads.download({ url: image, filename });
  });

});
