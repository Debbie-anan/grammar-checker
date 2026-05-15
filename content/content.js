(function() {
  'use strict';

  const EDITABLE_SELECTOR = [
    'textarea',
    'input[type="text"]',
    'input:not([type])',
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '[contenteditable="plaintext-only"]',
    '[role="textbox"]',
    '.ql-editor',
    '.ProseMirror',
    '.editable',
    '[data-testid*="compose"]',
    '[aria-label*="message"]',
    '[aria-label*="Message"]'
  ].join(', ');
  const fieldStates = new WeakMap();
  let isEnabled = true;

  function log(...args) {
    console.log('[GrammarChecker]', ...args);
  }

  async function init() {
    log('Initializing...');
    const { enabled } = await chrome.storage.sync.get({ enabled: true });
    isEnabled = enabled;
    if (!isEnabled) {
      log('Extension is disabled');
      return;
    }

    GC.FloatingCard.init();
    scanForEditableFields();
    observeNewFields();

    // Most reliable detection: capture any focused editable element
    document.addEventListener('focusin', (e) => {
      if (!isEnabled) return;
      const el = findEditableElement(e.target);
      if (el) {
        log('focusin detected editable:', el.tagName, el.className?.substring(0, 40));
        attachToField(el);
      }
    });

    // Aggressive: periodically check active element
    setInterval(() => {
      if (!isEnabled) return;
      const active = document.activeElement;
      if (active) {
        const el = findEditableElement(active);
        if (el && !fieldStates.has(el)) {
          log('Periodic scan found active editable:', el.tagName, el.className?.substring(0, 40));
          attachToField(el);
        }
      }
    }, 1000);

    // Periodic rescan for dynamically added fields (some SPAs add contenteditable later)
    setInterval(scanForEditableFields, 3000);

    chrome.storage.onChanged.addListener((changes) => {
      if (changes.enabled) {
        isEnabled = changes.enabled.newValue;
        if (!isEnabled) removeAllDecorations();
        else scanForEditableFields();
      }
    });

    log('Initialized successfully');
  }

  // Walk up DOM tree to find the actual editable element
  function findEditableElement(el) {
    if (!el || el === document.body || el === document.documentElement) return null;
    if (isEditable(el)) return el;
    // Walk up to find editable parent (some apps focus a child span/div inside contenteditable)
    let current = el.parentElement;
    let depth = 0;
    while (current && current !== document.body && depth < 10) {
      if (isEditable(current)) return current;
      current = current.parentElement;
      depth++;
    }
    return null;
  }

  function isEditable(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT' && (el.type === 'text' || el.type === '' || !el.type)) return true;
    if (el.isContentEditable) return true;
    if (el.getAttribute('role') === 'textbox') return true;
    return false;
  }

  function scanForEditableFields() {
    const fields = document.querySelectorAll(EDITABLE_SELECTOR);
    fields.forEach(attachToField);
    // Also find any element with contenteditable attribute regardless of value
    document.querySelectorAll('[contenteditable]').forEach(el => {
      if (el.getAttribute('contenteditable') !== 'false') attachToField(el);
    });
  }

  function observeNewFields() {
    const observer = new MutationObserver((mutations) => {
      if (!isEnabled) return;
      for (const mutation of mutations) {
        // Watch for new nodes
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.matches && node.matches(EDITABLE_SELECTOR)) attachToField(node);
          if (node.querySelectorAll) {
            node.querySelectorAll(EDITABLE_SELECTOR).forEach(attachToField);
            node.querySelectorAll('[contenteditable]').forEach(el => {
              if (el.getAttribute('contenteditable') !== 'false') attachToField(el);
            });
          }
        }
        // Watch for contenteditable attribute being added
        if (mutation.type === 'attributes' && mutation.attributeName === 'contenteditable') {
          const el = mutation.target;
          if (el.getAttribute('contenteditable') !== 'false') attachToField(el);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['contenteditable'] });
  }

  function attachToField(field) {
    if (fieldStates.has(field)) return;
    if (!isEditable(field)) return;

    const fieldId = GC.generateFieldId();
    field.setAttribute('data-gc-id', fieldId);

    const state = {
      fieldId,
      lastText: '',
      lastHash: '',
      issues: [],
      backdrop: null,
      overlays: [],
      checking: false
    };
    fieldStates.set(field, state);

    log('Attached to field:', field.tagName, field.className?.substring(0, 50), fieldId);

    const debouncedCheck = GC.debounce(() => triggerCheck(field), GC.DEBOUNCE_DELAY);

    // Clear old underlines immediately on any input change
    field.addEventListener('input', () => {
      clearDecorations(field);
      debouncedCheck();
    });
    field.addEventListener('focus', debouncedCheck);
    field.addEventListener('keyup', () => {
      clearDecorations(field);
      debouncedCheck();
    });

    if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
      field.addEventListener('scroll', () => syncBackdropScroll(field));
    }
  }

  async function triggerCheck(field) {
    if (!isEnabled) return;
    const state = fieldStates.get(field);
    if (!state) return;

    const text = GC.getTextFromField(field);
    if (!text || text.length < 3) {
      clearDecorations(field);
      return;
    }
    if (text.length > GC.MAX_TEXT_LENGTH) return;

    const hash = GC.simpleHash(text);
    if (hash === state.lastHash) return;

    state.lastText = text;
    state.lastHash = hash;
    state.checking = true;

    log('Checking text:', text.substring(0, 50) + '...');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CHECK_TEXT',
        payload: { text, fieldId: state.fieldId }
      });

      state.checking = false;
      log('Response:', response);

      if (response && response.error) {
        log('Error:', response.message);
        return;
      }

      if (response && response.payload) {
        const currentText = GC.getTextFromField(field);
        if (currentText !== text) return;

        const { ignoredWords = [] } = await chrome.storage.sync.get({ ignoredWords: [] });
        let issues = response.payload.issues || [];
        issues = GC.validateAndFixOffsets(text, issues);
        issues = issues.filter(i => !ignoredWords.includes(i.original));
        state.issues = issues;

        log('Found', issues.length, 'issues');
        renderDecorations(field, issues);
      }
    } catch (e) {
      state.checking = false;
      log('Exception:', e.message);
    }
  }

  function renderDecorations(field, issues) {
    if (field.tagName === 'TEXTAREA') {
      renderTextareaBackdrop(field, issues);
    } else if (field.tagName === 'INPUT') {
      renderInputBackdrop(field, issues);
    } else {
      renderContentEditableOverlays(field, issues);
    }
  }

  function renderTextareaBackdrop(field, issues) {
    const state = fieldStates.get(field);
    if (!state) return;

    let backdrop = state.backdrop;
    if (!backdrop) {
      backdrop = createBackdrop(field);
      state.backdrop = backdrop;
    }

    const text = field.value;
    backdrop.innerHTML = buildHighlightedHtml(text, issues);
    syncBackdropStyles(field, backdrop);
    syncBackdropScroll(field);
  }

  function renderInputBackdrop(field, issues) {
    const state = fieldStates.get(field);
    if (!state) return;

    let backdrop = state.backdrop;
    if (!backdrop) {
      backdrop = createBackdrop(field);
      state.backdrop = backdrop;
    }

    const text = field.value;
    backdrop.innerHTML = buildHighlightedHtml(text, issues);
    syncBackdropStyles(field, backdrop);
  }

  function createBackdrop(field) {
    const backdrop = document.createElement('div');
    backdrop.setAttribute('data-gc-backdrop', 'true');
    backdrop.style.cssText = 'position:absolute;pointer-events:none;overflow:hidden;white-space:pre-wrap;word-wrap:break-word;';

    const parent = field.offsetParent || field.parentElement;
    if (parent && getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }

    field.parentElement.insertBefore(backdrop, field);
    field.style.background = 'transparent';
    field.style.position = 'relative';

    return backdrop;
  }

  function syncBackdropStyles(field, backdrop) {
    const cs = getComputedStyle(field);
    const rect = field.getBoundingClientRect();
    const parentRect = (field.offsetParent || field.parentElement).getBoundingClientRect();

    backdrop.style.top = (rect.top - parentRect.top) + 'px';
    backdrop.style.left = (rect.left - parentRect.left) + 'px';
    backdrop.style.width = rect.width + 'px';
    backdrop.style.height = rect.height + 'px';
    backdrop.style.padding = cs.padding;
    backdrop.style.border = cs.border;
    backdrop.style.borderColor = 'transparent';
    backdrop.style.fontFamily = cs.fontFamily;
    backdrop.style.fontSize = cs.fontSize;
    backdrop.style.fontWeight = cs.fontWeight;
    backdrop.style.lineHeight = cs.lineHeight;
    backdrop.style.letterSpacing = cs.letterSpacing;
    backdrop.style.wordSpacing = cs.wordSpacing;
    backdrop.style.textIndent = cs.textIndent;
    backdrop.style.boxSizing = cs.boxSizing;

    if (field.tagName === 'INPUT') {
      backdrop.style.whiteSpace = 'nowrap';
      backdrop.style.overflow = 'hidden';
    }
  }

  function syncBackdropScroll(field) {
    const state = fieldStates.get(field);
    if (state && state.backdrop) {
      state.backdrop.scrollTop = field.scrollTop;
      state.backdrop.scrollLeft = field.scrollLeft;
    }
  }

  function buildHighlightedHtml(text, issues) {
    if (!issues.length) return escapeHtml(text).replace(/\n$/g, '\n\n');

    const sorted = [...issues].sort((a, b) => a.offset - b.offset);
    let html = '';
    let lastIndex = 0;

    for (const issue of sorted) {
      if (issue.offset < lastIndex) continue;

      html += escapeHtml(text.substring(lastIndex, issue.offset));

      const color = GC.ISSUE_COLORS[issue.type] || GC.ISSUE_COLORS.grammar;
      const span = text.substring(issue.offset, issue.offset + issue.length);
      html += `<mark data-gc-issue-idx="${sorted.indexOf(issue)}" style="background:${color.bg};border-bottom:2px solid ${color.underline};border-radius:2px;color:transparent;">${escapeHtml(span)}</mark>`;

      lastIndex = issue.offset + issue.length;
    }

    html += escapeHtml(text.substring(lastIndex));
    return html.replace(/\n$/g, '\n\n');
  }

  function renderContentEditableOverlays(field, issues) {
    const state = fieldStates.get(field);
    if (!state) return;

    clearOverlays(state);

    if (!issues.length) return;

    // Create external overlay container (NOT inside the contenteditable)
    if (!state.overlayContainer) {
      const container = document.createElement('div');
      container.setAttribute('data-gc-overlay-external', 'true');
      container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483646;';
      document.body.appendChild(container);
      state.overlayContainer = container;
    }

    state.overlayContainer.innerHTML = '';

    const textNodes = getTextNodes(field);
    for (const issue of issues) {
      const range = createRangeForOffset(textNodes, issue.offset, issue.length);
      if (!range) continue;

      const rects = range.getClientRects();
      const color = GC.ISSUE_COLORS[issue.type] || GC.ISSUE_COLORS.grammar;

      for (const rect of rects) {
        const overlay = document.createElement('div');
        overlay.setAttribute('data-gc-overlay', 'true');
        overlay.style.cssText = `position:fixed;pointer-events:auto;cursor:pointer;left:${rect.left}px;top:${rect.top + rect.height - 2}px;width:${rect.width}px;height:2.5px;background:${color.underline};border-radius:1px;opacity:0.8;`;

        overlay.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          GC.FloatingCard.show(issue, rect, (iss, replacement) => applyFix(field, iss, replacement));
        });

        state.overlayContainer.appendChild(overlay);
        state.overlays.push(overlay);
      }
    }

    // Update underline positions on scroll
    if (!state.scrollHandler) {
      state.scrollHandler = () => repositionOverlays(field);
      field.addEventListener('scroll', state.scrollHandler);
      window.addEventListener('scroll', state.scrollHandler, true);
    }
  }

  function repositionOverlays(field) {
    const state = fieldStates.get(field);
    if (!state || !state.issues.length) return;
    // Re-render on scroll since fixed positions change
    renderContentEditableOverlays(field, state.issues);
  }

  function getTextNodes(el) {
    const nodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function createRangeForOffset(textNodes, offset, length) {
    let currentOffset = 0;
    let startNode = null, startOffset = 0;
    let endNode = null, endOffset = 0;

    for (const node of textNodes) {
      const nodeLen = node.textContent.length;
      if (!startNode && currentOffset + nodeLen > offset) {
        startNode = node;
        startOffset = offset - currentOffset;
      }
      if (startNode && currentOffset + nodeLen >= offset + length) {
        endNode = node;
        endOffset = offset + length - currentOffset;
        break;
      }
      currentOffset += nodeLen;
    }

    if (!startNode || !endNode) return null;

    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  }

  function applyFix(field, issue, replacement) {
    if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
      const before = field.value.substring(0, issue.offset);
      const after = field.value.substring(issue.offset + issue.length);
      field.value = before + replacement + after;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      const textNodes = getTextNodes(field);
      const range = createRangeForOffset(textNodes, issue.offset, issue.length);
      if (range) {
        range.deleteContents();
        range.insertNode(document.createTextNode(replacement));
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }

  function clearDecorations(field) {
    const state = fieldStates.get(field);
    if (!state) return;
    state.issues = [];
    if (state.backdrop) state.backdrop.innerHTML = '';
    clearOverlays(state);
  }

  function clearOverlays(state) {
    for (const ov of state.overlays) ov.remove();
    state.overlays = [];
    if (state.overlayContainer) {
      state.overlayContainer.innerHTML = '';
    }
  }

  function removeAllDecorations() {
    document.querySelectorAll('[data-gc-backdrop]').forEach(el => el.remove());
    document.querySelectorAll('[data-gc-overlay-external]').forEach(el => el.remove());
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Handle messages from side panel
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'APPLY_FIX') {
      const { fieldId, offset, length, replacement } = message.payload;
      const field = document.querySelector(`[data-gc-id="${fieldId}"]`);
      if (field) {
        applyFix(field, { offset, length }, replacement);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false });
      }
    }
  });

  // For textarea/input: click to show suggestion at caret position
  document.addEventListener('click', (e) => {
    const field = e.target;
    if (field.tagName !== 'TEXTAREA' && field.tagName !== 'INPUT') return;

    const state = fieldStates.get(field);
    if (!state || !state.issues.length) return;

    const cursorPos = field.selectionStart;
    const issue = state.issues.find(i => cursorPos >= i.offset && cursorPos <= i.offset + i.length);
    if (!issue) return;

    // Calculate position of the issue text using a hidden span measurement
    const rect = getCaretRect(field, issue.offset);
    if (rect) {
      GC.FloatingCard.show(issue, rect, (iss, replacement) => applyFix(field, iss, replacement));
    }
  });

  function getCaretRect(field, offset) {
    const backdrop = fieldStates.get(field)?.backdrop;
    if (backdrop) {
      const marks = backdrop.querySelectorAll('mark');
      for (const mark of marks) {
        const idx = parseInt(mark.dataset.gcIssueIdx);
        const issue = fieldStates.get(field)?.issues[idx];
        if (issue && issue.offset === offset) {
          return mark.getBoundingClientRect();
        }
      }
    }
    // Fallback: use field position
    const fieldRect = field.getBoundingClientRect();
    return { left: fieldRect.left + 10, right: fieldRect.left + 100, top: fieldRect.top, bottom: fieldRect.top + 20 };
  }

  document.addEventListener('mousedown', (e) => {
    if (e.target.closest && e.target.closest('#gc-card-host')) return;
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (e.target.closest && e.target.closest('[contenteditable]')) return;
    GC.FloatingCard.hide();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
