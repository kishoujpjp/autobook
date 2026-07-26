// Gemini API 封裝：故事（JSON＋字表驗證重試）、插圖、TTS
import { settings, isHan } from './store.js';
import { pcmToWav, b64ToBytes } from './sfx.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

async function call(model, body, { timeoutMs = 90000, apiKey = null } = {}) {
  const key = apiKey || settings.apiKey;
  if (!key) throw new Error('NO_KEY');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        if (err.error && err.error.message) msg = `HTTP ${res.status}：${err.error.message.slice(0, 400)}`;
      } catch { /* ignore */ }
      throw new Error(msg);
    }
    return await res.json();
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

    const resp = await call(settings.textModel, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 1.0,
      },
    });

    let data;
    try {
      data = JSON.parse(firstText(resp));
    } catch {
      continue; // JSON 壞掉就重試
    }
    if (!data.story || !data.title) continue;

    const newChars = findNewChars(data.story, knownSet);
    const result = {
      title: data.title.trim(),
      text: data.story.trim(),
      imagePrompt: data.image_prompt || '',
      newChars,
    };
    if (newChars.length <= maxNew) return result;
    if (!best || newChars.length < best.newChars.length) best = result;
  }

  if (best) return best; // 接受新字最少的一次
  throw new Error('GEN_FAIL');
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
    resp = await call(settings.imageModel, body, { timeoutMs: 120000 });
  } catch (e) {
    // 某些模型版本不接受 imageConfig，退一步再試
    delete body.generationConfig.imageConfig;
    resp = await call(settings.imageModel, body, { timeoutMs: 120000 });
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
  }, { timeoutMs: 30000 });
  return firstText(resp) || '(空回覆)';
}

/** 單字 TTS，回傳 WAV Blob */
export async function ttsChar(ch) {
  const resp = await call(settings.ttsModel, {
    contents: [{ role: 'user', parts: [{ text: ch }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.voice || 'Leda' } },
      },
    },
  }, { timeoutMs: 45000, apiKey: settings.ttsApiKey || null });
  const inline = firstInline(resp, 'audio/');
  if (!inline) throw new Error('NO_AUDIO');
  const bytes = b64ToBytes(inline.data);
  // mimeType 形如 audio/L16;codec=pcm;rate=24000
  const rateMatch = /rate=(\d+)/.exec(inline.mimeType || '');
  const rate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
  return pcmToWav(bytes, rate, 1);
}
