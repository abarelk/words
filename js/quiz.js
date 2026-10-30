'use strict';

// Quiz types are self-contained: add a new entry to `types` to add a new kind
// of question. Each type implements:
//   label                 shown above the question
//   available(word)       can this word be asked with this type?
//   build(word)           -> question object { type, wordId, ... }
//   render(q, word, ctx)  -> HTML for the question
//   mount(root, q, word)  optional: wire up inputs after render
//   read(root)            -> raw answer from the DOM
//   isEmpty(raw)          -> true when nothing was entered
//   grade(q, word, raw)   -> { correct, user }
//   feedback(q, word, g)  -> HTML shown after grading
const Quiz = (() => {
  const { esc, norm, pick } = Util;
  const INPUT_ATTRS = 'type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"';

  function sentenceOf(q, w) {
    return w.sentences.find(s => s.id === q.sentenceId) || w.sentences[0];
  }

  function posTag(w) {
    return w.pos ? `<span class="tag">${esc(w.pos)}</span>` : '';
  }

  // For a phrase, say how many words to type.
  function phraseTag(text) {
    const n = text.trim().split(/\s+/).length;
    return n > 1 ? `<span class="tag">${n}단어 구문</span>` : '';
  }

  function contextTag(w, ctx) {
    return ctx.showContext && w.context ? `<span class="tag tag-warn">상황: ${esc(w.context)}</span>` : '';
  }

  function prefixInput(first) {
    return `<div class="answer-row">
      <span class="prefix">${esc(first)}</span>
      <input class="ans" ${INPUT_ATTRS} enterkeyhint="done" aria-label="나머지 철자 입력">
    </div>`;
  }

  // The first letter is given; accept either the rest or the whole word.
  function gradePrefixed(answer, raw) {
    const input = raw.trim();
    const first = answer.charAt(0);
    if (norm(first + input) === norm(answer)) return { correct: true, user: first + input };
    if (norm(input) === norm(answer)) return { correct: true, user: input };
    return { correct: false, user: input.toLowerCase().startsWith(first.toLowerCase()) ? input : first + input };
  }

  function highlight(en, answer) {
    const i = Util.findAnswer(en, answer);
    if (i < 0) return esc(en);
    return `${esc(en.slice(0, i))}<u class="target">${esc(en.slice(i, i + answer.length))}</u>${esc(en.slice(i + answer.length))}`;
  }

  function blanked(en, answer) {
    const i = Util.findAnswer(en, answer);
    const hole = `<span class="blank">${esc(answer.charAt(0))}${esc(answer.slice(1).replace(/[^\s]/g, '_'))}</span>`;
    if (i < 0) return `${esc(en)} ${hole}`;
    return `${esc(en.slice(0, i))}${hole}${esc(en.slice(i + answer.length))}`;
  }

  // "Despite mounting pressure," -> [{lead:'', core:'Despite', trail:''}, ..., {core:'pressure', trail:','}]
  function tokenize(en) {
    return en.trim().split(/\s+/).map(raw => {
      const m = raw.match(/^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/);
      return { raw, lead: m[1], core: m[2], trail: m[3] };
    });
  }

  function sentenceBlock(s) {
    return `<div class="fb-sentence">
      <p lang="en">${highlight(s.en, s.answer)}</p>
      ${s.ko ? `<p class="muted">${esc(s.ko)}</p>` : ''}
    </div>`;
  }

  const types = {
    meaning: {
      label: '뜻 보고 단어 쓰기',
      available: w => !!w.meaning,
      build: w => ({ type: 'meaning', wordId: w.id }),
      render: (q, w, ctx) => `
        <p class="q-main">${esc(w.meaning)}</p>
        <p class="q-tags">${posTag(w)} ${phraseTag(w.word)} ${contextTag(w, ctx)}</p>
        ${prefixInput(w.word.charAt(0))}`,
      read: root => root.querySelector('.ans').value,
      isEmpty: raw => !raw.trim(),
      grade: (q, w, raw) => gradePrefixed(w.word, raw),
      // The answer itself is shown in the common word line above the feedback.
      feedback: (q, w) => (w.sentences.length ? sentenceBlock(w.sentences[0]) : ''),
    },

    blank: {
      label: '예문 빈칸 채우기',
      available: w => w.sentences.some(s => s.answer),
      build: w => ({ type: 'blank', wordId: w.id, sentenceId: pick(w.sentences.filter(s => s.answer)).id }),
      render: (q, w, ctx) => {
        const s = sentenceOf(q, w);
        return `
          <p class="q-sentence" lang="en">${blanked(s.en, s.answer)}</p>
          <p class="q-tags">힌트 <b>${esc(w.meaning)}</b> ${contextTag(w, ctx)}</p>
          ${prefixInput(s.answer.charAt(0))}`;
      },
      read: root => root.querySelector('.ans').value,
      isEmpty: raw => !raw.trim(),
      grade: (q, w, raw) => gradePrefixed(sentenceOf(q, w).answer, raw),
      feedback: (q, w) => {
        const s = sentenceOf(q, w);
        return `<p>정답 <b lang="en">${esc(s.answer)}</b></p>${sentenceBlock(s)}`;
      },
    },

    compose: {
      label: '한글 문장 영작',
      available: w => w.sentences.length > 0,
      build: w => ({ type: 'compose', wordId: w.id, sentenceId: pick(w.sentences).id }),
      render: (q, w) => {
        const s = sentenceOf(q, w);
        const toks = tokenize(s.en);
        const count = toks.filter(t => t.core).length;
        const blanks = toks.map((t, i) => {
          if (!t.core) return `<span class="tok"><span class="punct">${esc(t.raw)}</span></span>`;
          return `<span class="tok">${t.lead ? `<span class="punct">${esc(t.lead)}</span>` : ''}<input class="wd" data-i="${i}" ${INPUT_ATTRS} aria-label="${i + 1}번째 단어">${t.trail ? `<span class="punct">${esc(t.trail)}</span>` : ''}</span>`;
        }).join(' ');
        return `
          <p class="q-ko">${esc(s.ko)}</p>
          ${s.hints.length ? `<p class="q-tags">힌트 단어 ${s.hints.map(h => `<span class="pill" lang="en">${esc(h)}</span>`).join(' ')}</p>` : ''}
          <div class="compose" lang="en">${blanks}</div>
          <p class="muted small">빈칸 하나에 한 단어씩 들어갑니다 (${count}단어). 스페이스를 누르면 뒤 단어들을 한 칸씩 밀고 새 칸으로 넘어가고, 빈칸에서 백스페이스를 누르면 그 칸이 지워집니다.</p>`;
      },
      mount: root => {
        const inputs = [...root.querySelectorAll('.wd')];
        const fit = el => { el.style.width = `${Math.max(4, el.value.length + 1.5)}ch`; };
        const last = inputs.length - 1;
        // One word per blank; a blank holding several words (overflow) is
        // spread out again as soon as there is room, and whatever still
        // doesn't fit stays together in the last blank.
        const setAll = values => {
          const room = inputs.length;
          let out = [];
          values.forEach((v, i) => {
            const words = v.split(/\s+/).filter(Boolean);
            const free = room - out.length - values.slice(i + 1).filter(Boolean).length;
            if (words.length > 1 && free >= words.length) out.push(...words);
            else out.push(words.join(' '));
          });
          for (let i = out.length - 1; out.length > room && i >= 0; i--) {
            if (!out[i]) out.splice(i, 1);
          }
          if (out.length > room) out = [...out.slice(0, room - 1), out.slice(room - 1).join(' ')];
          inputs.forEach((x, i) => { x.value = out[i] || ''; fit(x); });
        };
        const focusAt = (i, caret) => {
          const x = inputs[i];
          x.focus();
          const pos = caret === 'start' ? 0 : x.value.length;
          x.setSelectionRange(pos, pos);
        };

        // Blanks behave like one line of text: a space inserts a new blank
        // after the cursor and pushes the following words back instead of
        // overwriting them. The push stops at the first empty blank.
        const insertAfter = (k, pieces) => {
          const values = inputs.map(x => x.value);
          const rest = values.slice(k + 1);
          let need = pieces.length;
          for (let i = 0; i < rest.length && need > 0; i++) {
            if (!rest[i]) { rest.splice(i, 1); i--; need--; }
          }
          let tail = [...pieces, ...rest];
          const slots = last - k;
          // No empty blank left: keep the overflow in the last blank rather than drop it.
          if (tail.length > slots) {
            tail = [...tail.slice(0, slots - 1), tail.slice(slots - 1).filter(Boolean).join(' ')];
          }
          setAll([...values.slice(0, k + 1), ...tail]);
        };

        inputs.forEach((el, k) => {
          el.addEventListener('input', () => {
            if (!/\s/.test(el.value)) { fit(el); return; }
            if (!el.value.trim()) {
              // Space in an empty blank: just move on.
              el.value = '';
              fit(el);
              if (k < last) focusAt(k + 1, 'start');
              return;
            }
            const parts = el.value.replace(/^\s+/, '').split(/\s+/);
            if (k === last) {
              el.value = parts.filter(Boolean).join(' ');
              fit(el);
              return;
            }
            el.value = parts[0];
            const pieces = parts.slice(1); // '' when the space was typed at the end
            insertAfter(k, pieces);
            const target = Math.min(k + pieces.length, last);
            focusAt(target, pieces[pieces.length - 1] === '' ? 'start' : 'end');
          });
          el.addEventListener('keydown', e => {
            if (e.key === 'Backspace' && !el.value && k > 0) {
              // Remove this empty blank: later words move forward one blank.
              e.preventDefault();
              const values = inputs.map(x => x.value);
              values.splice(k, 1);
              setAll(values);
              focusAt(k - 1, 'end');
            } else if (e.key === 'ArrowRight' && el.selectionStart === el.value.length && k < inputs.length - 1) {
              inputs[k + 1].focus();
            } else if (e.key === 'ArrowLeft' && el.selectionStart === 0 && k > 0) {
              inputs[k - 1].focus();
            }
          });
        });
      },
      read: root => [...root.querySelectorAll('.wd')].map(el => el.value.trim()),
      isEmpty: raw => raw.every(v => !v),
      grade: (q, w, raw) => {
        const s = sentenceOf(q, w);
        const cores = tokenize(s.en).filter(t => t.core).map(t => t.core);
        const marks = cores.map((c, i) => norm(raw[i]) === norm(c));
        return { correct: marks.every(Boolean), user: raw.join(' '), marks, words: raw };
      },
      feedback: (q, w, g) => {
        const s = sentenceOf(q, w);
        const mine = g.words.map((v, i) => `<span class="${g.marks[i] ? '' : 'wrong-word'}">${esc(v || '___')}</span>`).join(' ');
        return `
          ${g.correct ? '' : `<p class="small muted">내 답</p><p lang="en">${mine}</p>`}
          <p class="small muted">정답</p>
          ${sentenceBlock(s)}`;
      },
    },
  };

  // Lowest mastery first; ties broken randomly; the final order is shuffled.
  function build(words, size) {
    const ranked = Util.shuffle(words.slice()).sort((a, b) => a.mastery - b.mastery);
    const chosen = Util.shuffle(ranked.slice(0, size));
    return chosen.map(w => {
      const avail = Object.keys(types).filter(k => types[k].available(w));
      return avail.length ? types[pick(avail)].build(w) : null;
    }).filter(Boolean);
  }

  return { types, build, highlight, tokenize };
})();
