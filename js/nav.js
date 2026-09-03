// 頁面導航（v1.26.0）：分頁列只有故事／遊戲／跟讀；書架、家長頁、字表、設定是「無分頁」頁面，
// 由這裡統一切換。main.js 註冊實際的切換函式，其他模組只 import showPage，避免循環相依。
let handler = null;

export function setNavHandler(fn) { handler = fn; }

/** 切到指定頁面：'story' | 'game' | 'repeat' | 'shelf' | 'parent' | 'words' | 'settings' */
export function showPage(name) {
  if (handler) handler(name);
}
