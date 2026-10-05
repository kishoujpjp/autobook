// 接收一本書的流程。注入儲存／下載函式，方便驗證斷線、配額滿、回條失敗等情況。
import { validateManifest, validateIllustrationManifest, illustrationReceiptId, imageMime, sha256, InboxError } from './inbox-format.js';
import { prepareStoredStory, TEXT_POLICY_VERSION } from './text-policy.js';

export async function inboxStoryId(source, remoteId) {
  return `inbox_${(await sha256(`${source}|${remoteId}`)).slice(0, 32)}`;
}

async function checkedImage(blob, im, io) {
  if (blob.size !== im.size || blob.type.split(';')[0] !== im.mime) throw new InboxError('image');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (imageMime(bytes) !== im.mime || await sha256(bytes) !== im.sha256) throw new InboxError('image');
  return io.prepare(blob);
}

export async function receiveInboxStory(raw, source, io) {
  const packet = validateManifest(raw);
  const id = await inboxStoryId(source, packet.id);
  const receipt = io.receipt(source, packet.id);
  if (receipt) {
    if (receipt.ackPending) {
      await io.ack(packet.id);
      io.saveReceipt(source, packet.id, false);
    }
    return false;
  }
  // localStorage 的故事寫入成功、接收紀錄失敗時，下一輪從已存好的書恢復。
  const existing = io.findStory(id);
  if (existing) {
    io.saveReceipt(source, packet.id, true);
    await io.ack(packet.id);
    io.saveReceipt(source, packet.id, false);
    return false;
  }
  if (!io.hasRoom()) throw new InboxError('shelf_full');
  const stored = [];
  let committed = false;
  const story = prepareStoredStory({
    id, title: packet.title, text: packet.text, lang: packet.lang, createdAt: packet.createdAt,
    hasImage: true, imagePrompt: packet.imagePrompt,
    manual: true, media: [], inbox: { source, id: packet.id },
  }, new Set(), { legacy: packet.textPolicy !== TEXT_POLICY_VERSION });
  story.newChars = io.newChars(story.text);
  try {
    for (const im of packet.images) {
      const blob = await io.download(packet.id, im.index);
      const prepared = await checkedImage(blob, im, io);
      const key = `${id}|m${im.index}`;
      stored.push(key); // 即使 put 在交易結束前失敗，也讓清理涵蓋這個 key
      await io.put(key, prepared);
      story.media.push({ id: key, kind: 'image', up: true });
    }
    io.checkActive();
    io.commit(story);
    committed = true;
    io.onImported(story);
  } catch (e) {
    // 若故事已落盤、只是接收紀錄失敗，不能把它引用的圖片刪掉。
    if (!committed && !io.findStory(id)) await Promise.allSettled(stored.map((key) => io.remove(key)));
    throw e;
  }
  await io.ack(packet.id);
  io.saveReceipt(source, packet.id, false);
  return true;
}

/** 追加封包獨立於整本書；只有圖片與去重紀錄可以改動。 */
export async function receiveInboxIllustrations(raw, source, io) {
  const packet = validateIllustrationManifest(raw);
  const receiptId = illustrationReceiptId(packet.id);
  const finish = async (outcome) => {
    io.saveReceipt(source, receiptId, true, outcome);
    await io.ack(packet.id, outcome);
    io.saveReceipt(source, receiptId, false, outcome);
  };
  const receipt = io.receipt(source, receiptId);
  if (receipt) {
    if (receipt.ackPending) await finish(receipt.outcome);
    return 0;
  }
  const id = await inboxStoryId(source, packet.targetId);
  const target = () => {
    const story = io.findStory(id);
    if (story && (story.inbox?.source !== source || story.inbox?.id !== packet.targetId)) throw new InboxError('conflict');
    return story;
  };
  const applied = () => {
    const updates = target()?.inboxIllustrations;
    return Array.isArray(updates) ? updates.find((u) => u?.source === source && u.id === packet.id) : undefined;
  };
  const story = target();
  if (!story) {
    if (!io.receipt(source, packet.targetId)) throw new InboxError('target_missing');
    // 原書曾接收但已刪除：不重新建立書，也不下載追加的圖。
    await finish('skipped_deleted');
    return 0;
  }
  const prev = applied();
  if (prev) {
    if (prev.digest !== packet.digest) throw new InboxError('conflict');
    await finish('applied');
    return 0;
  }
  const stored = [];
  const media = [];
  const keyPrefix = `${id}|i${(await sha256(`${source}|${packet.id}`)).slice(0, 32)}`;
  try {
    for (const im of packet.images) {
      const blob = await checkedImage(await io.download(packet.id, im.index), im, io);
      const key = `${keyPrefix}_${im.index}`;
      stored.push(key);
      await io.put(key, blob);
      media.push({ id: key, kind: 'image', up: true });
    }
    io.checkActive();
    // 提交時重新讀取清單，保留下載期間新增的媒體及最新閱讀狀態。
    io.commit(packet, source, media, id);
  } catch (e) {
    // 圖片與追加紀錄已落盤、只有回條存檔失敗時，不能清掉已引用的圖。
    if (!applied()) await Promise.allSettled(stored.map((key) => io.remove(key)));
    throw e;
  }
  io.onApplied(id, media.length);
  await finish('applied');
  return media.length;
}
