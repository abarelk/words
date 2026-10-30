'use strict';

const Util = {
  uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },

  now() {
    return new Date().toISOString();
  },

  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  },

  escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },

  shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },

  pick(a) {
    return a[Math.floor(Math.random() * a.length)];
  },

  chunk(a, size) {
    const out = [];
    for (let i = 0; i < a.length; i += size) out.push(a.slice(i, i + size));
    return out;
  },

  // Runs worker over items with at most `limit` in flight.
  async pool(items, limit, worker) {
    let next = 0;
    const run = async () => {
      while (next < items.length) await worker(items[next++]);
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  },

  // Answer comparison: case, curly quotes, punctuation and spacing are ignored.
  norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[‘’ʼ`]/g, "'")
      .replace(/[^a-z0-9'\-]/g, '')
      .replace(/^['\-]+|['\-]+$/g, '');
  },

  // Index of `answer` inside `en` as a whole word, or -1.
  findAnswer(en, answer) {
    if (!answer) return -1;
    const re = new RegExp(`(^|[^A-Za-z])(${Util.escapeRe(answer)})(?![A-Za-z])`, 'i');
    const m = re.exec(en);
    return m ? m.index + m[1].length : -1;
  },

  isPhrase(word) {
    return /\s/.test(String(word || '').trim());
  },

  // Best guess at where the target word or phrase sits in `en`. Handles
  // regular inflections ("abandoned", "gives up") and dictionary placeholders
  // such as one's / someone / something ("made up her mind").
  guessAnswer(en, word) {
    const target = String(word || '').trim();
    if (!target || !en) return '';
    const exact = Util.findAnswer(en, target);
    if (exact >= 0) return en.substr(exact, target.length);
    const PLACEHOLDER = /^(sb|sth|someone|somebody|something|one|one['’]s|oneself)$/i;
    const stems = target.split(/\s+/).map(p => {
      if (PLACEHOLDER.test(p)) return null;
      const n = Util.norm(p);
      return n.slice(0, Math.max(3, n.length - 2));
    });
    const toks = [...en.matchAll(/\S+/g)].map(m => {
      const lead = m[0].match(/^[^A-Za-z0-9]*/)[0].length;
      const core = m[0].replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
      return { core, start: m.index + lead, end: m.index + lead + core.length };
    });
    // Second pass, phrases only: the leading verb may be irregular
    // ("came up with", "made up her mind"), so only its first letter must match.
    const passes = stems.length > 1 && stems[0] ? [false, true] : [false];
    for (const loose of passes) {
      for (let i = 0; i + stems.length <= toks.length; i++) {
        const win = toks.slice(i, i + stems.length);
        const hit = win.every((t, k) => {
          if (!t.core) return false;
          if (stems[k] === null) return true;
          const n = Util.norm(t.core);
          return loose && k === 0 ? n[0] === stems[0][0] : n.startsWith(stems[k]);
        });
        if (hit) return en.slice(win[0].start, win[win.length - 1].end);
      }
    }
    return '';
  },

  download(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },

  safeFilename(name) {
    return String(name).replace(/[\\/:*?"<>|]+/g, '_').trim() || 'words';
  },

  stamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  },

  time(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  },
};
