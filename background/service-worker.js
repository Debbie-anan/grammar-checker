const DEFAULT_SETTINGS = {
  features: {
    spelling: true,
    grammar: true,
    punctuation: true,
    wordChoice: true,
    style: true,
    clarity: true
  },
  language: 'en-US',
  ignoredWords: [],
  enabled: true
};

// LanguageTool category mapping to our issue types
const CATEGORY_MAP = {
  'TYPOS': 'spelling',
  'SPELLING': 'spelling',
  'GRAMMAR': 'grammar',
  'PUNCTUATION': 'punctuation',
  'STYLE': 'style',
  'WORDINESS': 'clarity',
  'REDUNDANCY': 'clarity',
  'CASING': 'grammar',
  'COMPOUNDING': 'grammar',
  'CONFUSED_WORDS': 'grammar',
  'REPETITIONS': 'wordChoice',
  'COLLOCATIONS': 'wordChoice',
  'MISC': 'grammar'
};

let sidePanelPort = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'sidepanel') {
    sidePanelPort = port;
    port.onDisconnect.addListener(() => { sidePanelPort = null; });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECK_TEXT') {
    handleCheckText(message.payload).then(sendResponse);
    return true;
  }
  if (message.type === 'GET_STATUS') {
    chrome.storage.sync.get(DEFAULT_SETTINGS).then(settings => {
      sendResponse({ active: true, enabled: settings.enabled });
    });
    return true;
  }
});

async function getSettings() {
  return await chrome.storage.sync.get(DEFAULT_SETTINGS);
}

async function handleCheckText(payload) {
  const settings = await getSettings();
  if (!settings.enabled) {
    return { error: 'DISABLED', message: 'Grammar checker is disabled.' };
  }

  try {
    // Call LanguageTool free API
    const params = new URLSearchParams({
      text: payload.text,
      language: settings.language || 'en-US',
      enabledOnly: 'false'
    });

    const response = await fetch('https://api.languagetool.org/v2/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      return { error: 'API_ERROR', message: `LanguageTool returned ${response.status}` };
    }

    const data = await response.json();
    const issues = convertLanguageToolMatches(data.matches, settings.features);

    // Simple readability estimate based on sentence/word length
    const readability = estimateReadability(payload.text);

    const result = {
      type: 'CHECK_RESULT',
      payload: {
        fieldId: payload.fieldId,
        issues,
        tone: { primary: 'neutral', confidence: 0.5 },
        readability,
        summary: issues.length > 0
          ? `${issues.length} issue${issues.length > 1 ? 's' : ''} found`
          : 'No issues found'
      }
    };

    if (sidePanelPort) {
      sidePanelPort.postMessage(result);
    }

    return result;
  } catch (e) {
    return { error: 'NETWORK_ERROR', message: e.message };
  }
}

function convertLanguageToolMatches(matches, features) {
  if (!matches || !matches.length) return [];

  return matches.map(match => {
    const categoryId = match.rule?.category?.id || 'MISC';
    const type = CATEGORY_MAP[categoryId] || 'grammar';

    // Filter by enabled features
    if (!features[type]) return null;

    const replacements = (match.replacements || []).slice(0, 4).map(r => r.value);
    const primary = replacements[0] || '';
    const alternatives = replacements.slice(1);

    let severity = 'warning';
    if (match.rule?.issueType === 'misspelling') severity = 'error';
    else if (categoryId === 'TYPOS' || categoryId === 'SPELLING') severity = 'error';
    else if (categoryId === 'STYLE' || categoryId === 'WORDINESS') severity = 'suggestion';

    return {
      type,
      severity,
      offset: match.offset,
      length: match.length,
      original: match.context?.text?.substring(match.context.offset, match.context.offset + match.context.length) || '',
      replacement: primary,
      alternatives,
      message: match.message || match.shortMessage || 'Issue detected'
    };
  }).filter(Boolean);
}

function estimateReadability(text) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const avgWordsPerSentence = sentences.length > 0 ? words.length / sentences.length : 0;
  const avgWordLength = words.length > 0 ? words.reduce((sum, w) => sum + w.length, 0) / words.length : 0;

  // Simplified readability score (higher = easier)
  let score = Math.max(0, Math.min(100, 100 - (avgWordsPerSentence - 10) * 3 - (avgWordLength - 4) * 10));
  score = Math.round(score);

  let level = 'simple';
  if (score < 30) level = 'academic';
  else if (score < 50) level = 'complex';
  else if (score < 70) level = 'moderate';

  return { score, level };
}
