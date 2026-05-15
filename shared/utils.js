var GC = window.GC || {};

GC.debounce = function(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
};

GC.validateAndFixOffsets = function(text, issues) {
  return issues.map(issue => {
    const claimed = text.substring(issue.offset, issue.offset + issue.length);
    if (claimed === issue.original) return issue;

    const nearby = text.indexOf(issue.original, Math.max(0, issue.offset - 20));
    if (nearby !== -1) {
      return { ...issue, offset: nearby };
    }

    const global = text.indexOf(issue.original);
    if (global !== -1) {
      return { ...issue, offset: global };
    }

    return null;
  }).filter(Boolean);
};

GC.generateFieldId = function() {
  return 'gc-' + Math.random().toString(36).substring(2, 10);
};

GC.getTextFromField = function(field) {
  if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
    return field.value;
  }
  return field.innerText || field.textContent || '';
};

GC.simpleHash = function(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
};

window.GC = GC;
