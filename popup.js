const $ = s => document.querySelector(s);

function setStatus(msg) {
  const s = $('#status');
  if (s) s.textContent = msg;
}

function makeStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

document.addEventListener('DOMContentLoaded', () => {
  // Resize handler
  const resizeBtn = $('#resize');
  if (resizeBtn) resizeBtn.addEventListener('click', async () => {
    const preset = $('#preset').value; // e.g. "800x600"
    const [w, h] = preset.split('x').map(Number);
    setStatus('Resizing window...');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const win = await chrome.windows.get(tab.windowId);
    await chrome.windows.update(win.id, { width: w, height: h });
    setStatus(`Window resized to ${w}×${h}`);
  });

  // Store default window size for next time
  const presetEl = $('#preset');
  if (presetEl) {
    // load saved size
    chrome.storage.sync.get({ windowWidth: 800, windowHeight: 600 }, (items) => {
      const w = items.windowWidth || 800;
      const h = items.windowHeight || 600;
      presetEl.value = `${w}x${h}`;
    });
    presetEl.addEventListener('change', () => {
      const preset = presetEl.value || '';
      const [w, h] = preset.split('x').map(Number);
      if (w && h) {
        chrome.storage.sync.set({ windowWidth: w, windowHeight: h });
      }
    });
  }

  // Capture buttons
  const captureVisibleBtn = $('#capture-visible');
  if (captureVisibleBtn) captureVisibleBtn.addEventListener('click', async () => {
    const filename = `shot-${makeStamp()}.png`;
    const opts = { format: 'png' };
    const image = await chrome.tabs.captureVisibleTab(null, opts);
    chrome.downloads.download({ url: image, filename, conflictAction: 'uniquify' });
  });
  // const captureFullpageBtn = $('#capture-fullpage');
  // if (captureFullpageBtn) captureFullpageBtn.addEventListener('click', () => {
  //   const filename = `shot-fullpage-${makeStamp()}.png`;
  //   chrome.runtime.sendMessage({ action: 'capture-fullpage', filename }, resp => {
  //     setStatus(resp && resp.ok ? 'Saved to Downloads' : `Capture failed: ${resp && resp.error ? resp.error : 'unknown'}`);
  //   });
  // });

});
