'use strict';

const UI = (() => {
  let timer = null;
  function toast(msg, kind = 'info') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast ${kind}`;
    el.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => { el.hidden = true; }, 3500);
  }
  return { toast };
})();

const App = (() => {
  const { esc } = Util;
  const views = {};

  let session = null;     // running quiz
  let lastResult = null;  // finished quiz, shown on #/result
  let editingSentence = null;
  const add = { text: '', running: false, senses: [], failed: [], done: 0, total: 0 };
  const list = { q: '', sort: 'mastery' };

  // ---------- routing ----------
  function parseHash() {
    const [, name = 'home', arg = ''] = (location.hash || '#/home').split('/');
    return { name: views[name] ? name : 'home', arg: decodeURIComponent(arg) };
  }

  function render() {
    const { name, arg } = parseHash();
    const v = views[name];
    const html = v.render(arg);
    if (html == null) return; // view redirected
    document.body.classList.toggle('in-quiz', name === 'quiz');
    document.querySelectorAll('[data-nav]').forEach(a => {
      const on = a.dataset.nav === name || (name === 'word' && a.dataset.nav === 'words');
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    // Fresh element each time so listeners from the previous view don't pile up.
    const old = document.getElementById('view');
    const root = old.cloneNode(false);
    old.replaceWith(root);
    root.innerHTML = html;
    if (v.bind) v.bind(root, arg);
    Pron.prefetch(root);
    window.scrollTo(0, 0);
    renderBanner();
  }

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  // ---------- shared bits ----------
  function bookPicker() {
    const lib = Store.lib;
    return `<label class="book-picker">
      <span>단어장</span>
      <select data-role="book">${lib.books.map(b => `<option value="${b.id}" ${b.id === lib.activeBookId ? 'selected' : ''}>${esc(b.name)} (${b.words.length})</option>`).join('')}</select>
    </label>`;
  }

  function bindBookPicker(root) {
    const sel = root.querySelector('[data-role=book]');
    if (sel) sel.addEventListener('change', () => { Store.setActiveBook(sel.value); render(); });
  }

  function metric(label, value) {
    return `<div class="metric"><span>${label}</span><b>${value}</b></div>`;
  }

  function masteryBadge(m) {
    return `<span class="badge lv${Math.min(m, 5)}" title="익힘도">${m}</span>`;
  }

  function pills(words) {
    return words.map(h => `<span class="pill" lang="en">${esc(h)}</span>`).join(' ');
  }

  function renderBanner() {
    const el = document.getElementById('banner');
    if (FileLink.state === 'needs-permission') {
      el.innerHTML = `<div class="banner">단어 파일 <b>${esc(FileLink.fileName)}</b>에 자동 저장이 멈춰 있습니다. <button class="btn sm" data-act="relink">다시 연결</button></div>`;
    } else if (FileLink.state === 'error') {
      el.innerHTML = `<div class="banner error">단어 파일에 저장하지 못했습니다: ${esc(FileLink.error)} <button class="btn sm" data-act="relink">다시 연결</button></div>`;
    } else {
      el.innerHTML = '';
    }
    const btn = el.querySelector('[data-act=relink]');
    if (btn) btn.addEventListener('click', relink);
  }

  async function relink() {
    try {
      const r = await FileLink.reconnect();
      UI.toast(r === 'loaded' ? '단어 파일에서 최신 데이터를 불러왔습니다.' : '단어 파일에 다시 연결했습니다.');
      render();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  }

  // ---------- home ----------
  views.home = {
    render() {
      const b = Store.activeBook();
      const ws = b.words;
      const n = ws.length;
      const size = Math.min(Store.settings.quizSize, n);
      const avg = n ? (ws.reduce((s, w) => s + w.mastery, 0) / n).toFixed(1) : '0';
      const zero = ws.filter(w => !w.mastery).length;
      const last = b.history[b.history.length - 1];
      const buckets = [0, 1, 2, 3, 4, 5].map(m => ws.filter(w => (m < 5 ? w.mastery === m : w.mastery >= 5)).length);
      const max = Math.max(1, ...buckets);
      return `<section class="page">
        <div class="page-head"><h1>홈</h1>${bookPicker()}</div>
        <div class="metrics">
          ${metric('등록 단어', n)}
          ${metric('평균 익힘도', avg)}
          ${metric('익힘도 0', zero)}
          ${metric('최근 테스트', last ? `${last.correct}/${last.total}` : '-')}
        </div>
        ${n ? `<div class="card cta">
            <button class="btn primary lg" data-act="start">테스트 시작 · ${size}문제</button>
            <p class="muted small">익힘도가 낮은 단어부터 출제하고, 익힘도가 같으면 무작위로 고릅니다. 맞히면 +1, 틀리면 -1.</p>
          </div>
          <div class="card">
            <h2>익힘도 분포</h2>
            <div class="dist">${buckets.map((c, i) => `
              <div class="dist-row">
                <span class="dist-label">${i < 5 ? i : '5+'}</span>
                <span class="dist-bar"><span style="width:${(c / max) * 100}%"></span></span>
                <span class="dist-n">${c}</span>
              </div>`).join('')}
            </div>
          </div>`
        : `<div class="card empty">
            <h2>첫 단어를 등록해 보세요</h2>
            <p class="muted">단어를 여러 개 한꺼번에 넣으면 뜻, 예문, 문제가 자동으로 만들어집니다.</p>
            <a class="btn primary" href="#/add">단어 등록</a>
          </div>`}
      </section>`;
    },
    bind(root) {
      bindBookPicker(root);
      const start = root.querySelector('[data-act=start]');
      if (start) start.addEventListener('click', () => startQuiz(Store.activeBook().words));
    },
  };

  // ---------- add words ----------
  function parseBulk(text) {
    const seen = new Set();
    const items = [];
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      let word = t;
      let meaning = '';
      const m = t.match(/^(.+?)\s*(?:=|\t)\s*(.+)$/);
      if (m) {
        word = m[1].trim();
        meaning = m[2].trim();
      }
      // Parentheses describe the intended sense or situation: "bank (river)".
      // In the word part they are always a note; in the meaning part only a
      // trailing one is, since glosses like "(생각을) 내놓다" use them too.
      const notes = [];
      word = word.replace(/\s*[(（]([^()（）]*)[)）]\s*/g, (_, n) => {
        if (n.trim()) notes.push(n.trim());
        return ' ';
      }).replace(/\s+/g, ' ').trim();
      const tail = meaning.match(/^(.*?\S)\s*[(（]([^()（）]*)[)）]$/);
      if (tail) {
        meaning = tail[1].trim();
        if (tail[2].trim()) notes.push(tail[2].trim());
      }
      if (!word) continue;
      const note = notes.join('; ');
      const key = `${word.toLowerCase()}|${meaning}|${note}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ word, meaning, note });
    }
    return items;
  }

  // Senses of this headword already saved in the active book.
  function existingSenses(word) {
    const key = word.trim().toLowerCase();
    return Store.activeBook().words
      .filter(w => w.word.toLowerCase() === key)
      .map(w => ({ meaning: w.meaning, context: w.context }));
  }

  function sameMeaning(a, b) {
    const k = s => String(s || '').replace(/[\s,·;()（）]/g, '');
    const x = k(a);
    const y = k(b);
    return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
  }

  // `list` is the existing-sense list Claude saw; `s.sameAs` indexes into it.
  // Without Claude's verdict (manual entry) fall back to comparing meanings.
  function markDuplicate(s, list = existingSenses(s.word)) {
    s.existing = existingSenses(s.word);
    if (Number.isInteger(s.sameAs)) {
      s.dupOf = s.sameAs >= 0 ? list[s.sameAs] || null : null;
    } else {
      s.dupOf = s.existing.find(e => sameMeaning(e.meaning, s.meaning) || (s.context && e.context === s.context)) || null;
    }
    // Also catch the same sense twice in this batch (not saved yet).
    if (!s.dupOf) {
      const key = s.word.toLowerCase();
      const twin = add.senses.find(x => x !== s && x.word.toLowerCase() === key && sameMeaning(x.meaning, s.meaning));
      if (twin) s.dupOf = { meaning: twin.meaning, context: twin.context, preview: true };
    }
    s.checked = !s.dupOf;
    return s;
  }

  async function runGenerate(items) {
    add.running = true;
    add.failed = [];
    add.done = 0;
    add.total = items.length;
    renderAddResults();
    const withExisting = items.map(it => ({ ...it, existing: existingSenses(it.word) }));
    await Util.pool(Util.chunk(withExisting, 5), 3, async ch => {
      try {
        const res = await Claude.generateWords(ch);
        res.forEach((e, i) => {
          if (!e.senses.length) {
            add.failed.push({ items: [ch[i]], error: '생성 결과가 비어 있습니다.' });
            return;
          }
          e.senses.forEach(s => add.senses.push(markDuplicate({ ...s }, ch[i].existing)));
        });
      } catch (err) {
        add.failed.push({ items: ch, error: err.message });
      }
      add.done += ch.length;
      renderAddResults();
    });
    add.running = false;
    renderAddResults();
  }

  // Ask Claude for a commonly used sense that isn't registered yet, and put
  // it in place of the duplicate card.
  async function findOtherSense(s) {
    if (!Store.settings.apiKey) {
      UI.toast('다른 뜻을 찾으려면 설정에서 Claude API 키를 입력하세요.', 'error');
      return;
    }
    const key = s.word.toLowerCase();
    const list = [
      ...existingSenses(s.word),
      ...add.senses.filter(x => x !== s && x.word.toLowerCase() === key).map(x => ({ meaning: x.meaning, context: x.context })),
    ];
    s.finding = true;
    renderAddResults();
    try {
      const [e] = await Claude.generateWords([{ word: s.word, meaning: '', note: '', existing: list, excludeExisting: true }]);
      const found = e.senses.filter(x => x.sameAs < 0).map(x => markDuplicate({ ...x }, list));
      if (found.length) {
        add.senses.splice(add.senses.indexOf(s), 1, ...found);
        UI.toast(`"${s.word}"의 새 뜻 ${found.length}개를 찾았습니다.`);
      } else {
        s.noOther = true;
        UI.toast('이미 등록된 뜻 말고 자주 쓰이는 다른 뜻을 찾지 못했습니다.');
      }
    } catch (err) {
      UI.toast(err.message, 'error');
    }
    s.finding = false;
    renderAddResults();
  }

  function dupNote(s) {
    const fmt = e => `${esc(e.meaning)}${e.context ? ` (${esc(e.context)})` : ''}`;
    if (s.dupOf) {
      const action = s.finding
        ? '<span class="small">다른 뜻을 찾는 중…</span>'
        : s.noOther
          ? '<span class="small">자주 쓰이는 다른 뜻이 없습니다.</span>'
          : '<button class="btn sm" data-act="find-other">다른 뜻으로 추가</button>';
      return `<div class="dup-note dup">
        <p><b>중복</b> ${s.dupOf.preview ? '이번에 함께 등록하려는 항목과 뜻이 같습니다' : '이미 같은 뜻으로 등록되어 있습니다'}: ${fmt(s.dupOf)}</p>
        <p class="small">그대로 두면 등록하지 않습니다. 다른 의미로 추가하려면 "다른 뜻으로 추가"를, 그래도 등록하려면 위의 체크를 켜세요.</p>
        <div class="row gap-sm">${action}</div>
      </div>`;
    }
    if (s.existing && s.existing.length) {
      return `<div class="dup-note same">
        <p><b>같은 단어 있음</b> 이미 ${s.existing.map(fmt).join(', ')} 뜻으로 등록되어 있습니다. 이 항목은 다른 의미로 추가됩니다.</p>
      </div>`;
    }
    return '';
  }

  function senseCard(s, i) {
    const label = s.dupOf ? '그래도 등록' : s.existing && s.existing.length ? '새 뜻으로 등록' : '등록';
    return `<article class="card sense ${s.checked ? '' : 'off'}" data-i="${i}">
      <div class="sense-head">
        <label class="check-label"><input type="checkbox" data-f="checked" ${s.checked ? 'checked' : ''}><span>${label}</span></label>
        <input class="word-inp" data-f="word" value="${esc(s.word)}" lang="en" aria-label="단어 또는 구문" autocapitalize="off" spellcheck="false">
        ${s.dupOf ? '<span class="tag tag-warn">중복</span>' : s.existing && s.existing.length ? '<span class="tag">같은 단어 · 새 뜻</span>' : ''}
      </div>
      ${dupNote(s)}
      <div class="grid3">
        <label class="fld"><span>뜻</span><input data-f="meaning" value="${esc(s.meaning)}"></label>
        <label class="fld"><span>품사</span><input data-f="pos" value="${esc(s.pos)}"></label>
        <label class="fld"><span>상황 힌트</span><input data-f="context" value="${esc(s.context)}"></label>
      </div>
      ${s.sentences.length ? `<ul class="sent-list">${s.sentences.map((x, j) => `
        <li>
          <div class="sent-text">
            <p lang="en">${Quiz.highlight(x.en, x.answer)}</p>
            <p class="muted small">${esc(x.ko)}</p>
            ${x.hints.length ? `<p class="small">힌트 ${pills(x.hints)}</p>` : ''}
          </div>
          <button class="btn ghost sm" data-act="del-sent" data-j="${j}">삭제</button>
        </li>`).join('')}</ul>`
      : '<p class="muted small">예문이 없어 "뜻 보고 단어 쓰기" 문제만 나옵니다. 저장한 뒤 단어 목록에서 예문을 추가할 수 있습니다.</p>'}
    </article>`;
  }

  function renderAddResults() {
    const box = document.getElementById('add-results');
    if (!box) return;
    const parts = [];
    if (add.running) {
      parts.push(`<div class="card progress-card"><span class="spinner" aria-hidden="true"></span><span>Claude가 뜻과 예문을 만드는 중… ${add.done} / ${add.total}</span></div>`);
    }
    if (add.failed.length) {
      parts.push(`<div class="notice error">
        ${add.failed.map(f => `<p><b lang="en">${esc(f.items.map(x => x.word).join(', '))}</b> ${esc(f.error)}</p>`).join('')}
        ${add.running ? '' : '<button class="btn sm" data-act="retry">실패한 단어 다시 생성</button>'}
      </div>`);
    }
    if (add.senses.length) {
      const n = add.senses.filter(s => s.checked).length;
      parts.push(`<div class="row between section-head">
          <h2>미리보기 · ${add.senses.length}개</h2>
          <button class="btn ghost sm" data-act="clear">모두 지우기</button>
        </div>
        ${add.senses.map(senseCard).join('')}
        <div class="save-bar"><button class="btn primary lg" data-act="save" ${add.running || !n ? 'disabled' : ''}>${n}개 단어 저장</button></div>`);
    }
    box.innerHTML = parts.join('');
  }

  views.add = {
    render() {
      const hasKey = !!Store.settings.apiKey;
      return `<section class="page">
        <div class="page-head"><h1>단어 등록</h1>${bookPicker()}</div>
        ${hasKey ? '' : `<div class="notice warn">Claude API 키가 없어 자동 생성을 쓸 수 없습니다. <a href="#/settings">설정</a>에서 키를 입력하세요. 키 없이 쓰려면 <code>단어 = 뜻</code> 형식으로 입력하고 "생성 없이 추가"를 누르세요.</div>`}
        <div class="card">
          <label class="field-label" for="bulk">한 줄에 단어나 구문을 하나씩 입력하세요. 뜻을 하나로 정하려면 <code>yield = 양보하다</code>처럼 쓰고, 괄호 안에는 뜻이나 상황을 설명하는 메모를 쓸 수 있습니다(<code>bank (river)</code>). 뜻을 정하지 않은 단어는 뜻별로 나눠 등록됩니다.</label>
          <textarea id="bulk" rows="8" lang="en" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="abandon&#10;come up with&#10;yield = 양보하다&#10;bank (강가, 지형)">${esc(add.text)}</textarea>
          <p class="field-error" data-role="err" hidden></p>
          <div class="row end">
            <button class="btn" data-act="manual">생성 없이 추가</button>
            <button class="btn primary" data-act="gen">문제 자동 생성</button>
          </div>
        </div>
        <div id="add-results"></div>
      </section>`;
    },
    bind(root) {
      bindBookPicker(root);
      const ta = root.querySelector('#bulk');
      const err = root.querySelector('[data-role=err]');
      const showErr = msg => { err.textContent = msg; err.hidden = false; };
      ta.addEventListener('input', () => { add.text = ta.value; err.hidden = true; });

      root.querySelector('[data-act=gen]').addEventListener('click', () => {
        if (add.running) return;
        const items = parseBulk(add.text);
        if (!items.length) return showErr('단어를 한 개 이상 입력하세요.');
        if (items.length > 100) return showErr('한 번에 100개까지 생성할 수 있습니다.');
        if (!Store.settings.apiKey) return showErr('자동 생성에는 Claude API 키가 필요합니다. 설정에서 입력하세요.');
        runGenerate(items);
      });

      root.querySelector('[data-act=manual]').addEventListener('click', () => {
        const items = parseBulk(add.text);
        if (!items.length) return showErr('단어를 한 개 이상 입력하세요.');
        const ok = items.filter(x => x.meaning);
        if (!ok.length) return showErr('생성 없이 추가하려면 "단어 = 뜻" 형식으로 뜻을 함께 입력하세요.');
        ok.forEach(x => add.senses.push(markDuplicate({ word: x.word, pos: '', meaning: x.meaning, context: x.note, sentences: [] })));
        if (ok.length < items.length) UI.toast(`뜻이 없는 ${items.length - ok.length}개 단어는 건너뛰었습니다.`);
        renderAddResults();
      });

      const box = root.querySelector('#add-results');
      box.addEventListener('input', e => {
        const f = e.target.dataset.f;
        const card = e.target.closest('.sense');
        if (!f || !card) return;
        const s = add.senses[+card.dataset.i];
        if (f === 'checked') {
          s.checked = e.target.checked;
          renderAddResults();
        } else {
          s[f] = e.target.value;
        }
      });
      box.addEventListener('click', e => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === 'find-other') {
          findOtherSense(add.senses[+btn.closest('.sense').dataset.i]);
        } else if (act === 'del-sent') {
          const s = add.senses[+btn.closest('.sense').dataset.i];
          s.sentences.splice(+btn.dataset.j, 1);
          renderAddResults();
        } else if (act === 'retry') {
          runGenerate(add.failed.flatMap(f => f.items));
        } else if (act === 'clear') {
          if (confirm('미리보기를 모두 지울까요?')) {
            add.senses = [];
            add.failed = [];
            renderAddResults();
          }
        } else if (act === 'save') {
          const chosen = add.senses.filter(s => s.checked);
          if (chosen.some(s => !s.word.trim() || !s.meaning.trim())) {
            UI.toast('선택한 단어의 단어와 뜻을 모두 채워 주세요.', 'error');
            return;
          }
          Store.addWords(chosen.map(s => ({
            word: s.word, pos: s.pos, meaning: s.meaning, context: s.context, sentences: s.sentences,
          })));
          UI.toast(`${chosen.length}개 단어를 저장했습니다.`);
          add.senses = [];
          add.failed = [];
          add.text = '';
          render();
        }
      });
      renderAddResults();
    },
  };

  // ---------- word list ----------
  views.words = {
    render() {
      const sorts = [['mastery', '익힘도 낮은 순'], ['mastery-desc', '익힘도 높은 순'], ['alpha', '알파벳 순'], ['recent', '최근 등록 순']];
      return `<section class="page">
        <div class="page-head"><h1>단어 목록</h1>${bookPicker()}</div>
        <div class="toolbar">
          <input type="search" id="q" placeholder="단어나 뜻으로 검색" value="${esc(list.q)}" autocapitalize="off" spellcheck="false">
          <select id="sort" aria-label="정렬">${sorts.map(([v, l]) => `<option value="${v}" ${list.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>
        <p class="muted small" id="count"></p>
        <ul class="word-list" id="list"></ul>
      </section>`;
    },
    bind(root) {
      bindBookPicker(root);
      const ul = root.querySelector('#list');
      const count = root.querySelector('#count');
      const draw = () => {
        const all = Store.activeBook().words;
        const q = list.q.trim().toLowerCase();
        let ws = q ? all.filter(w => w.word.toLowerCase().includes(q) || w.meaning.includes(q) || w.context.includes(q)) : all.slice();
        const by = {
          mastery: (a, b) => a.mastery - b.mastery || a.word.localeCompare(b.word),
          'mastery-desc': (a, b) => b.mastery - a.mastery || a.word.localeCompare(b.word),
          alpha: (a, b) => a.word.localeCompare(b.word),
          recent: (a, b) => (a.createdAt < b.createdAt ? 1 : -1),
        }[list.sort];
        ws = ws.sort(by);
        count.textContent = q ? `${all.length}개 중 ${ws.length}개` : `${all.length}개`;
        if (!all.length) {
          ul.innerHTML = '<li class="card empty"><p>아직 등록된 단어가 없습니다.</p><a class="btn primary" href="#/add">단어 등록</a></li>';
          return;
        }
        ul.innerHTML = ws.map(w => `<li>
          <a class="word-row" href="#/word/${w.id}">
            <span class="wr-word"><b lang="en">${esc(w.word)}</b>${w.pos ? ` <span class="muted small">${esc(w.pos)}</span>` : ''}${w.context ? ` <span class="tag">${esc(w.context)}</span>` : ''}</span>
            <span class="wr-meaning muted">${esc(w.meaning)}</span>
            <span class="wr-meta"><span class="muted small">예문 ${w.sentences.length}</span>${masteryBadge(w.mastery)}</span>
          </a>
        </li>`).join('') || '<li class="muted">검색 결과가 없습니다.</li>';
      };
      root.querySelector('#q').addEventListener('input', e => { list.q = e.target.value; draw(); });
      root.querySelector('#sort').addEventListener('change', e => { list.sort = e.target.value; draw(); });
      draw();
    },
  };

  // ---------- word detail ----------
  function sentenceFields(s = {}) {
    return `
      <label class="fld"><span>영어 예문</span><textarea name="en" rows="2" lang="en" autocapitalize="off" spellcheck="false">${esc(s.en || '')}</textarea></label>
      <label class="fld"><span>한글 번역 (영작 문제에 사용)</span><textarea name="ko" rows="2">${esc(s.ko || '')}</textarea></label>
      <div class="grid2">
        <label class="fld"><span>예문 속 정답 형태</span><input name="answer" value="${esc(s.answer || '')}" lang="en" autocapitalize="off" spellcheck="false" placeholder="비워 두면 자동으로 찾습니다"></label>
        <label class="fld"><span>힌트 단어 (쉼표로 구분)</span><input name="hints" value="${esc((s.hints || []).join(', '))}" lang="en" autocapitalize="off" spellcheck="false"></label>
      </div>`;
  }

  function readSentenceForm(form, word) {
    const en = form.en.value.trim().replace(/\s+/g, ' ');
    const ko = form.ko.value.trim();
    let answer = form.answer.value.trim();
    if (!en) throw new Error('영어 예문을 입력하세요.');
    if (!ko) throw new Error('한글 번역을 입력하세요.');
    if (!answer) answer = Util.guessAnswer(en, word.word);
    const at = Util.findAnswer(en, answer);
    if (!answer || at < 0) throw new Error('예문 속 정답 형태를 찾지 못했습니다. 예문에 쓰인 그대로 입력하세요.');
    const hints = form.hints.value.split(',').map(h => h.trim()).filter(Boolean);
    return { en, ko, answer: en.substr(at, answer.length), hints };
  }

  views.word = {
    render(id) {
      const w = Store.findWord(id);
      if (!w) {
        location.replace('#/words');
        return null;
      }
      return `<section class="page">
        <div class="page-head"><a class="back" href="#/words">← 단어 목록</a></div>
        <div class="card">
          <div class="row between">
            <span class="row gap-sm wrap"><h1 lang="en">${esc(w.word)}</h1>${Pron.html(w)}</span>
            <span class="row gap-sm"><span class="muted small">익힘도</span>${masteryBadge(w.mastery)}</span>
          </div>
          <p class="muted small">정답 ${w.correct}회 · 오답 ${w.wrong}회${w.lastTestedAt ? ` · 마지막 테스트 ${Util.time(w.lastTestedAt)}` : ''}</p>
          <form id="word-form" class="form">
            <div class="grid2">
              <label class="fld"><span>단어 / 구문</span><input name="word" value="${esc(w.word)}" lang="en" autocapitalize="off" spellcheck="false"></label>
              <label class="fld"><span>품사</span><input name="pos" value="${esc(w.pos)}"></label>
            </div>
            <label class="fld"><span>뜻</span><input name="meaning" value="${esc(w.meaning)}"></label>
            <label class="fld"><span>상황 힌트 (같은 철자의 다른 뜻과 구분)</span><input name="context" value="${esc(w.context)}"></label>
            <div class="row between wrap">
              <span class="row gap-sm">
                <button type="button" class="btn sm" data-act="reset">익힘도 초기화</button>
                <button type="button" class="btn sm danger" data-act="delete">단어 삭제</button>
              </span>
              <button class="btn primary">저장</button>
            </div>
          </form>
        </div>

        <div class="card">
          <div class="row between wrap">
            <h2>예문 ${w.sentences.length}개</h2>
            <button class="btn sm" data-act="gen-more">Claude로 2문장 생성</button>
          </div>
          <p class="muted small">예문은 "예문 빈칸 채우기"와 "한글 문장 영작" 문제에 함께 쓰입니다.</p>
          <ul class="sent-list">${w.sentences.map(s => (editingSentence === s.id ? `
            <li class="editing"><form class="form" data-sid="${s.id}">
              ${sentenceFields(s)}
              <p class="field-error" hidden></p>
              <div class="row end"><button type="button" class="btn sm" data-act="cancel-edit">취소</button><button class="btn primary sm">저장</button></div>
            </form></li>` : `
            <li>
              <div class="sent-text">
                <p lang="en">${Quiz.highlight(s.en, s.answer)}</p>
                <p class="muted small">${esc(s.ko)}</p>
                ${s.hints.length ? `<p class="small">힌트 ${pills(s.hints)}</p>` : ''}
              </div>
              <span class="sent-actions">
                <button class="btn ghost sm" data-act="edit-sent" data-sid="${s.id}">수정</button>
                <button class="btn ghost sm" data-act="del-sent" data-sid="${s.id}">삭제</button>
              </span>
            </li>`)).join('') || '<li class="muted small">예문이 없습니다.</li>'}
          </ul>
          <details class="add-sent">
            <summary>예문 직접 추가</summary>
            <form id="sent-form" class="form">
              ${sentenceFields()}
              <p class="field-error" hidden></p>
              <div class="row end"><button class="btn primary sm">예문 추가</button></div>
            </form>
          </details>
        </div>
      </section>`;
    },
    bind(root, id) {
      const w = Store.findWord(id);

      root.querySelector('#word-form').addEventListener('submit', e => {
        e.preventDefault();
        const f = e.target;
        const patch = { word: f.word.value.trim(), pos: f.pos.value.trim(), meaning: f.meaning.value.trim(), context: f.context.value.trim() };
        if (patch.word !== w.word) patch.pron = null; // spelling changed: look the pronunciation up again
        if (!patch.word || !patch.meaning) return UI.toast('단어와 뜻을 입력하세요.', 'error');
        Store.updateWord(w.id, patch);
        UI.toast('저장했습니다.');
        render();
      });

      root.addEventListener('submit', e => {
        const f = e.target;
        if (f.id === 'word-form') return;
        e.preventDefault();
        const err = f.querySelector('.field-error');
        try {
          const s = readSentenceForm(f, w);
          if (f.dataset.sid) {
            Store.updateSentence(w.id, f.dataset.sid, s);
            editingSentence = null;
          } else {
            Store.addSentences(w.id, [s]);
          }
          UI.toast('예문을 저장했습니다.');
          render();
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
        }
      });

      root.addEventListener('click', async e => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === 'reset') {
          if (confirm('익힘도를 0으로 되돌릴까요?')) {
            Store.updateWord(w.id, { mastery: 0 });
            render();
          }
        } else if (act === 'delete') {
          if (confirm(`"${w.word}" 단어를 삭제할까요? 되돌릴 수 없습니다.`)) {
            Store.deleteWord(w.id);
            UI.toast('삭제했습니다.');
            go('#/words');
          }
        } else if (act === 'edit-sent') {
          editingSentence = btn.dataset.sid;
          render();
        } else if (act === 'cancel-edit') {
          editingSentence = null;
          render();
        } else if (act === 'del-sent') {
          if (confirm('이 예문을 삭제할까요?')) {
            Store.deleteSentence(w.id, btn.dataset.sid);
            render();
          }
        } else if (act === 'gen-more') {
          btn.disabled = true;
          btn.textContent = '생성 중…';
          try {
            const ss = await Claude.generateSentences(w, 2);
            if (!ss.length) throw new Error('쓸 수 있는 예문이 생성되지 않았습니다. 다시 시도하세요.');
            Store.addSentences(w.id, ss);
            UI.toast(`예문 ${ss.length}개를 추가했습니다.`);
            if (parseHash().name === 'word') render();
          } catch (ex) {
            UI.toast(ex.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Claude로 2문장 생성';
          }
        }
      });

      // Fill in the answer form as soon as the sentence is typed.
      root.querySelectorAll('textarea[name=en]').forEach(ta => {
        ta.addEventListener('blur', () => {
          const ans = ta.form.answer;
          if (!ans.value.trim()) ans.value = Util.guessAnswer(ta.value, w.word);
        });
      });
    },
  };

  // ---------- quiz ----------
  function startQuiz(words) {
    const questions = Quiz.build(words, Store.settings.quizSize);
    if (!questions.length) {
      UI.toast('출제할 단어가 없습니다.', 'error');
      return;
    }
    session = { questions, index: 0, results: [], graded: null };
    go('#/quiz');
  }

  function finishQuiz() {
    const results = session.results;
    if (results.length) {
      Store.addHistory({ total: results.length, correct: results.filter(r => r.correct).length });
      lastResult = { results };
    }
    session = null;
    go(results.length ? '#/result' : '#/home');
  }

  function currentQuestion() {
    // Skip questions whose word was deleted meanwhile.
    while (session.index < session.questions.length) {
      const q = session.questions[session.index];
      const w = Store.findWord(q.wordId);
      if (w) return { q, w, t: Quiz.types[q.type] };
      session.questions.splice(session.index, 1);
    }
    return null;
  }

  views.quiz = {
    render() {
      if (!session) {
        location.replace('#/home');
        return null;
      }
      const cur = currentQuestion();
      if (!cur) {
        finishQuiz();
        return null;
      }
      const { q, w, t } = cur;
      const total = session.questions.length;
      return `<section class="page quiz">
        <div class="quiz-top">
          <button class="btn ghost sm" data-act="quit">그만하기</button>
          <span class="muted small">${t.label}</span>
          <span class="small"><b>${session.index + 1}</b> / ${total}</span>
        </div>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${session.index}"><span style="width:${(session.index / total) * 100}%"></span></div>
        <div class="card q-card">
          <div class="q-body">${t.render(q, w, { showContext: Store.hasSiblings(w) })}</div>
          <p class="field-error" data-role="err" hidden>답을 입력하세요.</p>
          <div class="feedback" data-role="fb" hidden></div>
        </div>
        <div class="quiz-actions"><button class="btn primary lg" data-act="submit">제출</button></div>
      </section>`;
    },
    bind(root) {
      const { q, w, t } = currentQuestion();
      const body = root.querySelector('.q-body');
      const err = root.querySelector('[data-role=err]');
      const fb = root.querySelector('[data-role=fb]');
      const btn = root.querySelector('[data-act=submit]');
      if (t.mount) t.mount(body, q, w);
      const first = body.querySelector('input');
      if (first) first.focus();
      body.addEventListener('input', () => { err.hidden = true; });

      const submit = () => {
        if (session.graded) {
          session.index++;
          session.graded = null;
          if (session.index >= session.questions.length) finishQuiz();
          else render();
          return;
        }
        const raw = t.read(body);
        if (t.isEmpty(raw)) {
          err.hidden = false;
          return;
        }
        const g = t.grade(q, w, raw);
        const change = Store.recordAnswer(w.id, g.correct);
        session.graded = g;
        session.results.push({
          wordId: w.id, word: w.word, meaning: w.meaning, context: w.context,
          type: q.type, correct: g.correct, user: g.user, before: change.before, after: change.after,
        });
        body.querySelectorAll('input').forEach(el => { el.disabled = true; });
        fb.className = `feedback ${g.correct ? 'ok' : 'bad'}`;
        fb.innerHTML = `<p class="fb-head">${g.correct ? '정답입니다' : '틀렸습니다'} <span class="small">익힘도 ${change.before} → ${change.after}</span></p>
          <p class="fb-word"><b lang="en">${esc(w.word)}</b>${Pron.html(w)}<span class="muted small">${esc(w.meaning)}</span></p>
          ${t.feedback(q, w, g)}`;
        Pron.prefetch(fb);
        fb.hidden = false;
        btn.textContent = session.index + 1 >= session.questions.length ? '결과 보기' : '다음 문제';
        btn.focus();
      };

      btn.addEventListener('click', submit);
      root.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          submit();
        }
      });
      root.querySelector('[data-act=quit]').addEventListener('click', () => {
        if (confirm('테스트를 그만할까요? 이미 푼 문제의 익힘도는 반영됩니다.')) finishQuiz();
      });
    },
  };

  // ---------- result ----------
  views.result = {
    render() {
      if (!lastResult) {
        location.replace('#/home');
        return null;
      }
      const r = lastResult.results;
      const ok = r.filter(x => x.correct).length;
      const wrong = r.filter(x => !x.correct);
      return `<section class="page">
        <div class="card result-head">
          <p class="muted small">테스트 결과</p>
          <p class="score"><b>${ok}</b> / ${r.length} 정답</p>
        </div>
        <ul class="result-list">${r.map(x => `
          <li class="card res-row">
            <div class="res-word">
              <b lang="en">${esc(x.word)}</b>${Store.findWord(x.wordId) ? Pron.html(Store.findWord(x.wordId)) : ''}${x.context ? ` <span class="tag">${esc(x.context)}</span>` : ''}
              <div class="muted small">${esc(x.meaning)}</div>
            </div>
            <div class="res-detail small">
              <span class="muted">${Quiz.types[x.type].label}</span><br>
              ${x.correct ? '<span class="ok-text">정답</span>' : `<span class="bad-text">오답</span> · <span lang="en">${esc(x.user)}</span>`}
            </div>
            <div class="res-m">${x.before} → ${masteryBadge(x.after)}</div>
          </li>`).join('')}
        </ul>
        <div class="row end wrap">
          <a class="btn" href="#/home">홈으로</a>
          <button class="btn" data-act="again">새 테스트</button>
          ${wrong.length ? `<button class="btn primary" data-act="retry">틀린 단어 다시 (${wrong.length})</button>` : ''}
        </div>
      </section>`;
    },
    bind(root) {
      root.querySelector('[data-act=again]').addEventListener('click', () => startQuiz(Store.activeBook().words));
      const retry = root.querySelector('[data-act=retry]');
      if (retry) {
        retry.addEventListener('click', () => {
          const ids = [...new Set(lastResult.results.filter(x => !x.correct).map(x => x.wordId))];
          startQuiz(ids.map(Store.findWord).filter(Boolean));
        });
      }
    },
  };

  // ---------- settings ----------
  function fileSectionHtml() {
    let link;
    if (!FileLink.supported) {
      link = '<p class="muted small">이 브라우저는 파일 자동 저장을 지원하지 않습니다(PC의 Chrome이나 Edge에서 가능). 아래 내보내기와 가져오기로 파일을 관리하세요.</p>';
    } else if (FileLink.state === 'none') {
      link = `<p class="muted small">JSON 파일 하나를 연결해 두면 단어가 바뀔 때마다 그 파일에 자동 저장합니다. 클라우드 드라이브 폴더에 두면 백업도 됩니다.</p>
        <div class="row gap-sm wrap"><button class="btn sm" data-act="file-new">새 파일 만들어 연결</button><button class="btn sm" data-act="file-open">기존 파일 열어 연결</button></div>`;
    } else if (FileLink.state === 'linked') {
      link = `<p class="small">연결된 파일 <b>${esc(FileLink.fileName)}</b>${FileLink.lastSaved ? ` · 마지막 저장 ${FileLink.lastSaved.toLocaleTimeString('ko-KR')}` : ''}</p>
        <div class="row gap-sm"><button class="btn sm" data-act="file-unlink">연결 해제</button></div>`;
    } else {
      link = `<p class="small">파일 <b>${esc(FileLink.fileName)}</b>에 자동 저장이 멈춰 있습니다.</p>
        <div class="row gap-sm"><button class="btn sm" data-act="file-relink">다시 연결</button><button class="btn sm" data-act="file-unlink">연결 해제</button></div>`;
    }
    return `<h3>자동 저장 파일</h3>${link}
      <h3>내보내기 · 가져오기</h3>
      <p class="muted small">단어장을 JSON 파일로 저장하거나 불러옵니다. 다른 기기로 옮길 때도 씁니다. 가져온 단어는 기존 단어와 합쳐지고, 같은 단어는 더 최근에 바뀐 쪽을 남깁니다.</p>
      <div class="row gap-sm wrap">
        <button class="btn sm" data-act="export-book">현재 단어장 내보내기</button>
        <button class="btn sm" data-act="export-all">전체 내보내기</button>
        <button class="btn sm" data-act="import">파일 가져오기</button>
        <input type="file" id="import-file" accept=".json,application/json" hidden>
      </div>`;
  }

  function refreshFileSection() {
    const el = document.getElementById('file-section');
    if (el) el.innerHTML = fileSectionHtml();
  }

  views.settings = {
    render() {
      const s = Store.settings;
      const lib = Store.lib;
      return `<section class="page">
        <div class="page-head"><h1>설정</h1></div>

        <div class="card">
          <h2>Claude API</h2>
          <form id="api-form" class="form">
            <label class="fld"><span>API 키</span>
              <span class="row gap-sm"><input name="apiKey" type="password" value="${esc(s.apiKey)}" placeholder="sk-ant-..." autocomplete="off" spellcheck="false" style="flex:1"><button type="button" class="btn sm" data-act="toggle-key">보기</button></span>
            </label>
            <label class="fld"><span>모델</span>
              <select name="model">${Claude.MODELS.map(m => `<option value="${m.id}" ${m.id === s.model ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
            </label>
            <label class="fld"><span>워크스페이스 ID (선택)</span>
              <input name="workspaceId" value="${esc(s.workspaceId || '')}" placeholder="wrkspc_..." autocomplete="off" spellcheck="false">
            </label>
            <p class="muted small">워크스페이스가 지정되지 않은 키를 쓸 때만 입력합니다. Console의 Workspaces 화면에서 확인할 수 있습니다.</p>
            <p class="muted small">키는 이 브라우저에만 저장되고 단어 파일에는 들어가지 않습니다. 요청은 브라우저에서 Anthropic API로 바로 전송됩니다.</p>
            <div class="row end"><button class="btn primary sm">저장</button></div>
          </form>
        </div>

        <div class="card">
          <h2>테스트</h2>
          <form id="quiz-form" class="form">
            <label class="fld"><span>한 번에 출제할 문제 수</span><input name="quizSize" type="number" min="3" max="50" value="${s.quizSize}" inputmode="numeric"></label>
            <div class="row end"><button class="btn primary sm">저장</button></div>
          </form>
        </div>

        <div class="card">
          <h2>단어장</h2>
          <ul class="book-list">${lib.books.map(b => `
            <li>
              <span><b>${esc(b.name)}</b> <span class="muted small">${b.words.length}개${b.id === lib.activeBookId ? ' · 사용 중' : ''}</span></span>
              <span class="row gap-sm">
                ${b.id === lib.activeBookId ? '' : `<button class="btn ghost sm" data-act="book-use" data-id="${b.id}">사용</button>`}
                <button class="btn ghost sm" data-act="book-rename" data-id="${b.id}">이름 변경</button>
                <button class="btn ghost sm danger" data-act="book-delete" data-id="${b.id}">삭제</button>
              </span>
            </li>`).join('')}
          </ul>
          <form id="book-form" class="row gap-sm">
            <input name="name" placeholder="새 단어장 이름" style="flex:1">
            <button class="btn sm">만들기</button>
          </form>
        </div>

        <div class="card" id="file-section">${fileSectionHtml()}</div>
      </section>`;
    },
    bind(root) {
      root.querySelector('#api-form').addEventListener('submit', e => {
        e.preventDefault();
        Store.saveSettings({
          apiKey: e.target.apiKey.value.trim(),
          workspaceId: e.target.workspaceId.value.trim(),
          model: e.target.model.value,
        });
        UI.toast('API 설정을 저장했습니다.');
      });
      root.querySelector('#quiz-form').addEventListener('submit', e => {
        e.preventDefault();
        const n = Math.min(50, Math.max(3, parseInt(e.target.quizSize.value, 10) || 10));
        Store.saveSettings({ quizSize: n });
        e.target.quizSize.value = n;
        UI.toast(`한 번에 ${n}문제씩 출제합니다.`);
      });
      root.querySelector('#book-form').addEventListener('submit', e => {
        e.preventDefault();
        const name = e.target.name.value.trim();
        if (!name) return UI.toast('단어장 이름을 입력하세요.', 'error');
        Store.createBook(name);
        UI.toast(`"${name}" 단어장을 만들었습니다.`);
        render();
      });

      root.addEventListener('change', async e => {
        if (e.target.id !== 'import-file') return;
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
          const r = Store.importData(JSON.parse(await file.text()));
          UI.toast(`가져오기 완료: 새 단어 ${r.added}개, 갱신 ${r.updated}개${r.books ? `, 새 단어장 ${r.books}개` : ''}`);
          render();
        } catch (ex) {
          UI.toast(ex instanceof SyntaxError ? 'JSON 파일을 읽지 못했습니다.' : ex.message, 'error');
        }
      });

      root.addEventListener('click', async e => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const id = btn.dataset.id;
        try {
          switch (btn.dataset.act) {
            case 'toggle-key': {
              const inp = root.querySelector('[name=apiKey]');
              inp.type = inp.type === 'password' ? 'text' : 'password';
              btn.textContent = inp.type === 'password' ? '보기' : '숨기기';
              break;
            }
            case 'book-use':
              Store.setActiveBook(id);
              render();
              break;
            case 'book-rename': {
              const b = Store.lib.books.find(x => x.id === id);
              const name = prompt('새 이름', b.name);
              if (name && name.trim()) {
                Store.renameBook(id, name.trim());
                render();
              }
              break;
            }
            case 'book-delete': {
              const b = Store.lib.books.find(x => x.id === id);
              if (confirm(`"${b.name}" 단어장과 단어 ${b.words.length}개를 삭제할까요? 되돌릴 수 없습니다.`)) {
                Store.deleteBook(id);
                render();
              }
              break;
            }
            case 'export-book': {
              const b = Store.activeBook();
              Util.download(`${Util.safeFilename(b.name)}-${Util.stamp()}.json`, JSON.stringify(Store.exportBook(b.id), null, 2));
              break;
            }
            case 'export-all':
              Util.download(`words-library-${Util.stamp()}.json`, JSON.stringify(Store.exportAll(), null, 2));
              break;
            case 'import':
              root.querySelector('#import-file').click();
              break;
            case 'file-new':
              await FileLink.createNew();
              UI.toast('파일을 연결했습니다. 이제 자동으로 저장됩니다.');
              refreshFileSection();
              break;
            case 'file-open': {
              const r = await FileLink.openExisting();
              UI.toast(r ? `파일을 연결하고 합쳤습니다: 새 단어 ${r.added}개, 갱신 ${r.updated}개` : '파일을 연결했습니다.');
              render();
              break;
            }
            case 'file-relink':
              await relink();
              break;
            case 'file-unlink':
              await FileLink.unlink();
              UI.toast('파일 연결을 해제했습니다. 데이터는 브라우저에 그대로 남아 있습니다.');
              refreshFileSection();
              break;
          }
        } catch (ex) {
          if (ex.name !== 'AbortError') UI.toast(ex.message, 'error');
        }
      });
    },
  };

  // ---------- boot ----------
  async function init() {
    Store.load();
    window.addEventListener('hashchange', render);
    FileLink.onChange(() => { renderBanner(); refreshFileSection(); });
    render();
    const r = await FileLink.init();
    if (r === 'loaded') {
      UI.toast('연결된 단어 파일에서 최신 데이터를 불러왔습니다.');
      render();
    }
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  return { init };
})();

App.init();
