import { describe, test, expect, mock } from 'bun:test';
import vm from 'vm';
import popupSource from './popup.js' with { type: 'text' };

// Minimal DOM mock — only the subset popup.js needs
function makeElement() {
  const el = {
    textContent: '',
    value: '',
    disabled: false,
    _listeners: {},
    addEventListener(event, handler) {
      (this._listeners[event] ??= []).push(handler);
    },
    click() { this._dispatch({ type: 'click' }); },
    dispatchEvent(evt) { this._dispatch(evt); },
    _dispatch(evt) {
      for (const h of this._listeners[evt.type] ?? []) h(evt);
    },
  };
  return el;
}

function makeDocument() {
  const els = {
    preset: makeElement(),
    resize: makeElement(),
    'capture-visible': makeElement(),
    'capture-full': makeElement(),
    status: makeElement(),
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

  const ctx = vm.createContext({ document: doc, chrome: browserMock, console });
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
