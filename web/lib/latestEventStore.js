const store = globalThis.__iotDemoStore ?? {
  latestEvent: null
};

if (!globalThis.__iotDemoStore) {
  globalThis.__iotDemoStore = store;
}

export function setLatestEvent(payload) {
  store.latestEvent = {
    ...payload,
    receivedAt: new Date().toISOString()
  };

  return store.latestEvent;
}

export function getLatestEvent() {
  return store.latestEvent;
}
