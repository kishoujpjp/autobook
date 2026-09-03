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
  emitLog(`⚠️ [${stage}] ${msg}`);
}

// ---------- 生成進度 log（生成視窗即時顯示，除錯用） ----------
let logListener = null;
/** 生成視窗訂閱 API 層的進度/錯誤訊息；傳 null 取消訂閱 */
export function setLogListener(fn) { logListener = fn; }
function emitLog(msg) {
  if (logListener) { try { logListener(msg); } catch { /* 顯示失敗不影響主流程 */ } }
}

/** 依錯誤訊息回傳「常見原因提示」的 i18n key；對不上回 null */
export function errHintKey(msg) {
  const s = String(msg);
  if (/^BLOCKED/.test(s)) return 'hint_blocked';
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

/** 使用者按「停止」→ 呼叫端傳進來的 signal 已中止；統一丟 CANCELLED（不重試、不記錯誤紀錄） */
const CANCELLED = 'CANCELLED';
function linkSignal(ac, signal) {
  if (!signal) return;
  if (signal.aborted) ac.abort();
  else signal.addEventListener('abort', () => ac.abort(), { once: true });
}

async function call(model, body, opts = {}) {
  const { timeoutMs = 90000, apiKey = null, stage = 'api', _retries = 2, signal = null } = opts;
  const key = apiKey || settings.apiKey;
  if (!key) throw new Error('NO_KEY');
  if (signal && signal.aborted) throw new Error(CANCELLED);
  const ac = new AbortController();
  linkSignal(ac, signal);
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
      if (e && e.name === 'AbortError') {
        throw new Error(signal && signal.aborted ? CANCELLED : `逾時：${Math.round(timeoutMs / 1000)} 秒沒有回應`);
      }
      // 行動網路偶發斷線（Safari「Load failed」）：自動重試 2 次（1 秒、3 秒退避）
      if (_retries > 0) {
        clearTimeout(timer);
        const delay = _retries === 2 ? 1000 : 3000;
        emitLog(`🔁 [${stage}] 網路錯誤（${(e && e.message) || e}），${delay / 1000} 秒後自動重試…`);
        await new Promise((r) => setTimeout(r, delay));
        return await call(model, body, { ...opts, _retries: _retries - 1 });
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
    if (!e.logged && e.message !== CANCELLED) { logErr(stage, model, e.message); e.logged = true; }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 串流版文字生成，回傳完整文字。
 * 行動 Safari 會把「長時間沒有回應的單一請求」直接砍掉（約 60 秒，錯誤顯示
 * Load failed）；故事生成要等模型寫完整篇才回傳，最容易中獎。
 * 改走 streamGenerateContent（SSE）讓資料持續流動，就不會被判定逾時。
 */
async function callStreamText(model, body, opts = {}) {
  return (await callStream(model, body, opts)).text;
}

/** 串流共用底層：回傳 { text, inlineMime, inlineData }（inlineData 為 base64，分段自動串接） */
async function callStream(model, body, opts = {}) {
  const { timeoutMs = 150000, stage = 'api', _retries = 2, signal = null } = opts;
  const key = settings.apiKey;
  if (!key) throw new Error('NO_KEY');
  if (signal && signal.aborted) throw new Error(CANCELLED);
  const ac = new AbortController();
  linkSignal(ac, signal);
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  // 連線失敗與讀流中斷都包成「網路錯誤」；逾時（自己 abort）另外標；使用者停止＝CANCELLED
  const netErr = (e) => new Error(e && e.name === 'AbortError'
    ? (signal && signal.aborted ? CANCELLED : `逾時：${Math.round(timeoutMs / 1000)} 秒沒有回應`)
    : `網路錯誤：${(e && e.message) || e}`);
  try {
    let res;
    try {
      res = await fetch(`${BASE}/${model}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key,
        },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
    } catch (e) {
      throw netErr(e);
    }
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        const eo = Array.isArray(err) ? err[0] : err; // 串流端點的錯誤可能包在陣列裡
        if (eo && eo.error && eo.error.message) msg = `HTTP ${res.status}：${eo.error.message.slice(0, 400)}`;
      } catch { /* ignore */ }
      throw new Error(msg);
    }

    let text = '';
    let inlineMime = null;
    const inlineParts = [];
    let finishReason = null; // SAFETY／RECITATION／MAX_TOKENS 等；被擋時才不會只看到「不是有效的 JSON」
    let blockReason = null;
    let buf = '';
    const takeLines = () => {
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const chunk = JSON.parse(payload);
          if (chunk?.promptFeedback?.blockReason) blockReason = chunk.promptFeedback.blockReason;
          if (chunk?.candidates?.[0]?.finishReason) finishReason = chunk.candidates[0].finishReason;
          const parts = chunk?.candidates?.[0]?.content?.parts || [];
          for (const p of parts) {
            if (p.text) text += p.text;
            if (p.inlineData && p.inlineData.data) {
              if (!inlineMime) inlineMime = p.inlineData.mimeType || '';
              inlineParts.push(p.inlineData.data);
            }
          }
        } catch { /* 不完整的行，等下一個 chunk */ }
      }
    };

    try {
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          takeLines();
        }
        buf += '\n';
        takeLines();
      } else {
        buf = (await res.text()) + '\n';
        takeLines();
      }
    } catch (e) {
      // 讀到一半斷線（行動 Safari 常見 Load failed）也算網路錯誤
      throw netErr(e);
    }
    // 什麼都沒回：被安全過濾擋下、或引用限制，把真因講出來（以前只會變成「不是有效的 JSON」重試三次）
    if (!text && !inlineParts.length && (blockReason || (finishReason && finishReason !== 'STOP'))) {
      throw new Error(`BLOCKED：${blockReason || finishReason}`);
    }
    return { text, inlineMime, inlineParts, finishReason };
  } catch (e) {
    // 行動網路偶發斷線：自動重試 2 次（1 秒、3 秒退避；與 call() 相同策略；逾時不重試）
    if (_retries > 0 && e.message.startsWith('網路錯誤')) {
      clearTimeout(timer);
      const delay = _retries === 2 ? 1000 : 3000;
      emitLog(`🔁 [${stage}] ${e.message}，${delay / 1000} 秒後自動重試…`);
      await new Promise((r) => setTimeout(r, delay));
      return await callStream(model, body, { ...opts, _retries: _retries - 1 });
    }
    if (!e.logged && e.message !== CANCELLED) { logErr(stage, model, e.message); e.logged = true; }
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

// ---------- 思考設定：少想快寫 ----------
// 會思考的模型（gemini-3 / gemini-2.5 文字系）收到請求後可能沉默 30~60 秒才吐第一個字，
// SSE 連線這段時間沒有資料流動，行動 Safari 會把閒置連線砍掉（Load failed）。
// 把思考壓到最低：第一批字幾秒內就到，連線開始流動就不會被砍；幼兒繪本也不需要深思。
// 模型不吃 thinkingConfig（HTTP 400）時記住 10 分鐘、只記那個模型：以前是全域永久關掉，
// 任何一次 400（包含跟 thinking 無關的）都會讓之後每次生成回到「沉默 30 秒被砍線」的老問題
const THINK_OFF_MS = 10 * 60 * 1000;
const thinkOffUntil = new Map(); // model → timestamp
function thinkCfg(model) {
  if ((thinkOffUntil.get(model) || 0) > Date.now()) return {};
  if (/^gemini-3/.test(model)) return { thinkingConfig: { thinkingLevel: 'low' } };
  if (/^gemini-2\.5/.test(model)) return { thinkingConfig: { thinkingBudget: 0 } };
  return {};
}

/** 帶 thinkingConfig 呼叫串流文字；遇 HTTP 400（模型不支援）自動拿掉重試一次 */
async function callStreamTextThink(model, generationConfig, prompt, opts) {
  const cfg = thinkCfg(model);
  try {
    return await callStreamText(model, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { ...generationConfig, ...cfg },
    }, opts);
  } catch (e) {
    if (cfg.thinkingConfig && /HTTP 400/.test(e.message)) {
      thinkOffUntil.set(model, Date.now() + THINK_OFF_MS);
      emitLog(`⚠️ 模型不支援 thinkingConfig（${e.message.slice(0, 80)}），改用預設重試`);
      return await callStreamText(model, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      }, opts);
    }
    throw e;
  }
}

export const STORY_MAX_CHARS = 1500; // 故事內文上限（正常約 200 字）

/** 洗牌（Fisher–Yates）：字表注入提示詞前打亂，避免模型每次看到同樣的開頭 */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- 故事元素比例（雷達圖）→ 提示詞 ----------
// 直接給模型百分比數字跟隨度很差；改成「檔位→具體寫作指令」＋輕重排序。
// 檔位：0＝不提、1~3＝低、4~6＝中、7~10＝高（tiers[0/1/2]）
const MIX_AXES = [
  { key: 'warm', name: '溫馨', tiers: [
    '帶一點溫馨的互動',
    '要有溫馨的親情或友情橋段',
    '整體氛圍以溫馨關愛為主'] },
  { key: 'fun', name: '有趣', tiers: [
    '帶一點幽默',
    '要有好玩有趣的情節',
    '以有趣好笑為主軸，要讓小朋友發笑'] },
  { key: 'conflict', name: '衝突', tiers: [
    '可以有很小的分歧或阻礙',
    '要有一個小衝突（例如朋友吵架、心愛的東西壞了），結尾要解決',
    '衝突是故事主軸：明顯的矛盾或困難貫穿全篇，最後才化解'] },
  { key: 'sad', name: '悲傷', tiers: [
    '可以有一小段令人難過的情節',
    '要有一段明顯難過的情節（例如失去、分離）',
    '悲傷是故事重點：主角經歷深刻的難過，情感要真摯'] },
  { key: 'mistake', name: '犯錯', tiers: [
    '主角可以有小小的疏忽',
    '主角要犯一個錯誤，並在故事中發現與改正',
    '犯錯與改正是故事主軸：主角犯下明顯的錯，經歷後果並學到教訓'] },
];

function mixSection(mix) {
  const active = MIX_AXES
    .map((a) => ({ ...a, v: Math.max(0, Math.min(10, Math.round((mix && mix[a.key]) || 0))) }))
    .filter((a) => a.v > 0)
    .sort((x, y) => y.v - x.v);
  const lines = ['【故事氛圍】'];
  if (active.length) {
    lines.push(`氛圍比重（由重到輕）：${active.map((a) => a.name).join('＞')}`);
    for (const a of active) lines.push(`- ${a.name}：${a.tiers[a.v >= 7 ? 2 : a.v >= 4 ? 1 : 0]}`);
  } else {
    lines.push('溫馨、有趣、正向。');
  }
  lines.push('不論氛圍如何，內容必須適合 5 歲幼兒，結局要溫暖正向。');
  return lines;
}

/**
 * 生成故事。會驗證新字數量，超過 5 個自動重試（最多 3 次）；
 * 三次都超標時採用「最後一次」嘗試——它經過回饋修正，通常最通順
 * （表外字最少的那次往往是句子扭得最厲害的，故意不選）。
 * @param mix 故事元素比例 {warm, fun, conflict, sad, mistake}（0~10）
 * @param wantImage 要不要一併要求 image_prompt（關閉插圖時省掉）
 * @returns {title, text, imagePrompt, newChars}
 */
export async function generateStory({ knownChars, mustInclude, extraPrompt, mix, wantImage = true, onStatus, signal = null }) {
  const knownSet = new Set(knownChars);
  const maxNew = 5;

  const schema = {
    type: 'OBJECT',
    properties: {
      title: { type: 'STRING' },
      story: { type: 'STRING' },
      ...(wantImage ? { image_prompt: { type: 'STRING' } } : {}),
    },
    required: wantImage ? ['title', 'story', 'image_prompt'] : ['title', 'story'],
  };

  let last = null;  // 最後一次超標的嘗試（回饋與最終回退都用它）
  const notes = []; // 每次嘗試的失敗原因（除錯用）

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (onStatus) onStatus(attempt);
    emitLog(`✍️ 第 ${attempt}/3 次撰寫（${settings.textModel}）…`);
    const feedback = last
      ? `\n注意：上一次你用了太多表外字（${last.newChars.join('、')}），這次務必把表外字控制在 ${maxNew} 個以內，優先只用認字表中的字改寫，但句子仍然要通順。`
      : '';
    const prompt = [
      `你是幼兒繪本作家，為5歲小朋友寫一個小故事。使用繁體中文。`,
      `【認字表】（正文幾乎只能用這些字）：`,
      shuffle(knownChars).join(''),
      ``,
      ...mixSection(mix),
      ``,
      `規則：`,
      `1. 故事正文只能使用認字表中的字。整篇最多允許出現 ${maxNew} 個「表外新字」（同一個新字重複出現只算 1 個）。認字表以外的字愈少愈好。`,
      `2. 最重要：每一句話都必須通順自然、符合中文語法。絕對不可以為了避開表外字而省略字、硬拆詞、或拼出不存在的詞。如果某句話一定要用表外字才通順，就直接用（計入上限）；如果表外字快用完了，就換一個用表內字能自然表達的情節或說法，而不是硬寫。`,
      `3. 標點符號不受限制，請正常使用標點。不可使用阿拉伯數字與英文字母。`,
      `4. 正文長度約 150～180 個字。`,
      mustInclude.length ? `5. 這些字必須出現在正文中：${mustInclude.join('、')}` : `5. （無指定必用字）`,
      `6. 標題要短（8 個字以內），盡量也用認字表中的字。`,
      extraPrompt ? `7. 額外要求：${extraPrompt}` : ``,
      feedback,
      ``,
      wantImage ? `另外輸出 image_prompt：用英文描述一張配圖的場景（一個場景即可），只描述畫面內容與角色動作，不要指定畫風。` : ``,
    ].filter(Boolean).join('\n');

    let rawText;
    try {
      rawText = await callStreamTextThink(settings.textModel, {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0.9, // 1.0 → 0.9：降一點隨機性讓句構更穩（缺字/怪詞變少）
      }, prompt, { stage: 'story', signal });
    } catch (e) {
      // 網路閃斷/逾時不中斷整輪：換下一次嘗試；其他錯誤（key/模型問題）直接丟出
      if (/網路錯誤|逾時/.test(e.message)) {
        notes.push(`第 ${attempt} 次：${e.message}`);
        emitLog(`❌ 第 ${attempt} 次失敗：${e.message}`);
        continue;
      }
      throw e;
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      notes.push(`第 ${attempt} 次：模型輸出不是有效的 JSON`);
      emitLog(`❌ 第 ${attempt} 次失敗：模型輸出不是有效的 JSON`);
      continue; // JSON 壞掉就重試
    }
    if (!data.story || !data.title) {
      notes.push(`第 ${attempt} 次：缺少 title/story 欄位`);
      emitLog(`❌ 第 ${attempt} 次失敗：缺少 title/story 欄位`);
      continue;
    }
    // 輸出上限：繪本約 200 字；模型失控吐幾萬字會建幾萬顆字塊把頁面卡死
    if (typeof data.story !== 'string' || typeof data.title !== 'string' ||
        data.story.length > STORY_MAX_CHARS || data.title.length > 40) {
      notes.push(`第 ${attempt} 次：輸出太長（${String(data.story).length} 字）`);
      emitLog(`❌ 第 ${attempt} 次失敗：輸出太長（${String(data.story).length} 字，上限 ${STORY_MAX_CHARS}）`);
      continue;
    }

    const newChars = findNewChars(data.story, knownSet);
    const result = {
      title: data.title.trim(),
      text: data.story.trim(),
      imagePrompt: wantImage ? (data.image_prompt || '') : '',
      newChars,
    };
    if (newChars.length <= maxNew) return result;
    notes.push(`第 ${attempt} 次：表外新字 ${newChars.length} 個（${newChars.slice(0, 10).join('、')}）`);
    emitLog(`🔁 第 ${attempt} 次：表外新字 ${newChars.length} 個（${newChars.slice(0, 10).join('、')}），重寫`);
    last = result;
  }

  if (last) { emitLog(`⚠️ 三次都超標，採用最後一次（表外新字 ${last.newChars.length} 個，經回饋修正通常最通順）`); return last; }
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
export async function detectPolys(text, signal = null) {
  const prompt = [
    '以下是一篇給幼兒的中文故事。請找出正文中的「多音字（破音字）」：',
    '指在這篇故事中的讀音，和這個字「單獨唸一個字」時最常見讀音不同的字。',
    '每個回報兩個欄位：char（單一個字）、word（它在故事中所屬的詞，2~3 個字，必須是故事中實際連續出現、且包含該字的字串）。',
    '只列讀音真的不同、需要注意的；沒有就回傳空陣列。',
    '',
    '故事：',
    text,
  ].join('\n');
  const rawText = await callStreamTextThink(settings.textModel, {
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
  }, prompt, { stage: 'poly', signal });
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    return []; // 偵測失敗不影響主流程，缺多音字資料時點讀退回單字音
  }
  return (data.items || []).filter((p) =>
    p && typeof p.char === 'string' && typeof p.word === 'string' &&
    [...p.char].length === 1 && p.word.includes(p.char) && text.includes(p.word));
}

/** 生成插圖，回傳 Blob */
/**
 * 合併串流回來的 base64 片段。分段可能是「各自完整的 base64」或
 * 「同一段 base64 的切片」，先各自解碼（切片若剛好 4 的倍數亦等價），
 * 解不開才退回字串串接後解碼。
 */
export function joinB64(parts) {
  if (parts.length === 1) return b64ToBytes(parts[0]);
  try {
    const arrs = parts.map(b64ToBytes);
    const out = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0));
    let off = 0;
    for (const a of arrs) { out.set(a, off); off += a.length; }
    return out;
  } catch {
    return b64ToBytes(parts.join(''));
  }
}

/**
 * 串流生成圖片，回傳 Blob。
 * 與故事同理：出圖要等模型畫完才回傳，行動 Safari 容易砍線（Load failed），
 * 所以走 streamGenerateContent，圖片資料分段接收後再合併。
 */
async function streamImage(prompt, signal = null) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: '4:3' },
    },
  };
  let out;
  try {
    out = await callStream(settings.imageModel, body, { timeoutMs: 150000, stage: 'image', signal });
  } catch (e) {
    // 網路/逾時/停止/金鑰額度（401/403/429）/被擋 再試也是一樣的結果，直接丟出；
    // 其餘（多為模型不吃 imageConfig 的 400）退一步重試一次
    if (/網路錯誤|逾時|CANCELLED|BLOCKED|HTTP (401|403|429)/.test(e.message)) throw e;
    delete body.generationConfig.imageConfig;
    out = await callStream(settings.imageModel, body, { timeoutMs: 150000, stage: 'image', signal });
  }
  if (!out.inlineParts.length) throw new Error('NO_IMAGE');
  // mime 由模型回報：只收圖片，其他一律不存進 IndexedDB
  const mime = out.inlineMime || 'image/png';
  if (!/^image\/(png|jpeg|webp|gif)$/i.test(mime)) throw new Error(`NO_IMAGE（${mime}）`);
  return new Blob([joinB64(out.inlineParts)], { type: mime });
}

// ---------- 插圖風格池：每次出圖隨機選一種，畫風多樣化 ----------
export const IMAGE_STYLES = [
  { name: '柔和水彩', en: 'soft watercolor children\'s picture book illustration, gentle brush strokes, warm bright colors' },
  { name: '蠟筆手繪', en: 'crayon and oil pastel children\'s drawing style, childlike hand-drawn texture, playful vivid colors' },
  { name: '剪紙拼貼', en: 'paper-cut collage children\'s book illustration, layered textured paper shapes, bold cheerful colors' },
  { name: '扁平卡通', en: 'flat vector cartoon illustration for kids, bold simple shapes, bright happy colors, clean composition' },
  { name: '色鉛筆繪本', en: 'colored pencil storybook illustration, soft grainy texture, warm cozy tones, gentle details' },
];

export function pickImageStyle() {
  return IMAGE_STYLES[(Math.random() * IMAGE_STYLES.length) | 0];
}

export async function generateImage(imagePrompt, style, signal = null) {
  const s = style || pickImageStyle();
  return streamImage(`Children's picture book illustration in ${s.en} style. Cute, warm and friendly, suitable for a 5-year-old. No text, letters or words in the image. Scene: ${imagePrompt}`, signal);
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

  // 走與實際故事生成相同的串流路徑（含 thinkingConfig），避免診斷通過但實際失敗的落差
  await run('diag_json', async () => {
    const raw = await callStreamTextThink(settings.textModel, {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: { title: { type: 'STRING' }, story: { type: 'STRING' }, image_prompt: { type: 'STRING' } },
        required: ['title', 'story', 'image_prompt'],
      },
      temperature: 0.9,
    }, '輸出一個 JSON：title 填「好」、story 填「好」、image_prompt 填「ok」。', { timeoutMs: 45000, stage: 'test' });
    JSON.parse(raw); // 解析不了視同失敗
  });

  // 走與實際出圖相同的串流路徑，避免診斷通過但實際失敗的落差
  await run('diag_image', () => streamImage('A single small red heart on a white background, minimal.'));

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
export async function generatePhraseImage(text, signal = null) {
  return streamImage(`A single cute, friendly illustration for a children's English flashcard showing: "${text}". Soft watercolor style, bright warm colors, simple composition on clean light background, no text, no letters, no words in the image.`, signal);
}

/** 任意文字 TTS（英文句子也可），回傳 WAV Blob */
export async function ttsText(text, signal = null) {
  return ttsChar(text, signal);
}

/**
 * 單字／短句 TTS，回傳 WAV Blob。
 * TTS 模型是「被要求只出聲音的 LLM」，有兩個坑要用指示講死：
 * 1) 單字直接送會被當成聊天訊息 → 想用文字回答（HTTP 400，或 200 但沒有音訊）
 * 2) 單一漢字會讓它猜錯語言（玉→tama、田→tan 是日語訓讀）→ 中文一律指定臺灣華語正式讀音
 * 失敗會換一種提示重試，全失敗才丟 NO_AUDIO（附模型實際回應，見錯誤紀錄）。
 */
export async function ttsChar(text, signal = null) {
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
      }, { timeoutMs: 45000, apiKey: settings.ttsApiKey || null, stage: 'tts', signal });
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
