const fs = require('fs');

try {
  // Mock browser globals
  global.window = {
    location: { origin: 'https://qprint-7890.web.app', href: 'https://qprint-7890.web.app' },
    localStorage: {
      _data: {},
      getItem(k) { return this._data[k] || null; },
      setItem(k, v) { this._data[k] = String(v); },
      removeItem(k) { delete this._data[k]; }
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    EventSource: function() {}
  };
  global.localStorage = global.window.localStorage;
  global.document = {
    getElementById() { return { innerHTML: '' }; }
  };
  global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });

  console.log('Testing modules in TSX...');
} catch (e) {
  console.error(e);
}
