// 合成資料、獨立 browser context；不讀取使用者的故事、帳號、API Key。
// 啟動 tools/devserver.py 8137 後執行；PLAYWRIGHT_MODULE 可指向外部已安裝的 Playwright。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const engines = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.BROWSER || 'chromium';
const output = process.env.AUDIT_OUTPUT || `/tmp/autobook-polish-${engine}`;
const origin = process.env.AUDIT_URL || 'http://127.0.0.1:8137';

(async()=>{
 const browser=await engines[engine].launch({headless:true});
 const context=await browser.newContext({viewport:{width:1366,height:1024}, serviceWorkers:'block'});
 const page=await context.newPage();
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const a='qa-parent', kid='qa-kid';
  localStorage.setItem('autobook.accounts',JSON.stringify([{id:a,name:'家長',role:'parent',avatar:{kind:'preset',preset:'fox'}},{id:kid,name:'小米',role:'kid',avatar:{kind:'preset',preset:'cat'}}]));
  localStorage.setItem('autobook.currentAccount',JSON.stringify(a));
  localStorage.setItem('autobook.settings',JSON.stringify({onboarded:true,storyLayout:'focus',storySpeak:false,tapSpeak:false,parentGateOn:false,manageAcc:kid,toastVoice:false}));
  const text='小兔有一本書。\n小兔和小貓一起看書。\n「我們去找大樹吧！」小貓說。\n他們走到小河邊，看見一朵小花。\n小兔把花送給小貓。\n天黑了，他們開心地回家。\n今天真是美好的一天。';
  const titles=['小兔的花園','森林裡的小星星','小熊找朋友','一起看彩虹','小鳥的新家','勇敢的小貓','月亮晚安','一朵小花','快樂的一天','我的小書'];
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="750"><rect width="1000" height="750" fill="#dcefe9"/><circle cx="800" cy="135" r="60" fill="#ffe08a"/><path d="M0 500Q250 300 500 500T1000 500V750H0Z" fill="#92c0a1"/><ellipse cx="420" cy="550" rx="95" ry="100" fill="#fff9ef"/><ellipse cx="380" cy="410" rx="24" ry="95" fill="#fff9ef"/><ellipse cx="450" cy="410" rx="24" ry="95" fill="#fff9ef"/><circle cx="395" cy="525" r="7" fill="#4a3b2a"/><circle cx="445" cy="525" r="7" fill="#4a3b2a"/><path d="M410 550Q420 568 435 550" stroke="#4a3b2a" stroke-width="5" fill="none"/><path d="M570 600V450" stroke="#438663" stroke-width="10"/><circle cx="570" cy="430" r="45" fill="#e99bb3"/><circle cx="570" cy="430" r="17" fill="#ffe08a"/></svg>';
  const url='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  const stories=titles.map((title,i)=>({id:'qa-'+i,title,text,lang:'zh-Hant',textPolicy:1,createdAt:Date.now()-i*86400000,newChars:[],media:[{id:'qa-media-'+i,kind:'image',url},{id:'qa-media-b-'+i,kind:'image',url:url+'#second'}],hlBy:i===1?{[a]:[...text].map((x,j)=>/\p{Script=Han}/u.test(x)?j:-1).filter(j=>j>=0)}:{},readsBy:i===1?{[a]:1}:{}}));
  localStorage.setItem('autobook.stories',JSON.stringify(stories));
  localStorage.setItem('autobook.words',JSON.stringify([...new Set([...text+'日月水火木山人朋好友學會'].filter(x=>/\p{Script=Han}/u.test(x)))].map((ch,i)=>({ch,addedAt:Date.now()+i,usedCount:i%4===0?0:2,readCount:0,archived:false,cards:{[kid+'|zh-Hant']:{mark:i%3===0?'green':i%3===1?'red':null,markedAt:Date.now(),flashCount:0,ok:0,ng:0}}}))));
 });
 await page.goto(origin); await page.waitForFunction(()=>window.__autobookReady); await page.waitForTimeout(500);
 fs.mkdirSync(output,{recursive:true});
 await page.waitForTimeout(250); await page.screenshot({path:`${output}/reader-landscape.png`});
 await page.getByRole('button',{name:'故事書架',exact:true}).click();
 await page.waitForTimeout(250); await page.screenshot({path:`${output}/shelf-landscape.png`});
 await page.evaluate(async()=>{(await import('/js/nav.js')).showPage('words')}); await page.waitForTimeout(250);
 await page.waitForTimeout(250); await page.screenshot({path:`${output}/words-landscape.png`});
 const filters=[];
 for(const k of ['learned','weak','unused','total']){
  await page.locator('.stat-chip.'+k).click();
  filters.push(await page.evaluate(()=>({selected:document.querySelector('.stat-chip.on').className,pressed:document.querySelectorAll('.stat-chip[aria-pressed=true]').length,visible:[...document.querySelectorAll('.words-page .word-chip')].filter(x=>!x.hidden).length})));
 }
 const combinations=[];
 for(const size of [{width:1366,height:1024},{width:1024,height:1366}]) for(const theme of ['light','dark']) for(const layout of ['focus','side']) for(const font of ['small','big']){
  await page.setViewportSize(size);
  await page.evaluate(async ({theme,layout,font})=>{const store=await import('/js/store.js'); Object.assign(store.settings,{storyLayout:layout,storyFont:font,theme}); document.documentElement.dataset.theme=theme;(await import('/js/nav.js')).showPage('story')},{theme,layout,font});
  await page.waitForTimeout(150);
  if(size.width===1024&&theme==='light'&&layout==='focus'&&font==='small') {await page.waitForTimeout(250); await page.screenshot({path:`${output}/reader-portrait.png`});}
  const audits=[];
  do {
   const audit=await page.evaluate(()=>{
   const r=document.querySelector('.story-scroll').getBoundingClientRect(); const zi=[...document.querySelectorAll('.story-text .zi')];
   const clipped=zi.filter(x=>{const b=x.getBoundingClientRect();return b.bottom>r.top+10&&b.top<r.bottom&&((b.top<r.top+9)||(b.bottom>r.bottom+.6))}).map(x=>x.textContent);
   return {clipped,progressNoTouch:getComputedStyle(document.querySelector('.progress-track')).pointerEvents,pages:document.querySelector('.page-ind').textContent,pageOverflow:document.querySelector('#page-story').scrollWidth>document.querySelector('#page-story').clientWidth};
  });
   audits.push(audit);
   if(await page.locator('.story-layout .page-btn').last().isDisabled()) break;
   await page.locator('.story-layout .page-btn').last().click();
   await page.waitForTimeout(650);
  } while(audits.length<30);
  const audit={pages:audits.length,clipped:audits.flatMap(a=>a.clipped),pageOverflow:audits.some(a=>a.pageOverflow),progressNoTouch:audits.every(a=>a.progressNoTouch==='none')};
  combinations.push({size,theme,layout,font,...audit});
 }
 await page.setViewportSize({width:1366,height:1024});
 await page.evaluate(async()=>{const s=await import('/js/store.js');Object.assign(s.settings,{storyLayout:'focus',storyFont:'small'}); document.documentElement.dataset.theme='light';(await import('/js/nav.js')).showPage('story')});
 await page.getByRole('button',{name:'閱讀設定',exact:true}).click();
 await page.getByRole('button',{name:'直接完成',exact:true}).click();
 await page.locator('.reveal-stage').waitFor();await page.waitForTimeout(1300);
 await page.waitForTimeout(250); await page.screenshot({path:`${output}/reveal-landscape.png`});
 const reveal=[];
 for(const size of [{width:1366,height:1024},{width:1024,height:1366},{width:844,height:390}]){
  await page.setViewportSize(size); await page.waitForTimeout(150);
  reveal.push(await page.evaluate(()=>{const f=document.querySelector('.story-frame').getBoundingClientRect(),b=document.querySelector('.stage-close').getBoundingClientRect();return {w:innerWidth,h:innerHeight,frame:{x:f.x,y:f.y,right:f.right,bottom:f.bottom},close:{top:b.top,bottom:b.bottom},imageFit:getComputedStyle(document.querySelector('.frame-mat img')).objectFit}}));
  if(size.width===1024) {await page.waitForTimeout(250); await page.screenshot({path:`${output}/reveal-portrait.png`});}
 }
 await page.keyboard.press('Tab');
 assert.equal(await page.locator('.stage-close').evaluate(el=>el===document.activeElement),true,'圖片框焦點保留在舞台');
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('.reveal-stage').count(),0,'Escape 能收起圖片');

 const store=await page.evaluate(async()=>{const s=await import('/js/store.js');return {reads:s.stories[0].readsBy['qa-parent'],markCount:s.stories[0].hlBy['qa-parent'].length}});
 await page.setViewportSize({width:1366,height:1024});
 await page.getByRole('button',{name:'再看一次',exact:true}).click();
 await page.locator('.reveal-stage').waitFor();
 await page.getByRole('button',{name:'收起來',exact:true}).click();
 assert.equal(await page.evaluate(async()=> (await import('/js/store.js')).storyReads((await import('/js/store.js')).stories[0])),1,'再看圖片不增加完成次數');
 await page.getByRole('button',{name:'再讀一遍',exact:true}).click();
 assert.equal(await page.evaluate(async()=> (await import('/js/store.js')).stories[0].hlBy['qa-parent']?.length||0),0,'再讀一遍清掉當前高亮');
 await page.getByRole('button',{name:'閱讀設定',exact:true}).click();
 await page.getByRole('button',{name:'直接完成',exact:true}).click();
 await page.locator('.reveal-stage').waitFor();
 assert.ok((await page.locator('.frame-mat img').getAttribute('src')).endsWith('#second'),'第二遍打開第二張圖');
 assert.equal(await page.evaluate(async()=> (await import('/js/store.js')).storyReads((await import('/js/store.js')).stories[0])),2,'第二輪完成計兩遍');
 await page.getByRole('button',{name:'收起來',exact:true}).click();
 // 由獨立空白頁錄製合成影片，不讀取私人媒體。
 const videoContext=await browser.newContext({recordVideo:{dir:output,size:{width:160,height:120}}});
 const fixture=await videoContext.newPage();
 await fixture.setContent('<style>body{margin:0;background:#92c0a1}div{width:80px;height:60px;background:#e99bb3;animation:move .5s infinite alternate}@keyframes move{to{transform:translate(50px,40px)}}</style><div></div>');
 await fixture.waitForTimeout(900);
 await videoContext.close();
 const fixturePath=await fixture.video().path();
 await page.route(origin+'/qa-video.webm',route=>route.fulfill({contentType:'video/webm',body:fs.readFileSync(fixturePath)}));
 await page.evaluate(async origin=>{
  const s=await import('/js/store.js');s.stories[0].media=[{id:'qa-video',kind:'video',url:origin+'/qa-video.webm'}];
  (await import('/js/story.js')).render();
 },origin);
 await page.getByRole('button',{name:'再看一次',exact:true}).click();
 await page.waitForFunction(()=>{const v=document.querySelector('.frame-mat video');return v&&v.readyState>=2&&!v.paused}).catch(async e=>{console.error(await page.locator('.frame-mat video').evaluate(v=>({src:v.src,ready:v.readyState,paused:v.paused,error:v.error?.message})));throw e;});
 assert.equal(await page.locator('.frame-mat video').evaluate(v=>v.muted),true,'影片初始靜音');
 await page.locator('.frame-mat .media-sound').click();
 assert.equal(await page.locator('.frame-mat video').evaluate(v=>v.muted),false,'喇叭可解除靜音');
 await page.waitForTimeout(1600); await page.locator('.story-frame').click();
 assert.equal(await page.locator('.story-frame').evaluate(f=>f.classList.contains('pop')),false,'點影片不重播特效');
 await page.evaluate(()=>{window.__qaVideo=document.querySelector('.frame-mat video')});
 await page.getByRole('button',{name:'收起來',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.__qaVideo.paused),true,'收起圖片框停止影片');
 await page.setViewportSize({width:1024,height:1366});await page.evaluate(async()=>{document.documentElement.dataset.theme='dark';(await import('/js/nav.js')).showPage('words')});
 await page.waitForTimeout(250); await page.screenshot({path:`${output}/words-dark-portrait.png`});
 await page.evaluate(async()=>{(await import('/js/nav.js')).showPage('game')});await page.waitForTimeout(250); await page.screenshot({path:`${output}/game-dark-portrait.png`});

 assert.deepEqual(errors,[],'介面無執行期錯誤');
 assert.ok(filters.every(f=>f.pressed===1),'四色篩選僅一個選中');
 assert.deepEqual(filters.map(f=>f.visible),[18,18,14,54],'四色分類數量正確');
 assert.ok(combinations.every(a=>a.clipped.length===0&&!a.pageOverflow&&a.progressNoTouch),'所有頁面完整顯示；防誤觸進度條保留');
 assert.ok(reveal.every(a=>a.frame.x>=0&&a.frame.y>=0&&a.frame.right<=a.w&&a.close.bottom<=a.h&&a.imageFit==='contain'),'完整圖片與收起鈕在視窗內');
 assert.equal(store.reads,1,'完成只計一次');
 assert.equal(store.markCount,65,'完成保留所有文字索引');
 const cleanCanvas=await page.evaluate(()=>{const c=document.querySelector('#confetti-canvas');return c.getContext('2d').getImageData(0,0,c.width,c.height).data.every(v=>v===0)});
 assert.equal(cleanCanvas,true,'收起圖片及換頁後不殘留彩帶');
 await page.evaluate(async()=>{(await import('/js/store.js')).setCurrentAccount('qa-kid');(await import('/js/account.js')).applyRole()});
 await page.locator('#tab-game').click(); await page.waitForTimeout(250);
 assert.equal(await page.locator('#page-game').evaluate(e=>e.classList.contains('active')),true);
 assert.equal(await page.locator('#tabbar .tab:visible').count(),4,'保留現有四個分頁入口');
 await page.screenshot({path:`${output}/kid-game.png`});
 await page.locator('#tab-story').click(); await page.waitForTimeout(250);
 await page.screenshot({path:`${output}/kid-reader.png`});
 // 用 OfflineAudioContext 驗證每種效果音、連點疊音與尾端，不接真實喇叭。
 const audio=[];
 for(const effect of ['pop','unpop','tap','tick','tock','correct','wrong','fanfare','sparkle','star','whoosh','overlap']) {
  const rendered=await page.evaluate(async effect=>{
   const offline=new OfflineAudioContext(1,48000,24000);
   offline.resume=()=>Promise.resolve();
   window.AudioContext=function(){return offline};
   const {sfx}=await import('/js/sfx.js?offline='+effect);
   if(effect==='overlap') {for(let i=0;i<20;i++)sfx.tap();sfx.fanfare();sfx.star(4)}
   else sfx[effect](4);
   const buffer=await offline.startRendering();
   const samples=buffer.getChannelData(0);
   let peak=0,sum=0,tail=0;
   for(let i=0;i<samples.length;i++){peak=Math.max(peak,Math.abs(samples[i]));sum+=samples[i]*samples[i];if(i>samples.length-2400)tail=Math.max(tail,Math.abs(samples[i]))}
   return {peak,rms:Math.sqrt(sum/samples.length),tail,samples:Array.from(samples)};
  },effect);
  assert.ok(rendered.peak>0&&rendered.peak<0.5,`${effect}: 有聲且疊音不削波`);
  assert.ok(rendered.tail<0.00001,`${effect}: 結束後沒有殘響雜訊`);
  const pcm=Buffer.alloc(rendered.samples.length*2);
  rendered.samples.forEach((v,i)=>pcm.writeInt16LE(Math.round(Math.max(-1,Math.min(1,v))*32767),i*2));
  const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
  fs.writeFileSync(`${output}/${effect}.wav`,Buffer.concat([header,pcm]));
  audio.push({effect,peak:rendered.peak,rms:rendered.rms,tail:rendered.tail});
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.evaluate(async()=>{(await import('/js/ui.js')).confetti()});
 assert.equal(await page.evaluate(()=>{const c=document.querySelector('#confetti-canvas');return c.getContext('2d').getImageData(0,0,c.width,c.height).data.every(v=>v===0)}),true,'減少動態效果時沒有彩帶');
 const result={engine,errors,filters,combinations,reveal,store,audio};
 fs.writeFileSync(`${output}/audit.json`,JSON.stringify(result,null,2));
 console.log(JSON.stringify({engine,readingCombinations:combinations.length,readingPages:combinations.reduce((n,a)=>n+a.pages,0),audio,output},null,2));

 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
