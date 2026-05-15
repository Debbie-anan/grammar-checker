var GC = window.GC || {};

GC.ISSUE_COLORS = {
  spelling:    { underline: '#FF4444', bg: 'rgba(255,68,68,0.08)' },
  grammar:     { underline: '#FF4444', bg: 'rgba(255,68,68,0.08)' },
  punctuation: { underline: '#FF9800', bg: 'rgba(255,152,0,0.08)' },
  wordChoice:  { underline: '#9C27B0', bg: 'rgba(156,39,176,0.08)' },
  style:       { underline: '#9C27B0', bg: 'rgba(156,39,176,0.08)' },
  clarity:     { underline: '#2196F3', bg: 'rgba(33,150,243,0.08)' },
  tone:        { underline: '#00BCD4', bg: 'rgba(0,188,212,0.08)' }
};

GC.SEVERITY_LABELS = {
  error: 'Error',
  warning: 'Warning',
  suggestion: 'Suggestion'
};

GC.DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'claude-haiku-4-5-20251001',
  features: {
    spelling: true,
    grammar: true,
    punctuation: true,
    wordChoice: true,
    style: true,
    clarity: true,
    rewrites: true,
    toneDetection: true
  },
  language: 'en',
  ignoredWords: [],
  enabled: true
};

GC.DEBOUNCE_DELAY = 800;
GC.MAX_TEXT_LENGTH = 5000;

window.GC = GC;
