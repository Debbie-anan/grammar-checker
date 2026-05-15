document.addEventListener('DOMContentLoaded', async () => {
  const settings = await chrome.storage.sync.get({
    language: 'en-US',
    features: {
      spelling: true, grammar: true, punctuation: true,
      wordChoice: true, style: true, clarity: true
    },
    enabled: true
  });

  document.getElementById('enableToggle').checked = settings.enabled;
  document.getElementById('langSelect').value = settings.language;

  document.querySelectorAll('[data-feature]').forEach(cb => {
    cb.checked = settings.features[cb.dataset.feature] ?? true;
  });

  document.getElementById('enableToggle').addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ enabled: e.target.checked });
  });

  document.getElementById('langSelect').addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ language: e.target.value });
  });

  document.querySelectorAll('[data-feature]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const features = {};
      document.querySelectorAll('[data-feature]').forEach(el => {
        features[el.dataset.feature] = el.checked;
      });
      await chrome.storage.sync.set({ features });
    });
  });

  document.getElementById('openSidePanel').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  });
});
