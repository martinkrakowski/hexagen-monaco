// Mock localStorage in jsdom environment with stateful implementation
if (typeof window !== 'undefined') {
  const storageMap = new Map();
  window.localStorage = {
    getItem: jest.fn((key) => storageMap.get(key) ?? null),
    setItem: jest.fn((key, value) => { storageMap.set(String(key), String(value)); }),
    removeItem: jest.fn((key) => { storageMap.delete(key); }),
    clear: jest.fn(() => { storageMap.clear(); }),
    key: jest.fn((index) => {
      const keys = Array.from(storageMap.keys());
      return keys[index] ?? null;
    }),
    get length() { return storageMap.size; }
  };
}
