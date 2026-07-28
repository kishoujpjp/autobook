// Gemini API 封裝：故事（JSON＋字表驗證重試）、插圖、TTS
import { settings, isHan } from './store.js';
import { pcmToWav, b64ToBytes } from './sfx.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ---------- 錯誤紀錄（設定頁「錯誤紀錄」可查看，除錯用） ----------
const ERRLOG_KEY = 'autobook.errlog';
const ERRLOG_MAX = 30;

export function readErrLog() {
  try { return JSON.parse(localStorage.getItem(ERRLOG_KEY)) || []; } catch { return []; }
}
export function clearErrLog() { localStorage.removeItem(ERRLOG_KEY); }

function logErr(stage, model, msg) {
  try {
    const log = readErrLog();
    log.unshift({ t: Date.now(), stage, model, msg: String(msg).slice(0, 500) });
    localStorage.setItem(ERRLOG_KEY, JSON.stringify(log.slice(0, ERRLOG_MAX)));
  } catch { /* 空間滿等狀況不影響主流程 */ }
}

/** 依錯誤訊息回傳「常見原因提示」的 i18n key；對不上回 null */
export function errHintKey(msg) {
  const s = String(msg);
  if (/NO_AUDIO|NO_IMAGE/.test(s)) return 'hint_nodata';
  if (/逾時|TIMEOUT/i.test(s)) return 'hint_timeout';
  if (/網路錯誤|Failed to fetch|NetworkError|Load failed/i.test(s)) return 'hint_network';
  if (/API key not valid|API_KEY_INVALID|API key expired/i.test(s)) return 'hint_badkey';
  const m = /HTTP (\d{3})/.exec(s);
  if (!m) return null;
  const c = +m[1];
  if (c === 400) return 'hint_400';
  if (c === 401 || c === 403) return 'hint_403';
  if (c === 404) return 'hint_404';
  if (c === 429) return 'hint_429';
  if (c >= 500) return 'hint_5xx';
  return null;
}

async function call(model, body, opts = {}) {
  const { timeoutMs = 90000, apiKey = null, stage = 'api', _retry = true } = opts;
  const key = apiKey || settings.apiKey;
  if (!key) throw new Error('NO_KEY');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetch(`${BASE}/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key,
        },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error(`逾時：${Math.round(timeoutMs / 1000)} 秒沒有回應`);
      // 行動網路偶發斷線（Safari「Load failed」）：等 1 秒自動重試一次
      if (_retry) {
        clearTimeout(timer);
        await new Promise((r) => setTimeout(r, 1000));
        return await call(model, body, { ...opts, _retry: false });
      }
      throw new Error(`網路錯誤：${(e && e.message) || e}`);
    }
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        if (err.error && err.error.message) msg = `HTTP ${res.status}：${err.error.message.slice(0, 400)}`;
      } catch { /* ignore */ }
      throw new Error(msg);
    }
    return await res.json();
  } catch (e) {
    if (!e.logged) { logErr(stage, model, e.message); e.logged = true; }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function firstText(resp) {
  const parts = resp?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || '').join('');
}

function firstInline(resp, mimePrefix) {
  const parts = resp?.candidates?.[0]?.content?.parts || [];
  for (const p of parts) {
    if (p.inlineData && (!mimePrefix || (p.inlineData.mimeType || '').startsWith(mimePrefix))) {
      return p.inlineData;
    }
  }
  return null;
}

// 找出故事中不在字表裡的「新字」（去重）
export function findNewChars(text, knownSet) {
  const out = [];
  for (const ch of text) {
    if (isHan(ch) && !knownSet.has(ch) && !out.includes(ch)) out.push(ch);
  }
  return out;
}

/**
 * 生成故事。會驗證新字數量，超過 2 個自動重試（最多 3 次），
 * 全部失敗時回傳新字最少的一次。
 * @returns {title, text, imagePrompt, newChars}
 */
export async function generateStory({ knownChars, mustInclude, priority, extraPrompt, lang, onStatus }) {
  const knownSet = new Set(knownChars);
  const langName = lang === 'zh-Hans' ? '简体中文' : '繁體中文';
  const maxNew = 2;

  const schema = {
    type: 'OBJECT',
    properties: {
      title: { type: 'STRING' },
      story: { type: 'STRING' },
      image_prompt: { type: 'STRING' },
    },
    required: ['title', 'story', 'image_prompt'],
  };

  let best = null;
  const notes = []; // 每次嘗試的失敗原因（除錯用）

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (onStatus) onStatus(attempt);
    const feedback = best
      ? `\n注意：上一次你用了太多表外字（${best.newChars.join('、')}），這次務必把表外字控制在 ${maxNew} 個以內，優先只用認字表中的字改寫。`
      : '';
    const prompt = [
      `你是幼兒繪本作家，為5歲小朋友寫一個溫馨、有趣、正向的小故事。使用${langName}。`,
      `【認字表】（正文幾乎只能用這些字）：`,
      knownChars.join(''),
      ``,
      `規則：`,
      `1. 故事正文只能使用認字表中的字。整篇最多允許出現 ${maxNew} 個「表外新字」（同一個新字重複出現只算 1 個）。認字表以外的字愈少愈好。`,
      `2. 標點符號不受限制，請正常使用標點。不可使用阿拉伯數字與英文字母。`,
      `3. 正文長度約 180～220 個字。`,
      mustInclude.length ? `4. 這些字必須出現在正文中：${mustInclude.join('、')}` : `4. （無指定必用字）`,
      priority.length ? `5. 請盡量多使用這些較少練習的字：${priority.join('、')}` : `5. （無優先字）`,
      `6. 標題要短（8 個字以內），盡量也用認字表中的字。`,
      extraPrompt ? `7. 額外要求：${extraPrompt}` : ``,
      feedback,
      ``,
      `另外輸出 image_prompt：用英文描述一張配圖（一個場景即可），風格為 soft watercolor children's picture book illustration, cute, warm, bright colors, no text, no words.`,
    ].filter(Boolean).join('\n');

    let resp;
    try {
      resp = await call(settings.textModel, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 1.0,
        },
      }, { stage: 'story' });
    } catch (e) {
      // 網路閃斷/逾時不中斷整輪：換下一次嘗試；其他錯誤（key/模型問題）直接丟出
      if (/網路錯誤|逾時/.test(e.message)) {
        notes.push(`第 ${attempt} 次：${e.message}`);
        continue;
      }
      throw e;
    }

    let data;
    try {
      data = JSON.parse(firstText(resp));
    } catch {
      notes.push(`第 ${attempt} 次：模型輸出不是有效的 JSON`);
      continue; // JSON 壞掉就重試
    }
    if (!data.story || !data.title) {
      notes.push(`第 ${attempt} 次：缺少 title/story 欄位`);
      continue;
    }

    const newChars = findNewChars(data.story, knownSet);
    const result = {
      title: data.title.trim(),
      text: data.story.trim(),
      imagePrompt: data.image_prompt || '',
      newChars,
    };
    if (newChars.length <= maxNew) return result;
    notes.push(`第 ${attempt} 次：表外新字 ${newChars.length} 個（${newChars.slice(0, 10).join('、')}）`);
    if (!best || newChars.length < best.newChars.length) best = result;
  }

  if (best) return best; // 接受新字最少的一次
  const err = new Error('GEN_FAIL');
  err.detail = notes.join('\n');
  logErr('story', settings.textModel, `GEN_FAIL：${notes.join('；')}`);
  throw err;
}

/**
 * 偵測故事中的多音字（破音字）：回傳 [{char, word}]。
 * word 是該字在文中所屬的詞（故事裡實際連續出現的字串）；
 * 之後 TTS 以「整個詞」為單位快取，點讀多音字時播詞的音，避免單字唸錯讀音。
 */
export async function detectPolys(text) {
  const prompt = [
    '以下是一篇給幼兒的中文故事。請找出正文中的「多音字（破音字）」：',
    '指在這篇故事中的讀音，和這個字「單獨唸一個字」時最常見讀音不同的字。',
    '每個回報兩個欄位：char（單一個字）、word（它在故事中所屬的詞，2~3 個字，必須是故事中實際連續出現、且包含該字的字串）。',
    '只列讀音真的不同、需要注意的；沒有就回傳空陣列。',
    '',
    '故事：',
    text,
  ].join('\n');
  const resp = await call(settings.textModel, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          items: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { char: { type: 'STRING' }, word: { type: 'STRING' } },
              required: ['char', 'word'],
            },
          },
        },
        required: ['items'],
      },
    },
  }, { stage: 'poly' });
  let data;
  try {
    data = JSON.parse(firstText(resp));
  } catch {
    return []; // 偵測失敗不影響主流程，缺多音字資料時點讀退回單字音
  }
  return (data.items || []).filter((p) =>
    p && typeof p.char === 'string' && typeof p.word === 'string' &&
    [...p.char].length === 1 && p.word.includes(p.char) && text.includes(p.word));
}

/** 生成插圖，回傳 Blob */
export async function generateImage(imagePrompt) {
  const prompt = `Children's picture book illustration, soft watercolor style, cute and warm, bright cheerful colors, suitable for a 5-year-old. No text or letters in the image. Scene: ${imagePrompt}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: '4:3' },
    },
  };
  let resp;
  try {
    resp = await call(settings.imageModel, body, { timeoutMs: 120000, stage: 'image' });
  } catch (e) {
    // 某些模型版本不接受 imageConfig，退一步再試
    delete body.generationConfig.imageConfig;
    resp = await call(settings.imageModel, body, { timeoutMs: 120000, stage: 'image' });
  }
  const inline = firstInline(resp, 'image/');
  if (!inline) throw new Error('NO_IMAGE');
  const bytes = b64ToBytes(inline.data);
  return new Blob([bytes], { type: inline.mimeType || 'image/png' });
}

/** 測試連線：打一次文字模型，成功回傳模型回覆，失敗丟出含完整訊息的錯誤 */
export async function testConnection() {
  const resp = await call(settings.textModel, {
    contents: [{ role: 'user', parts: [{ text: '請回答：好' }] }],
  }, { timeoutMs: 30000, stage: 'test' });
  return firstText(resp) || '(空回覆)';
}

/**
 * 全面診斷：依生成繪本實際用到的方式，逐一測試文字、JSON 結構輸出、插圖、語音四項。
 * onUpdate(key, state)：state 為 'run' 或 {ok, msg}；回傳全部結果。
 */
export async function testModels(onUpdate) {
  const results = [];
  const run = async (key, fn) => {
    if (onUpdate) onUpdate(key, 'run');
    let r;
    try { await fn(); r = { key, ok: true }; }
    catch (e) { r = { key, ok: false, msg: e.message }; }
    results.push(r);
    if (onUpdate) onUpdate(key, r);
  };

  await run('diag_text', () => call(settings.textModel, {
    contents: [{ role: 'user', parts: [{ text: '請回答：好' }] }],
  }, { timeoutMs: 30000, stage: 'test' }));

  await run('diag_json', async () => {
    const resp = await call(settings.textModel, {
      contents: [{ role: 'user', parts: [{ text: '輸出一個 JSON：title 填「好」、story 填「好」、image_prompt 填「ok」。' }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: { title: { type: 'STRING' }, story: { type: 'STRING' }, image_prompt: { type: 'STRING' } },
          required: ['title', 'story', 'image_prompt'],
        },
        temperature: 1.0,
      },
    }, { timeoutMs: 45000, stage: 'test' });
    JSON.parse(firstText(resp)); // 解析不了視同失敗
  });

  await run('diag_image', async () => {
    const resp = await call(settings.imageModel, {
      contents: [{ role: 'user', parts: [{ text: 'A single small red heart on a white background, minimal.' }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }, { timeoutMs: 120000, stage: 'test' });
    if (!firstInline(resp, 'image/')) throw new Error('NO_IMAGE');
  });

  // 走與實際發音完全相同的路徑（含朗讀指示），避免診斷通過但實際失敗的落差
  await run('diag_tts', () => ttsChar('好'));

  return results;
}

/** AI 出跟讀題：回傳英文單字/短句陣列 */
export async function generatePhrases({ topic, count = 10, mode = 'word' }) {
  const kind = mode === 'sentence'
    ? 'very short simple English sentences (3-6 words each)'
    : 'simple English words (1 word each, occasionally 2-word phrases)';
  const prompt = [
    `Generate ${count} ${kind} for a 5-year-old child learning English as a second language.`,
    topic ? `Topic: ${topic}.` : 'Use everyday topics a young child knows (animals, food, family, colors...).',
    'Keep vocabulary very basic and friendly. No duplicates. Output JSON only.',
  ].join(' ');
  const resp = await call(settings.textModel, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: { items: { type: 'ARRAY', items: { type: 'STRING' } } },
        required: ['items'],
      },
    },
  }, { stage: 'phrase' });
  const data = JSON.parse(firstText(resp));
  return (data.items || []).filter((s) => typeof s === 'string' && s.trim());
}

/** 跟讀配圖：回傳 Blob */
export async function generatePhraseImage(text) {
  const prompt = `A single cute, friendly illustration for a children's English flashcard showing: "${text}". Soft watercolor style, bright warm colors, simple composition on clean light background, no text, no letters, no words in the image.`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: '4:3' },
    },
  };
  let resp;
  try {
    resp = await call(settings.imageModel, body, { timeoutMs: 120000, stage: 'image' });
  } catch {
    delete body.generationConfig.imageConfig;
    resp = await call(settings.imageModel, body, { timeoutMs: 120000, stage: 'image' });
  }
  const inline = firstInline(resp, 'image/');
  if (!inline) throw new Error('NO_IMAGE');
  return new Blob([b64ToBytes(inline.data)], { type: inline.mimeType || 'image/png' });
}

/** 任意文字 TTS（英文句子也可），回傳 WAV Blob */
export async function ttsText(text) {
  return ttsChar(text);
}

/**
 * 單字／短句 TTS，回傳 WAV Blob。
 * TTS 模型是「被要求只出聲音的 LLM」，有兩個坑要用指示講死：
 * 1) 單字直接送會被當成聊天訊息 → 想用文字回答（HTTP 400，或 200 但沒有音訊）
 * 2) 單一漢字會讓它猜錯語言（玉→tama、田→tan 是日語訓讀）→ 中文一律指定臺灣華語正式讀音
 * 失敗會換一種提示重試，全失敗才丟 NO_AUDIO（附模型實際回應，見錯誤紀錄）。
 */
export async function ttsChar(text) {
  // 指示本身用短英文（實測長中文指示會讓 preview TTS 大量回 finishReason=OTHER），
  // 但語言用指示講死成臺灣華語；OTHER 多為暫時性失敗，同提示重試常會過
  const isZh = /\p{Script=Han}/u.test(text);
  const prompts = isZh ? [
    `Say in Taiwanese Mandarin, warm and friendly: ${text}`,
    `Read aloud in Mandarin Chinese with standard Taiwan pronunciation: ${text}`,
    `Say in Taiwanese Mandarin, warm and friendly: ${text}`,
  ] : [
    `Read aloud in a warm, friendly voice: ${text}`,
    `This is a script to read aloud in English. Say exactly this and nothing else: ${text}`,
  ];

  let detail = '';
  for (let i = 0; i < prompts.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 600)); // 暫時性失敗的退避間隔
    let resp;
    try {
      resp = await call(settings.ttsModel, {
        contents: [{ role: 'user', parts: [{ text: prompts[i] }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.voice || 'Leda' } },
          },
        },
      }, { timeoutMs: 45000, apiKey: settings.ttsApiKey || null, stage: 'tts' });
    } catch (e) {
      // 模型想回文字被 API 擋（400）：換下一種提示再試；其他錯誤直接丟出
      if (i < prompts.length - 1 && /generate text/i.test(e.message)) {
        detail = e.message;
        continue;
      }
      throw e;
    }
    const inline = firstInline(resp, 'audio/');
    if (inline) {
      const bytes = b64ToBytes(inline.data);
      // mimeType 形如 audio/L16;codec=pcm;rate=24000
      const rateMatch = /rate=(\d+)/.exec(inline.mimeType || '');
      const rate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
      return pcmToWav(bytes, rate, 1);
    }
    // 有回應但沒有音訊：記下模型實際回了什麼，換下一種提示
    const cand = (resp && resp.candidates && resp.candidates[0]) || null;
    const txt = firstText(resp).slice(0, 60);
    detail = `finishReason=${(cand && cand.finishReason) || '?'}${txt ? `，模型回了文字：「${txt}」` : ''}`;
    logErr('tts', settings.ttsModel, `NO_AUDIO（提示 ${i + 1}/${prompts.length}）：${detail}`);
  }
  throw new Error(`NO_AUDIO：${detail}`);
}
