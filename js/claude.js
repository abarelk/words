'use strict';

// Generates meanings, senses and example sentences with the Claude API,
// called directly from the browser with the user's own API key.
const Claude = (() => {
  const SDK_URL = 'https://esm.sh/@anthropic-ai/sdk@0.129.0';
  const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'];
  let sdkPromise = null;

  const MODELS = [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (기본 · 품질 우선)' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (빠름 · 저렴)' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (가장 저렴)' },
  ];

  const SENTENCE_RULES = `Sentence rules
- CEFR B2 level or higher: natural, idiomatic English of the kind found in quality journalism, essays or professional writing. One sentence, 12-25 words. Vary topics and grammatical patterns across sentences.
- Use the target exactly once, in the given sense. Inflect it when the grammar calls for it.
- If the target is a multi-word phrase, keep its words together in dictionary order. Do not split a separable phrasal verb around its object: write "turned down the offer", not "turned the offer down". Replace placeholders such as one's, someone or something with concrete words ("made up her mind").
- answer: the target exactly as it appears in "en" (same inflection and spelling; for a phrase, the whole phrase including any filled-in placeholder words). It must be a contiguous substring of en.
- ko: a natural Korean translation that stays close to the English structure, so a learner translating it back word by word could reproduce the English sentence.
- hints: 2-3 key English words that appear in en, written in dictionary form, that help a learner rebuild the sentence. Never include the target itself.`;

  const GENERATE_SYSTEM = `You write vocabulary study material for Korean speakers learning English at an upper-intermediate to advanced level.

An input item is either a single word or a multi-word phrase (phrasal verb, idiom, fixed expression or collocation). For each input item return one entry, in the same order, echoing the input in "input". Each entry holds one or more senses.

Sense rules
- Split a headword into separate senses only when it has clearly distinct, commonly used meanings that a learner must learn separately (for example "yield": produce a result vs. give way under pressure). Do not split shades of one meaning. At most 3 senses.
- If an item has "meaning_ko", return exactly one sense: the one matching that Korean meaning.
- If an item has "note", it is the learner's own reference (Korean or English) describing the intended meaning or the situation where the item is used. Return exactly one sense: the one the note points to. Use the note to choose the meaning, the context label and the topics of the sentences, but write meaning and context in your own words rather than copying the note, and never add the note to "word".
- "existing_senses" lists senses of this headword the learner has already registered. For every sense you return, set same_as_existing to the 0-based index of the existing sense that has the same meaning, or -1 when it is a different meaning. With no existing_senses, always use -1.
- If "exclude_existing" is true, return only commonly used senses that differ from every existing sense. Return an empty senses list when there is none; do not invent rare, archaic or overly technical meanings to fill the gap.
- word: the headword in dictionary form, correctly spelled (fix an obvious typo). For a phrase, keep the whole phrase in its standard dictionary form (base-form verb, "one's" / "someone" / "something" only where a dictionary would use them). Never shorten a phrase to a single word.
- pos: one of n., v., adj., adv., prep., conj., phr. v. (phrasal verb), idiom, phr. (other phrase).
- meaning: a concise Korean dictionary gloss, 1-3 short glosses separated by ", ".
- context: a short Korean label (2-10 characters) for the situation or domain where this sense is used, such as "협상·압력" or "농업·경제". It is shown to tell senses of the same word apart.
- sentences: exactly the requested number per sense.

${SENTENCE_RULES}`;

  const MORE_SYSTEM = `You write example sentences for Korean speakers learning English vocabulary at an upper-intermediate to advanced level. Write the requested number of new sentences for the given word and sense. Do not reuse the topics or wording of the existing sentences.

${SENTENCE_RULES}`;

  const SENTENCE_SCHEMA = {
    type: 'object',
    properties: {
      en: { type: 'string' },
      ko: { type: 'string' },
      answer: { type: 'string' },
      hints: { type: 'array', items: { type: 'string' } },
    },
    required: ['en', 'ko', 'answer', 'hints'],
    additionalProperties: false,
  };

  const GENERATE_SCHEMA = {
    type: 'object',
    properties: {
      entries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            input: { type: 'string' },
            senses: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  word: { type: 'string' },
                  pos: { type: 'string' },
                  meaning: { type: 'string' },
                  context: { type: 'string' },
                  same_as_existing: { type: 'integer' },
                  sentences: { type: 'array', items: SENTENCE_SCHEMA },
                },
                required: ['word', 'pos', 'meaning', 'context', 'same_as_existing', 'sentences'],
                additionalProperties: false,
              },
            },
          },
          required: ['input', 'senses'],
          additionalProperties: false,
        },
      },
    },
    required: ['entries'],
    additionalProperties: false,
  };

  const MORE_SCHEMA = {
    type: 'object',
    properties: { sentences: { type: 'array', items: SENTENCE_SCHEMA } },
    required: ['sentences'],
    additionalProperties: false,
  };

  async function sdk() {
    if (!sdkPromise) {
      sdkPromise = import(SDK_URL).catch(e => {
        sdkPromise = null;
        throw Object.assign(new Error('Claude SDK를 불러오지 못했습니다. 인터넷 연결을 확인하세요.'), { cause: e });
      });
    }
    return (await sdkPromise).default;
  }

  async function call(system, userContent, schema) {
    const { apiKey, workspaceId, model } = Store.settings;
    if (!apiKey) throw new Error('설정에서 Claude API 키를 먼저 입력하세요.');
    const Anthropic = await sdk();
    // Keys not scoped to a workspace must name one on every request.
    const defaultHeaders = workspaceId ? { 'anthropic-workspace-id': workspaceId } : undefined;
    const client = new Anthropic({ apiKey, defaultHeaders, dangerouslyAllowBrowser: true });
    const params = {
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content: userContent }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    };
    // Server-side refusal fallback, where the model supports it.
    if (FALLBACK_MODELS.includes(model)) {
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }
    let res;
    try {
      res = await client.beta.messages.create(params);
    } catch (e) {
      throw new Error(friendly(e, Anthropic));
    }
    if (res.stop_reason === 'refusal') throw new Error('Claude가 이 요청을 처리하지 않았습니다. 단어를 바꿔 다시 시도하세요.');
    if (res.stop_reason === 'max_tokens') throw new Error('응답이 너무 길어 잘렸습니다. 한 번에 넣는 단어 수를 줄여 보세요.');
    const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Claude 응답을 해석하지 못했습니다. 다시 시도하세요.');
    }
  }

  function friendly(e, A) {
    if (e instanceof A.AuthenticationError) return 'API 키가 올바르지 않습니다. 설정에서 확인하세요.';
    if (e instanceof A.PermissionDeniedError) return '이 API 키로는 선택한 모델을 쓸 수 없습니다. 설정에서 모델을 바꿔 보세요.';
    if (e instanceof A.NotFoundError) return '선택한 모델을 찾을 수 없습니다. 설정에서 모델을 바꿔 보세요.';
    if (e instanceof A.RateLimitError) return '요청이 너무 많습니다. 잠시 후 다시 시도하세요.';
    if (e instanceof A.BadRequestError && /valid workspace ID/i.test(e.message)) {
      return '워크스페이스 ID가 올바르지 않습니다. Console의 Workspaces 화면에서 ID를 다시 확인하세요.';
    }
    if (e instanceof A.BadRequestError && /anthropic-workspace-id/.test(e.message)) {
      return '이 API 키는 워크스페이스가 지정되지 않은 키입니다. 설정에서 워크스페이스 ID를 입력하거나, 특정 워크스페이스에 속한 키를 새로 만드세요.';
    }
    if (e instanceof A.BadRequestError) return `요청이 거부되었습니다: ${e.message}`;
    if (e instanceof A.APIConnectionError) return '네트워크에 연결할 수 없습니다. 인터넷 연결을 확인하세요.';
    if (e instanceof A.InternalServerError) return 'Claude 서버에 일시적인 문제가 있습니다. 잠시 후 다시 시도하세요.';
    return e.message || String(e);
  }

  // Drop sentences whose answer can't be located; clean up hints.
  function cleanSentence(s, word) {
    const en = String(s.en || '').trim();
    let answer = String(s.answer || '').trim();
    const at = Util.findAnswer(en, answer);
    if (at < 0) answer = Util.guessAnswer(en, word);
    else answer = en.substr(at, answer.length);
    if (!en || !answer) return null;
    // A hint must not give away the target, including any content word of a phrase.
    const banned = new Set([Util.norm(word), Util.norm(answer)]);
    for (const part of `${word} ${answer}`.split(/\s+/)) {
      if (Util.norm(part).length > 3) banned.add(Util.norm(part));
    }
    const hints = (s.hints || [])
      .map(h => String(h).trim())
      .filter(h => h && !banned.has(Util.norm(h)))
      .slice(0, 3);
    return { en, ko: String(s.ko || '').trim(), answer, hints };
  }

  // items: [{ word, meaning }] -> [{ input, senses: [...] }] in the same order.
  async function generateWords(items, sentencesPerSense = 2) {
    const payload = items.map(it => {
      const p = { input: it.word };
      if (it.meaning) p.meaning_ko = it.meaning;
      if (it.note) p.note = it.note;
      if (it.existing && it.existing.length) p.existing_senses = it.existing.map(e => ({ meaning_ko: e.meaning, context_ko: e.context }));
      if (it.excludeExisting) p.exclude_existing = true;
      return p;
    });
    const user = `Sentences per sense: ${sentencesPerSense}\n\nItems:\n${JSON.stringify(payload, null, 2)}`;
    const data = await call(GENERATE_SYSTEM, user, GENERATE_SCHEMA);
    const entries = Array.isArray(data.entries) ? data.entries : [];
    return items.map((it, i) => {
      const e = entries.find(x => Util.norm(x.input) === Util.norm(it.word)) || entries[i] || { senses: [] };
      const senses = (e.senses || []).map(s => {
        const word = String(s.word || it.word).trim();
        const n = (it.existing || []).length;
        const idx = Number.isInteger(s.same_as_existing) ? s.same_as_existing : -1;
        return {
          word,
          sameAs: idx >= 0 && idx < n ? idx : -1,
          pos: String(s.pos || '').trim(),
          meaning: String(s.meaning || it.meaning || '').trim(),
          context: String(s.context || '').trim(),
          sentences: (s.sentences || []).map(x => cleanSentence(x, word)).filter(Boolean),
        };
      });
      return { input: it.word, senses };
    });
  }

  async function generateSentences(word, count = 2) {
    const user = JSON.stringify({
      word: word.word,
      pos: word.pos,
      meaning_ko: word.meaning,
      context_ko: word.context,
      count,
      existing_sentences: word.sentences.map(s => s.en),
    }, null, 2);
    const data = await call(MORE_SYSTEM, user, MORE_SCHEMA);
    return (data.sentences || []).map(s => cleanSentence(s, word.word)).filter(Boolean);
  }

  return { MODELS, generateWords, generateSentences };
})();
