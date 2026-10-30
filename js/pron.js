'use strict';

// Pronunciation: a speaker button that plays a recorded pronunciation and
// falls back to the browser's speech synthesis (always used for phrases).
// Recordings come from Wikimedia Commons ("En-us-<word>.ogg", the same files
// dictionaries mirror; MP3 transcodes first for Safari). IPA comes from the
// Free Dictionary API. Lookups are cached on the word, so later plays start
// instantly.
const Pron = (() => {
  const API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
  const COMMONS = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo&iiprop=url&titles=';
  const ACCENTS = ['us', 'uk', 'au'];
  const ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
  const pending = new Map();
  let audio = null;

  function dictUrl(word) {
    const slug = word.trim().toLowerCase().replace(/\s+/g, '-');
    return `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(slug)}`;
  }

  async function getJson(url) {
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // IPA (US first) plus any recordings the dictionary lists.
  async function fromDictionary(word) {
    const data = await getJson(API + encodeURIComponent(word));
    const entries = Array.isArray(data) ? data : [];
    const all = entries.flatMap(e => e.phonetics || []);
    const rank = p => ACCENTS.findIndex(a => new RegExp(`-${a}\\.mp3$`).test(p.audio || ''));
    const withAudio = all.filter(p => p.audio).sort((a, b) => (rank(a) + 9) % 9 - (rank(b) + 9) % 9);
    const ipa = (withAudio.find(p => p.text) || all.find(p => p.text) || {}).text || (entries[0] && entries[0].phonetic) || '';
    return { ipa, audio: withAudio.map(p => p.audio) };
  }

  // Recordings on Commons, US then UK then AU; MP3 transcode before the OGG.
  async function fromCommons(word) {
    const names = ACCENTS.map(a => `File:En-${a}-${word}.ogg`);
    const data = await getJson(COMMONS + encodeURIComponent(names.join('|')));
    const pages = Object.values((data && data.query && data.query.pages) || {});
    const out = [];
    for (const name of names) {
      const page = pages.find(p => p.title === name.replace(/_/g, ' '));
      const url = page && page.imageinfo && page.imageinfo[0] && page.imageinfo[0].url;
      if (!url) continue;
      const ogg = url.split('?')[0];
      const file = ogg.slice(ogg.lastIndexOf('/') + 1);
      out.push(`${ogg.replace('/wikipedia/commons/', '/wikipedia/commons/transcoded/')}/${file}.mp3`, ogg);
    }
    return out;
  }

  // -> { audio: [urls to try in order], ipa, checked }
  function lookup(w) {
    if (w.pron && w.pron.checked) return Promise.resolve(w.pron);
    if (Util.isPhrase(w.word)) {
      const pron = { audio: [], ipa: '', checked: true };
      Store.setPron(w.id, pron);
      return Promise.resolve(pron);
    }
    if (pending.has(w.id)) return pending.get(w.id);
    const word = w.word.trim().toLowerCase();
    const p = Promise.allSettled([fromCommons(word), fromDictionary(word)])
      .then(([commons, dict]) => {
        // Both failed (offline): use speech synthesis now and look up again next time.
        if (commons.status === 'rejected' && dict.status === 'rejected') return { audio: [], ipa: '', checked: false };
        const d = dict.status === 'fulfilled' ? dict.value : { ipa: '', audio: [] };
        const c = commons.status === 'fulfilled' ? commons.value : [];
        const pron = { audio: [...new Set([...c, ...d.audio])], ipa: d.ipa, checked: true };
        Store.setPron(w.id, pron);
        return pron;
      })
      .finally(() => pending.delete(w.id));
    pending.set(w.id, p);
    return p;
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) return false;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.9;
    const voice = speechSynthesis.getVoices().find(v => v.lang === 'en-US') || speechSynthesis.getVoices().find(v => /^en/i.test(v.lang));
    if (voice) u.voice = voice;
    speechSynthesis.speak(u);
    return true;
  }

  async function play(w, btn) {
    btn.classList.add('playing');
    const done = () => btn.classList.remove('playing');
    const pron = await lookup(w);
    for (const url of pron.audio) {
      try {
        if (audio) audio.pause();
        audio = new Audio(url);
        audio.addEventListener('ended', done, { once: true });
        await audio.play();
        return;
      } catch {
        // Unsupported format, missing file or blocked: try the next one.
      }
    }
    if (!speak(w.word)) UI.toast('이 브라우저는 발음 재생을 지원하지 않습니다.', 'error');
    setTimeout(done, 1200);
  }

  function ipaText(w) {
    return w.pron && w.pron.ipa ? w.pron.ipa : '';
  }

  // Speaker button + IPA + dictionary link for a saved word.
  function html(w) {
    return `<span class="pron">
      <button type="button" class="pron-btn" data-pron="${w.id}" aria-label="${Util.esc(w.word)} 발음 듣기" title="발음 듣기">${ICON}</button>
      <span class="ipa" data-ipa="${w.id}" lang="en">${Util.esc(ipaText(w))}</span>
      <a class="pron-link small" href="${dictUrl(w.word)}" target="_blank" rel="noopener">사전</a>
    </span>`;
  }

  // Fetch pronunciations for buttons now on screen so a tap plays at once
  // and the IPA shows up.
  function prefetch(root) {
    root.querySelectorAll('[data-pron]').forEach(btn => {
      const w = Store.findWord(btn.dataset.pron);
      if (!w) return;
      lookup(w).then(p => {
        root.querySelectorAll(`[data-ipa="${w.id}"]`).forEach(el => { el.textContent = p.ipa || ''; });
      });
    });
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-pron]');
    if (!btn) return;
    e.preventDefault();
    const w = Store.findWord(btn.dataset.pron);
    if (w) play(w, btn);
  });

  return { html, prefetch };
})();
