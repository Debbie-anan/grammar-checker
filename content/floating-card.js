var GC = window.GC || {};

GC.CARD_STYLES = `
  .gc-card {
    position: fixed;
    z-index: 2147483647;
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15), 0 1px 4px rgba(0,0,0,0.08);
    padding: 12px 14px;
    max-width: 340px;
    min-width: 240px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    color: #333;
    line-height: 1.4;
    pointer-events: auto;
    animation: gc-fade-in 0.15s ease;
  }

  @keyframes gc-fade-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .gc-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .gc-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    text-transform: capitalize;
  }

  .gc-badge--spelling, .gc-badge--grammar { background: rgba(255,68,68,0.1); color: #d32f2f; }
  .gc-badge--punctuation { background: rgba(255,152,0,0.1); color: #e65100; }
  .gc-badge--wordChoice, .gc-badge--style { background: rgba(156,39,176,0.1); color: #7b1fa2; }
  .gc-badge--clarity { background: rgba(33,150,243,0.1); color: #1565c0; }
  .gc-badge--tone { background: rgba(0,188,212,0.1); color: #00838f; }

  .gc-dismiss {
    width: 20px;
    height: 20px;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 16px;
    color: #999;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .gc-dismiss:hover { background: #f0f0f0; color: #333; }

  .gc-card-message {
    margin-bottom: 10px;
    color: #555;
    font-size: 12.5px;
  }

  .gc-card-original {
    margin-bottom: 8px;
    padding: 6px 8px;
    background: #fff3f3;
    border-radius: 4px;
    font-size: 12px;
    color: #c62828;
    text-decoration: line-through;
  }

  .gc-card-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }

  .gc-accept {
    padding: 5px 12px;
    border: 1px solid #4CAF50;
    border-radius: 14px;
    background: #e8f5e9;
    color: #2e7d32;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .gc-accept:hover { background: #4CAF50; color: #fff; }

  .gc-card-footer {
    display: flex;
    gap: 8px;
    border-top: 1px solid #f0f0f0;
    padding-top: 8px;
  }

  .gc-ignore {
    background: none;
    border: none;
    font-size: 11px;
    color: #999;
    cursor: pointer;
    padding: 2px 4px;
  }

  .gc-ignore:hover { color: #333; text-decoration: underline; }
`;

GC.FloatingCard = {
  _host: null,
  _shadow: null,
  _card: null,
  _currentIssue: null,
  _onApply: null,

  init() {
    if (this._host) return;
    this._host = document.createElement('div');
    this._host.id = 'gc-card-host';
    this._host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    document.body.appendChild(this._host);
    this._shadow = this._host.attachShadow({ mode: 'closed' });

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(GC.CARD_STYLES);
    this._shadow.adoptedStyleSheets = [sheet];
  },

  show(issue, rect, onApply) {
    this.hide();
    this._currentIssue = issue;
    this._onApply = onApply;

    const card = document.createElement('div');
    card.className = 'gc-card';

    const top = rect.bottom + 6;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 360));
    card.style.left = left + 'px';
    card.style.top = top + 'px';

    if (top + 200 > window.innerHeight) {
      card.style.top = (rect.top - 10) + 'px';
      card.style.transform = 'translateY(-100%)';
    }

    card.innerHTML = `
      <div class="gc-card-header">
        <span class="gc-badge gc-badge--${issue.type}">${issue.type}</span>
        <button class="gc-dismiss">&times;</button>
      </div>
      <p class="gc-card-message">${this._escapeHtml(issue.message)}</p>
      <div class="gc-card-original">${this._escapeHtml(issue.original)}</div>
      <div class="gc-card-actions">
        <button class="gc-accept" data-replacement="${this._escapeAttr(issue.replacement)}">${this._escapeHtml(issue.replacement)}</button>
        ${(issue.alternatives || []).map(alt =>
          `<button class="gc-accept" data-replacement="${this._escapeAttr(alt)}">${this._escapeHtml(alt)}</button>`
        ).join('')}
      </div>
      <div class="gc-card-footer">
        <button class="gc-ignore">Ignore</button>
        <button class="gc-ignore gc-ignore-all">Ignore all</button>
      </div>
    `;

    card.querySelector('.gc-dismiss').addEventListener('click', () => this.hide());
    card.querySelectorAll('.gc-accept').forEach(btn => {
      btn.addEventListener('click', () => {
        if (this._onApply) this._onApply(issue, btn.dataset.replacement);
        this.hide();
      });
    });
    card.querySelector('.gc-ignore').addEventListener('click', () => this.hide());
    card.querySelector('.gc-ignore-all').addEventListener('click', () => {
      this._addToIgnoreList(issue.original);
      this.hide();
    });

    this._shadow.appendChild(card);
    this._card = card;
  },

  hide() {
    if (this._card) {
      this._card.remove();
      this._card = null;
    }
    this._currentIssue = null;
  },

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  _escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  async _addToIgnoreList(word) {
    const { ignoredWords = [] } = await chrome.storage.sync.get({ ignoredWords: [] });
    if (!ignoredWords.includes(word)) {
      ignoredWords.push(word);
      await chrome.storage.sync.set({ ignoredWords });
    }
  }
};

window.GC = GC;
