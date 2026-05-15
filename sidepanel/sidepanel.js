(function() {
  const port = chrome.runtime.connect({ name: 'sidepanel' });

  let currentResult = null;
  let currentText = '';
  let currentFieldId = '';

  port.onMessage.addListener((msg) => {
    if (msg.type === 'CHECK_RESULT') {
      currentResult = msg.payload;
      currentFieldId = msg.payload.fieldId;
      currentText = '';
      renderResults(msg.payload);
    }
  });

  function renderResults(data) {
    const { issues = [], readability, summary } = data;

    document.getElementById('summary').innerHTML = `
      <p class="summary-text">${escapeHtml(summary || 'Analysis complete')}</p>
      <div class="summary-counts">
        <span class="count count-error">${issues.filter(i => i.severity === 'error').length} errors</span>
        <span class="count count-warning">${issues.filter(i => i.severity === 'warning').length} warnings</span>
        <span class="count count-suggestion">${issues.filter(i => i.severity === 'suggestion').length} suggestions</span>
      </div>
    `;

    if (readability) {
      const circle = document.getElementById('readabilityCircle');
      const score = readability.score;
      circle.querySelector('span').textContent = score;
      circle.style.background = `conic-gradient(${getScoreColor(score)} ${score * 3.6}deg, #eee ${score * 3.6}deg)`;
    }

    const container = document.getElementById('issuesContainer');
    if (!issues.length) {
      container.innerHTML = '<div class="empty-state"><p>No issues found! Your text looks great.</p></div>';
      document.getElementById('fixAll').disabled = true;
      return;
    }

    document.getElementById('fixAll').disabled = false;

    const grouped = groupByType(issues);
    let html = '';
    for (const [type, items] of Object.entries(grouped)) {
      html += `<div class="issue-group">
        <h3 class="issue-group-title" style="border-left-color:${getTypeColor(type)}">${capitalize(type)} (${items.length})</h3>`;
      for (const issue of items) {
        html += `<div class="issue-card" data-offset="${issue.offset}" data-length="${issue.length}">
          <div class="issue-original">${escapeHtml(issue.original)}</div>
          <div class="issue-message">${escapeHtml(issue.message)}</div>
          <div class="issue-actions">
            ${issue.replacement ? `<button class="issue-fix" data-replacement="${escapeAttr(issue.replacement)}" data-offset="${issue.offset}" data-length="${issue.length}">${escapeHtml(issue.replacement)}</button>` : ''}
            ${(issue.alternatives || []).map(alt =>
              `<button class="issue-fix" data-replacement="${escapeAttr(alt)}" data-offset="${issue.offset}" data-length="${issue.length}">${escapeHtml(alt)}</button>`
            ).join('')}
          </div>
        </div>`;
      }
      html += '</div>';
    }
    container.innerHTML = html;

    container.querySelectorAll('.issue-fix').forEach(btn => {
      btn.addEventListener('click', () => {
        applyFixFromPanel(parseInt(btn.dataset.offset), parseInt(btn.dataset.length), btn.dataset.replacement);
      });
    });
  }

  async function applyFixFromPanel(offset, length, replacement) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'APPLY_FIX',
        payload: { fieldId: currentFieldId, offset, length, replacement }
      });
    }
  }

  document.getElementById('fixAll').addEventListener('click', async () => {
    if (!currentResult || !currentResult.issues) return;
    const fixes = [...currentResult.issues]
      .filter(i => i.replacement && (i.severity === 'error' || i.severity === 'warning'))
      .sort((a, b) => b.offset - a.offset);

    for (const fix of fixes) {
      await applyFixFromPanel(fix.offset, fix.length, fix.replacement);
      await new Promise(r => setTimeout(r, 100));
    }
  });

  // Manual text check
  document.getElementById('manualCheck').addEventListener('click', async () => {
    const text = document.getElementById('manualText').value.trim();
    if (!text) return;

    currentText = text;
    document.getElementById('manualCheck').textContent = 'Checking...';
    document.getElementById('manualCheck').disabled = true;

    const response = await chrome.runtime.sendMessage({
      type: 'CHECK_TEXT',
      payload: { text, fieldId: 'manual-sidepanel' }
    });

    document.getElementById('manualCheck').textContent = 'Check Text';
    document.getElementById('manualCheck').disabled = false;

    if (response && response.error) {
      document.getElementById('summary').innerHTML = `<p class="summary-text" style="color:#c62828;">Error: ${escapeHtml(response.message)}</p>`;
      return;
    }

    if (response && response.payload) {
      currentResult = response.payload;
      currentFieldId = 'manual-sidepanel';
      renderResults(response.payload);
    }
  });

  function groupByType(issues) {
    const groups = {};
    for (const issue of issues) {
      if (!groups[issue.type]) groups[issue.type] = [];
      groups[issue.type].push(issue);
    }
    return groups;
  }

  function getTypeColor(type) {
    const colors = {
      spelling: '#FF4444', grammar: '#FF4444', punctuation: '#FF9800',
      wordChoice: '#9C27B0', style: '#9C27B0', clarity: '#2196F3'
    };
    return colors[type] || '#999';
  }

  function getScoreColor(score) {
    if (score >= 70) return '#4CAF50';
    if (score >= 40) return '#FF9800';
    return '#FF4444';
  }

  function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }
  function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
  function escapeAttr(str) { return str.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
})();
