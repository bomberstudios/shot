import { describe, test, expect, mock } from 'bun:test';
import vm from 'vm';
import popupSource from './popup.js' with { type: 'text' };

// Minimal DOM mock — only the subset popup.js needs
function makeElement() {
  const el = {
    textContent: "",
    value: "",
    disabled: false,
    hidden: false,
    _listeners: {},
    addEventListener(event, handler) {
      (this._listeners[event] ??= []).push(handler);
    },
    click() {
      this._dispatch({ type: "click" });
    },
    dispatchEvent(evt) {
      this._dispatch(evt);
    },
    _dispatch(evt) {
      for (const h of this._listeners[evt.type] ?? []) h(evt);
    },
  };
  return el;
}

function makeDocument() {
  const presetEl = makeElement();
  presetEl.options = [
    { value: "800x600" },
    { value: "1024x768" },
    { value: "1280x800" },
    { value: "1366x768" },
    { value: "1440x900" },
    { value: "1920x1080" },
    { value: "2560x1440" },
    { value: "custom" },
  ];

  const els = {
    preset: presetEl,
    resize: makeElement(),
    "capture-visible": makeElement(),
    "capture-full": makeElement(),
    status: makeElement(),
    "custom-size": makeElement(),
    "custom-w": makeElement(),
    "custom-h": makeElement(),
  };
  const docListeners = {};

  return {
    querySelector(sel) {
      const m = sel.match(/^#(.+)$/);
      return m ? (els[m[1]] ?? null) : null;
    },
    addEventListener(event, handler) {
      (docListeners[event] ??= []).push(handler);
    },
    createEvent() {
      return { type: '', initEvent(type) { this.type = type; } };
    },
    dispatchEvent(evt) {
      for (const h of docListeners[evt.type] ?? []) h(evt);
    },
    _elements: els,
  };
}

function makeBrowserMock({ windowWidth = 1280, windowHeight = 800 } = {}) {
  return {
    tabs: {
      query: mock(async () => [{ windowId: 42 }]),
      captureVisibleTab: mock(async () => 'data:image/png;base64,abc'),
      captureTab: mock(async () => 'data:image/png;base64,full'),
    },
    windows: {
      get: mock(async () => ({ id: 42 })),
      update: mock(async () => { }),
    },
    downloads: {
      download: mock(() => { }),
    },
    storage: {
      sync: {
        get: mock((_, cb) => cb({ windowWidth, windowHeight })),
        set: mock(() => { }),
      },
    },
  };
}

async function createPopup(browserMock) {
  const doc = makeDocument();

  const clipboardWrite = mock(async () => {});
  browserMock._clipboardWrite = clipboardWrite;
  const ctx = vm.createContext({
    document: doc,
    chrome: browserMock,
    console,
    navigator: { clipboard: { write: clipboardWrite } },
    ClipboardItem: class ClipboardItem {
      constructor(data) {
        this.data = data;
      }
    },
    Blob: class Blob {
      constructor(parts, opts = {}) {
        this.parts = parts;
        this.type = opts.type || "";
      }
    },
    fetch: undefined,
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
  });
  vm.runInContext(popupSource, ctx);

  // Trigger DOMContentLoaded
  const evt = doc.createEvent();
  evt.initEvent('DOMContentLoaded');
  doc.dispatchEvent(evt);

  // Drain microtasks (storage callback fires async)
  await new Promise(r => setTimeout(r, 0));

  return { doc, browser: browserMock };
}

// -- makeStamp --

describe('makeStamp', () => {
  const stubDoc = { addEventListener() { } };

  test('formats a known date correctly', () => {
    class MockDate extends Date {
      constructor(...a) { super(a.length ? a[0] : '2024-06-15T12:34:56.789Z'); }
    }
    const ctx = vm.createContext({ chrome: {}, console, document: stubDoc, Date: MockDate });
    vm.runInContext(popupSource, ctx);
    expect(ctx.makeStamp()).toBe('2024-06-15T12-34-56-789Z');
  });

  test('produces a string safe for filenames', () => {
    const ctx = vm.createContext({ chrome: {}, console, document: stubDoc });
    vm.runInContext(popupSource, ctx);
    const stamp = ctx.makeStamp();
    expect(stamp).not.toMatch(/[:.]/);
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
  });
});

// -- initialization --

describe('popup init', () => {
  test('sets status message on DOMContentLoaded', async () => {
    const { doc } = await createPopup(makeBrowserMock());
    expect(doc.querySelector('#status').textContent).toMatch(/ready/i);
  });

  test('loads saved window size into preset', async () => {
    const { doc } = await createPopup(makeBrowserMock({ windowWidth: 1280, windowHeight: 800 }));
    expect(doc.querySelector('#preset').value).toBe('1280x800');
  });

  test('falls back to 800x600 when storage returns defaults', async () => {
    const b = makeBrowserMock();
    b.storage.sync.get = mock((defaults, cb) => cb(defaults));
    const { doc } = await createPopup(b);
    expect(doc.querySelector('#preset').value).toBe('800x600');
  });
});

// -- resize --

describe('resize button', () => {
  test('queries active tab, gets window, and resizes to selected preset', async () => {
    const b = makeBrowserMock({ windowWidth: 1280, windowHeight: 800 });
    const { doc } = await createPopup(b);

    doc.querySelector('#resize').click();
    await new Promise(r => setTimeout(r, 20));

    expect(b.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(b.windows.get).toHaveBeenCalledWith(42);
    expect(b.windows.update).toHaveBeenCalledWith(42, { width: 1280, height: 800 });
  });

  test('updates status with resized dimensions', async () => {
    const b = makeBrowserMock({ windowWidth: 1280, windowHeight: 800 });
    const { doc } = await createPopup(b);

    doc.querySelector('#resize').click();
    await new Promise(r => setTimeout(r, 20));

    expect(doc.querySelector('#status').textContent).toMatch(/1280/);
  });
});

// -- capture visible --

describe('capture-visible button', () => {
  test('captures visible tab as PNG and triggers download', async () => {
    const b = makeBrowserMock();
    const { doc } = await createPopup(b);

    doc.querySelector('#capture-visible').click();
    await new Promise(r => setTimeout(r, 20));

    expect(b.tabs.captureVisibleTab).toHaveBeenCalledWith(null, { format: 'png' });
    expect(b.downloads.download).toHaveBeenCalledWith({
      url: 'data:image/png;base64,abc',
      filename: expect.stringMatching(/^@shots\/shot-.+\.png$/),
    });
  });

  test("copies visible screenshot to clipboard", async () => {
    const b = makeBrowserMock();
    const { doc } = await createPopup(b);

    doc.querySelector("#capture-visible").click();
    await new Promise((r) => setTimeout(r, 20));

    expect(b._clipboardWrite).toHaveBeenCalled();
    expect(doc.querySelector("#status").textContent).toMatch(
      /copied to clipboard/i,
    );
  });
});

// -- preset change --

describe('preset change', () => {
  test('saves new dimensions to sync storage', async () => {
    const b = makeBrowserMock();
    const { doc } = await createPopup(b);

    const preset = doc.querySelector('#preset');
    preset.value = '1920x1080';
    const evt = doc.createEvent();
    evt.initEvent('change');
    preset.dispatchEvent(evt);

    expect(b.storage.sync.set).toHaveBeenCalledWith({ windowWidth: 1920, windowHeight: 1080 });
  });
});

// -- custom size --

describe('custom size', () => {
  test('selecting "custom" reveals #custom-size', async () => {
    const b = makeBrowserMock({ windowWidth: 1280, windowHeight: 800 });
    const { doc } = await createPopup(b);

    const preset = doc.querySelector('#preset');
    preset.value = 'custom';
    const evt = doc.createEvent();
    evt.initEvent('change');
    preset.dispatchEvent(evt);

    expect(doc.querySelector('#custom-size').hidden).toBe(false);
  });

  test('selecting a non-custom preset hides #custom-size', async () => {
    const b = makeBrowserMock({ windowWidth: 1280, windowHeight: 800 });
    const { doc } = await createPopup(b);

    const preset = doc.querySelector('#preset');

    preset.value = 'custom';
    let evt = doc.createEvent();
    evt.initEvent('change');
    preset.dispatchEvent(evt);

    preset.value = '1920x1080';
    evt = doc.createEvent();
    evt.initEvent('change');
    preset.dispatchEvent(evt);

    expect(doc.querySelector('#custom-size').hidden).toBe(true);
  });

  test('resize with custom selected uses #custom-w and #custom-h values', async () => {
    const b = makeBrowserMock({ windowWidth: 1280, windowHeight: 800 });
    const { doc } = await createPopup(b);

    doc.querySelector('#preset').value = 'custom';
    doc.querySelector('#custom-w').value = '1234';
    doc.querySelector('#custom-h').value = '567';

    doc.querySelector('#resize').click();
    await new Promise(r => setTimeout(r, 20));

    expect(b.windows.update).toHaveBeenCalledWith(42, { width: 1234, height: 567 });
  });

  test('changing custom inputs saves dimensions to storage', async () => {
    const b = makeBrowserMock({ windowWidth: 1280, windowHeight: 800 });
    const { doc } = await createPopup(b);

    doc.querySelector('#custom-w').value = '999';
    doc.querySelector('#custom-h').value = '777';

    const evt = doc.createEvent();
    evt.initEvent('input');
    doc.querySelector('#custom-w').dispatchEvent(evt);

    expect(b.storage.sync.set).toHaveBeenCalledWith({ windowWidth: 999, windowHeight: 777 });
  });

  test('on load with non-preset dims, selects "custom" and fills inputs', async () => {
    const b = makeBrowserMock({ windowWidth: 1234, windowHeight: 567 });
    const { doc } = await createPopup(b);

    expect(doc.querySelector('#preset').value).toBe('custom');
    expect(doc.querySelector('#custom-w').value).toBe(1234);
    expect(doc.querySelector('#custom-h').value).toBe(567);
    expect(doc.querySelector('#custom-size').hidden).toBe(false);
  });

  test('on load with preset dims, #custom-size stays hidden', async () => {
    const b = makeBrowserMock({ windowWidth: 1280, windowHeight: 800 });
    const { doc } = await createPopup(b);

    expect(doc.querySelector('#preset').value).toBe('1280x800');
    expect(doc.querySelector('#custom-size').hidden).toBe(true);
  });
});
