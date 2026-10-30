'use strict';

// Library = { app, version, updatedAt, activeBookId, books: [Book] }
// Book    = { id, name, createdAt, updatedAt, words: [Word], history: [{at,total,correct}] }
// Word    = { id, word, pos, meaning, context, mastery, correct, wrong,
//             sentences: [Sentence], createdAt, updatedAt, lastTestedAt }
// Sentence= { id, en, ko, answer, hints: [string] }
const Store = (() => {
  const APP_ID = 'words-trainer';
  const LIB_KEY = 'wordsapp.library.v1';
  const SET_KEY = 'wordsapp.settings.v1';
  const DEFAULT_SETTINGS = { apiKey: '', workspaceId: '', model: 'claude-opus-5-5', quizSize: 10 };

  let lib = null;
  let settings = null;

  function newBook(name) {
    const t = Util.now();
    return { id: Util.uid(), name, createdAt: t, updatedAt: t, words: [], history: [] };
  }

  function blankLibrary() {
    const b = newBook('기본 단어장');
    return { app: APP_ID, version: 1, updatedAt: Util.now(), activeBookId: b.id, books: [b] };
  }

  function normSentence(s) {
    return {
      id: s.id || Util.uid(),
      en: String(s.en || '').trim(),
      ko: String(s.ko || '').trim(),
      answer: String(s.answer || '').trim(),
      hints: Array.isArray(s.hints) ? s.hints.map(h => String(h).trim()).filter(Boolean) : [],
    };
  }

  function normWord(w) {
    const t = Util.now();
    return {
      id: w.id || Util.uid(),
      word: String(w.word || '').trim(),
      pos: String(w.pos || '').trim(),
      meaning: String(w.meaning || '').trim(),
      context: String(w.context || '').trim(),
      mastery: Math.max(0, parseInt(w.mastery, 10) || 0),
      correct: parseInt(w.correct, 10) || 0,
      wrong: parseInt(w.wrong, 10) || 0,
      sentences: (w.sentences || []).map(normSentence).filter(s => s.en),
      pron: w.pron && typeof w.pron === 'object'
        ? {
          audio: (Array.isArray(w.pron.audio) ? w.pron.audio : [w.pron.audio]).filter(Boolean).map(String),
          ipa: String(w.pron.ipa || ''),
          checked: !!w.pron.checked,
        }
        : null,
      createdAt: w.createdAt || t,
      updatedAt: w.updatedAt || t,
      lastTestedAt: w.lastTestedAt || null,
    };
  }

  function normBook(b) {
    const t = Util.now();
    return {
      id: b.id || Util.uid(),
      name: String(b.name || '단어장').trim(),
      createdAt: b.createdAt || t,
      updatedAt: b.updatedAt || t,
      words: (b.words || []).map(normWord).filter(w => w.word),
      history: Array.isArray(b.history) ? b.history.slice(-100) : [],
    };
  }

  function normLibrary(data) {
    if (!data || data.app !== APP_ID || !Array.isArray(data.books)) {
      throw new Error('단어 트레이너의 단어 파일이 아닙니다.');
    }
    const books = data.books.map(normBook);
    if (!books.length) books.push(newBook('기본 단어장'));
    const active = books.some(b => b.id === data.activeBookId) ? data.activeBookId : books[0].id;
    return { app: APP_ID, version: 1, updatedAt: data.updatedAt || Util.now(), activeBookId: active, books };
  }

  function load() {
    try {
      const raw = localStorage.getItem(LIB_KEY);
      lib = raw ? normLibrary(JSON.parse(raw)) : blankLibrary();
    } catch (e) {
      console.error('Library load failed', e);
      lib = blankLibrary();
    }
    try {
      settings = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SET_KEY) || '{}') };
    } catch {
      settings = { ...DEFAULT_SETTINGS };
    }
  }

  function persist() {
    try {
      localStorage.setItem(LIB_KEY, JSON.stringify(lib));
    } catch (e) {
      console.error(e);
      UI.toast('브라우저 저장 공간이 부족합니다. 단어장을 내보낸 뒤 정리해 주세요.', 'error');
    }
  }

  // Every mutation ends here: bump timestamp, save locally, sync linked file.
  function commit() {
    lib.updatedAt = Util.now();
    persist();
    FileLink.schedule();
  }

  function saveSettings(patch) {
    settings = { ...settings, ...patch };
    localStorage.setItem(SET_KEY, JSON.stringify(settings));
  }

  // ---- books ----
  function activeBook() {
    return lib.books.find(b => b.id === lib.activeBookId) || lib.books[0];
  }

  function setActiveBook(id) {
    if (lib.books.some(b => b.id === id)) {
      lib.activeBookId = id;
      commit();
    }
  }

  function createBook(name) {
    const b = newBook(name);
    lib.books.push(b);
    lib.activeBookId = b.id;
    commit();
    return b;
  }

  function renameBook(id, name) {
    const b = lib.books.find(x => x.id === id);
    if (b) {
      b.name = name;
      b.updatedAt = Util.now();
      commit();
    }
  }

  function deleteBook(id) {
    lib.books = lib.books.filter(b => b.id !== id);
    if (!lib.books.length) lib.books.push(newBook('기본 단어장'));
    if (!lib.books.some(b => b.id === lib.activeBookId)) lib.activeBookId = lib.books[0].id;
    commit();
  }

  function addHistory(entry) {
    const b = activeBook();
    b.history.push({ at: Util.now(), ...entry });
    b.history = b.history.slice(-100);
    commit();
  }

  // ---- words ----
  function findWord(id) {
    for (const b of lib.books) {
      const w = b.words.find(x => x.id === id);
      if (w) return w;
    }
    return null;
  }

  function bookOfWord(id) {
    return lib.books.find(b => b.words.some(w => w.id === id)) || null;
  }

  function addWords(list) {
    const b = activeBook();
    const added = list.map(normWord);
    b.words.push(...added);
    b.updatedAt = Util.now();
    commit();
    return added;
  }

  function updateWord(id, patch) {
    const w = findWord(id);
    if (!w) return;
    Object.assign(w, patch, { updatedAt: Util.now() });
    commit();
  }

  // Cached lookup, not a user edit: leave updatedAt alone so imports still
  // prefer the copy the learner actually changed last.
  function setPron(id, pron) {
    const w = findWord(id);
    if (!w) return;
    w.pron = pron;
    commit();
  }

  function deleteWord(id) {
    const b = bookOfWord(id);
    if (!b) return;
    b.words = b.words.filter(w => w.id !== id);
    commit();
  }

  // Same spelling, different sense in the same book -> show the context hint.
  function hasSiblings(word) {
    const b = bookOfWord(word.id);
    if (!b) return false;
    const key = word.word.toLowerCase();
    return b.words.some(w => w.id !== word.id && w.word.toLowerCase() === key);
  }

  function addSentences(wordId, sentences) {
    const w = findWord(wordId);
    if (!w) return;
    w.sentences.push(...sentences.map(normSentence));
    w.updatedAt = Util.now();
    commit();
  }

  function updateSentence(wordId, sentenceId, patch) {
    const w = findWord(wordId);
    const s = w && w.sentences.find(x => x.id === sentenceId);
    if (!s) return;
    Object.assign(s, normSentence({ ...s, ...patch }));
    w.updatedAt = Util.now();
    commit();
  }

  function deleteSentence(wordId, sentenceId) {
    const w = findWord(wordId);
    if (!w) return;
    w.sentences = w.sentences.filter(s => s.id !== sentenceId);
    w.updatedAt = Util.now();
    commit();
  }

  // Correct: +1, wrong: -1 (never below 0).
  function recordAnswer(wordId, correct) {
    const w = findWord(wordId);
    if (!w) return { before: 0, after: 0 };
    const before = w.mastery;
    w.mastery = correct ? before + 1 : Math.max(0, before - 1);
    if (correct) w.correct++;
    else w.wrong++;
    w.lastTestedAt = w.updatedAt = Util.now();
    commit();
    return { before, after: w.mastery };
  }

  // ---- files ----
  function exportBook(id) {
    const b = lib.books.find(x => x.id === id);
    return { app: APP_ID, version: 1, updatedAt: Util.now(), activeBookId: b.id, books: [b] };
  }

  function exportAll() {
    return lib;
  }

  // Merge another library/book file in. Words are matched by id; newer wins.
  function importData(data) {
    const incoming = normLibrary(data);
    const result = { books: 0, added: 0, updated: 0 };
    for (const ib of incoming.books) {
      const b = lib.books.find(x => x.id === ib.id);
      if (!b) {
        lib.books.push(ib);
        result.books++;
        result.added += ib.words.length;
        continue;
      }
      for (const iw of ib.words) {
        const i = b.words.findIndex(x => x.id === iw.id);
        if (i < 0) {
          b.words.push(iw);
          result.added++;
        } else if (iw.updatedAt > b.words[i].updatedAt) {
          b.words[i] = iw;
          result.updated++;
        }
      }
      const seen = new Set(b.history.map(h => h.at));
      b.history = [...b.history, ...ib.history.filter(h => !seen.has(h.at))]
        .sort((x, y) => (x.at < y.at ? -1 : 1))
        .slice(-100);
    }
    commit();
    return result;
  }

  // Replace everything with a library loaded from the linked file.
  function replaceLibrary(data) {
    lib = normLibrary(data);
    persist();
  }

  return {
    load, saveSettings,
    get lib() { return lib; },
    get settings() { return settings; },
    activeBook, setActiveBook, createBook, renameBook, deleteBook, addHistory,
    findWord, addWords, updateWord, setPron, deleteWord, hasSiblings,
    addSentences, updateSentence, deleteSentence, recordAnswer,
    exportBook, exportAll, importData, replaceLibrary,
  };
})();

// Optional auto-save into a JSON file on disk (File System Access API:
// Chrome/Edge on desktop). The file handle is remembered in IndexedDB.
const FileLink = (() => {
  const supported = typeof window.showSaveFilePicker === 'function';
  const PICKER_TYPES = [{ description: '단어 파일', accept: { 'application/json': ['.json'] } }];
  let handle = null;
  let state = 'none'; // none | linked | needs-permission | error
  let error = '';
  let lastSaved = null;
  let timer = null;
  let writing = false;
  let pending = false;
  const listeners = new Set();

  function notify() {
    listeners.forEach(fn => fn());
  }

  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('wordsapp', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('kv', mode);
        const req = fn(tx.objectStore('kv'));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
      };
    });
  }

  const saveHandle = h => idb('readwrite', s => s.put(h, 'fileHandle'));
  const loadHandle = () => idb('readonly', s => s.get('fileHandle'));
  const clearHandle = () => idb('readwrite', s => s.delete('fileHandle'));

  async function readFile() {
    const text = await (await handle.getFile()).text();
    if (!text.trim()) return null;
    return JSON.parse(text);
  }

  // On (re)connect: whichever side was changed last wins.
  async function sync() {
    const data = await readFile().catch(() => null);
    if (data && data.updatedAt && data.updatedAt > Store.lib.updatedAt) {
      Store.replaceLibrary(data);
      state = 'linked';
      lastSaved = new Date();
      notify();
      return 'loaded';
    }
    await write();
    return 'saved';
  }

  async function init() {
    if (!supported) return;
    try {
      handle = await loadHandle();
      if (!handle) return;
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') return await sync();
      state = 'needs-permission';
    } catch (e) {
      state = 'error';
      error = e.message;
    }
    notify();
  }

  async function reconnect() {
    const perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') throw new Error('파일 접근 권한이 필요합니다.');
    return sync();
  }

  async function createNew() {
    handle = await window.showSaveFilePicker({
      suggestedName: `words-library-${Util.stamp()}.json`,
      types: PICKER_TYPES,
    });
    await saveHandle(handle);
    await write();
  }

  // Open an existing file: merge its contents with local data, then save back.
  async function openExisting() {
    const [h] = await window.showOpenFilePicker({ types: PICKER_TYPES });
    const perm = await h.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') throw new Error('파일 접근 권한이 필요합니다.');
    handle = h;
    const data = await readFile();
    const result = data ? Store.importData(data) : null;
    await saveHandle(handle);
    await write();
    return result;
  }

  async function unlink() {
    handle = null;
    state = 'none';
    clearTimeout(timer);
    await clearHandle().catch(() => {});
    notify();
  }

  function schedule() {
    if (state !== 'linked' || !handle) return;
    clearTimeout(timer);
    timer = setTimeout(write, 700);
  }

  async function write() {
    if (!handle) return;
    if (writing) {
      pending = true;
      return;
    }
    writing = true;
    try {
      const w = await handle.createWritable();
      await w.write(JSON.stringify(Store.exportAll(), null, 2));
      await w.close();
      lastSaved = new Date();
      state = 'linked';
      error = '';
    } catch (e) {
      state = e.name === 'NotAllowedError' ? 'needs-permission' : 'error';
      error = e.message;
    } finally {
      writing = false;
      notify();
      if (pending) {
        pending = false;
        write();
      }
    }
  }

  return {
    supported, init, reconnect, createNew, openExisting, unlink, schedule,
    get state() { return state; },
    get error() { return error; },
    get fileName() { return handle ? handle.name : ''; },
    get lastSaved() { return lastSaved; },
    onChange(fn) { listeners.add(fn); },
  };
})();
