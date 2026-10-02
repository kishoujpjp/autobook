// 接收一本書的流程。注入儲存／下載函式，方便驗證斷線、配額滿、回條失敗等情況。
import { validateManifest, imageMime, sha256, InboxError } from './inbox-format.js';
import { s2t } from './zhconv.js';

export async function receiveInboxStory(raw, source, io) {
  const packet = validateManifest(raw);
  const id = `inbox_${(await sha256(`${source}|${packet.id}`)).slice(0, 32)}`;
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
  const text = s2t(packet.text);
  const story = {
    id, title: s2t(packet.title), text, lang: 'zh-Hant', createdAt: packet.createdAt,
    newChars: io.newChars(text), hasImage: true, imagePrompt: packet.imagePrompt,
    manual: true, media: [], inbox: { source, id: packet.id },
  };
  try {
    for (const im of packet.images) {
      const blob = await io.download(packet.id, im.index);
      if (blob.size !== im.size || blob.type.split(';')[0] !== im.mime) throw new InboxError('image');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (imageMime(bytes) !== im.mime || await sha256(bytes) !== im.sha256) throw new InboxError('image');
      const prepared = await io.prepare(blob);
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
