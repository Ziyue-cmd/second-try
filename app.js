/* =================== PWA 安装与网络状态 =================== */
let deferredPrompt = null;
const btnInstall = document.getElementById('btnInstall');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  btnInstall.style.display = 'inline-block';
});
btnInstall?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  btnInstall.style.display = 'none';
});

// 注册 Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(console.error);
  });
}

// 网络状态提示
const netStatus = document.getElementById('netStatus');
function refreshNet() {
  const on = navigator.onLine;
  netStatus.textContent = on ? '✓ Online + Offline-ready' : '⏻ Offline';
  netStatus.className = 'pill ' + (on ? 'ok' : 'warn');
}
window.addEventListener('online', refreshNet);
window.addEventListener('offline', refreshNet);
refreshNet();

/* =================== 游戏状态与元素 =================== */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const scorePill = document.getElementById('scorePill');
const bestPill = document.getElementById('bestPill');
const hpPill = document.getElementById('hpPill');
const enemyPill = document.getElementById('enemyPill');
const fpsPill = document.getElementById('fpsPill');

// 设置项
const drawer = document.getElementById('drawer');
const btnSettings = document.getElementById('btnSettings');
const rangeDifficulty = document.getElementById('rangeDifficulty');
const chkSfx = document.getElementById('chkSfx');
const chkVibrate = document.getElementById('chkVibrate');
const btnFullscreen = document.getElementById('btnFullscreen');
const btnResetBest = document.getElementById('btnResetBest');

const btnPause = document.getElementById('btnPause');
const btnResume = document.getElementById('btnResume');
const pauseFab = document.getElementById('pauseFab');

// 触屏按钮
const pad = document.querySelector('.pad');
const fireBtn = document.getElementById('fireBtn');

const W = canvas.width, H = canvas.height;
const keys = new Set();
const keyMap = {
  'KeyW':'up', 'ArrowUp':'up',
  'KeyS':'down', 'ArrowDown':'down',
  'KeyA':'left', 'ArrowLeft':'left',
  'KeyD':'right', 'ArrowRight':'right',
  'Space':'fire'
};

// 本地存储：最高分
const BEST_KEY = 'tank_best_score_v1';
let bestScore = Number(localStorage.getItem(BEST_KEY) || 0);
bestPill.textContent = `Best: ${bestScore}`;

// 音效（极简：用 WebAudio 生成哔声）
let audioCtx = null;
function beep(freq=880, ms=80, volume=0.1) {
  if (!chkSfx.checked) return;
  try{
    if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.value = volume;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    setTimeout(()=>{ o.stop(); }, ms);
  }catch(e){}
}
function vibrate(ms=30){
  if (chkVibrate.checked && 'vibrate' in navigator) navigator.vibrate(ms);
}

// 玩家
const player = { x: W/2, y: H/2, w: 32, h: 32, speed: 2.4, dir: 0, color: '#22d3ee' };

// 敌人
const enemies = [];
function spawnEnemy(mult=1){
  const e = {
    x: Math.random() < 0.5 ? 0 : W - 28,
    y: Math.random() * (H-28),
    w: 28, h: 28,
    vx: (Math.random() * 1.2 + 0.6) * (Math.random() < 0.5 ? 1 : -1) * mult,
    vy: (Math.random() * 1.2 + 0.6) * (Math.random() < 0.5 ? 1 : -1) * mult,
    color: '#f97316',
    hp: 2
  };
  enemies.push(e);
}
for (let i=0;i<6;i++) spawnEnemy();

// 子弹
const bullets = [];
function shoot(){
  const speed = 5;
  bullets.push({
    x: player.x + player.w/2,
    y: player.y + player.h/2,
    vx: speed * Math.cos(player.dir),
    vy: speed * Math.sin(player.dir),
    r: 3, color: '#a78bfa', life: 120
  });
  beep(1200, 60, 0.08);
}

// 工具
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function rectsOverlap(a,b){ return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y; }

// 输入（键盘）
window.addEventListener('keydown', (e) => {
  const k = keyMap[e.code];
  if (!k) return;
  e.preventDefault();
  keys.add(k);
}, {passive:false});
window.addEventListener('keyup', (e) => {
  const k = keyMap[e.code];
  if (!k) return;
  e.preventDefault();
  keys.delete(k);
}, {passive:false});

// 输入（触屏）
function pressKey(k){ keys.add(k); }
function releaseKey(k){ keys.delete(k); }

pad.querySelectorAll('button[data-k]').forEach(btn => {
  const k = btn.getAttribute('data-k');
  btn.addEventListener('pointerdown', (e)=>{ e.preventDefault(); btn.setPointerCapture?.(e.pointerId); pressKey(k); });
  btn.addEventListener('pointerup', (e)=>{ e.preventDefault(); releaseKey(k); });
  btn.addEventListener('pointercancel', ()=>{ releaseKey(k); });
});
fireBtn.addEventListener('pointerdown', (e)=>{ e.preventDefault(); fireBtn.setPointerCapture?.(e.pointerId); pressKey('fire'); });
fireBtn.addEventListener('pointerup', (e)=>{ e.preventDefault(); releaseKey('fire'); if (gameOver) restart(); });
fireBtn.addEventListener('pointercancel', ()=>{ releaseKey('fire'); });

// FAB 暂停/继续（移动端）
pauseFab.addEventListener('click', ()=>{ paused ? resume() : pause(); });

// 射击冷却
let canFire = true, fireCooldown = 0;

// 游戏循环状态
let tick = 0, score = 0, hp = 5, gameOver = false, paused = false;

// 难度倍率
function difficultyMult(){ return Number(rangeDifficulty.value || '1'); }

/* =================== 主循环 =================== */
function update(){
  if (gameOver || paused) return;

  // 移动
  let vx = 0, vy = 0;
  if (keys.has('up')) vy -= 1;
  if (keys.has('down')) vy += 1;
  if (keys.has('left')) vx -= 1;
  if (keys.has('right')) vx += 1;

  if (vx !== 0 || vy !== 0) {
    const len = Math.hypot(vx, vy);
    vx/=len; vy/=len;
    player.x += vx * player.speed;
    player.y += vy * player.speed;
    player.dir = Math.atan2(vy, vx);
  }

  // 边界
  player.x = clamp(player.x, 0, W - player.w);
  player.y = clamp(player.y, 0, H - player.h);

  // 子弹
  for (const b of bullets){ b.x += b.vx; b.y += b.vy; b.life--; }
  for (let i=bullets.length-1; i>=0; i--){
    const b = bullets[i];
    if (b.life<=0 || b.x<-10 || b.x>W+10 || b.y<-10 || b.y>H+10) bullets.splice(i,1);
  }

  // 敌人移动与反弹
  const mult = difficultyMult();
  for (const e of enemies){
    e.x += e.vx * mult; e.y += e.vy * mult;
    if (e.x <= 0 || e.x + e.w >= W) e.vx *= -1;
    if (e.y <= 0 || e.y + e.h >= H) e.vy *= -1;
  }

  // 子弹击中敌人
  for (const e of enemies){
    for (let i=bullets.length-1; i>=0; i--){
      const b = bullets[i];
      if (b.x > e.x && b.x < e.x+e.w && b.y > e.y && b.y < e.y+e.h){
        bullets.splice(i,1);
        e.hp -= 1;
        if (e.hp <= 0){
          e.x = Math.random()*(W-e.w); e.y = Math.random()*(H-e.h);
          e.hp = 2; score += 1; scorePill.textContent = `Score: ${score}`;
          beep(880, 80, 0.09); vibrate(20);
        }
      }
    }
  }

  // 敌人撞玩家
  for (const e of enemies){
    if (rectsOverlap({x:player.x,y:player.y,w:player.w,h:player.h}, e)){
      hp -= 1; hpPill.textContent = `HP: ${hp}`;
      vibrate(40); beep(220, 120, 0.08);
      player.x = clamp(player.x + (player.x < e.x ? -20 : 20), 0, W-player.w);
      player.y = clamp(player.y + (player.y < e.y ? -20 : 20), 0, H-player.h);
      if (hp<=0){ endGame(); return; }
    }
  }

  // 连发
  if (keys.has('fire') && canFire){
    shoot(); canFire=false; fireCooldown=10; // 调整射速
  }
  if (!canFire){ fireCooldown--; if (fireCooldown<=0) canFire = true; }

  // 难度 & 刷新
  tick++;
  if (tick % 600 === 0 && enemies.length < 14) spawnEnemy(mult);

  enemyPill.textContent = `Enemies: ${enemies.length}`;
}

function draw(){
  ctx.clearRect(0,0,W,H);

  // 背景网格
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = '#1f2937';
  for (let x=0; x<W; x+=40){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y=0; y<H; y+=40){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  ctx.globalAlpha = 1;

  // 玩家
  ctx.fillStyle = player.color;
  ctx.fillRect(player.x, player.y, player.w, player.h);
  // 炮管
  const nose = 20;
  ctx.beginPath();
  ctx.moveTo(player.x+player.w/2, player.y+player.h/2);
  ctx.lineTo(player.x+player.w/2 + Math.cos(player.dir)*nose,
             player.y+player.h/2 + Math.sin(player.dir)*nose);
  ctx.strokeStyle = '#67e8f9'; ctx.lineWidth=4; ctx.stroke();

  // 敌人
  for (const e of enemies){ ctx.fillStyle = e.color; ctx.fillRect(e.x, e.y, e.w, e.h); }

  // 子弹
  for (const b of bullets){ ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2); ctx.fillStyle=b.color; ctx.fill(); }

  // 文本
  statusEl.textContent = gameOver
    ? 'Game Over — 点 FIRE 或按 Space 重新开始'
    : (paused ? 'PAUSED' : '');
  if (gameOver || paused){
    ctx.fillStyle = '#e5e7eb'; ctx.textAlign='center';
    ctx.font = 'bold 28px system-ui, -apple-system, Segoe UI, Roboto';
    ctx.fillText(gameOver ? 'GAME OVER' : 'PAUSED', W/2, H/2 - 10);
    ctx.font = '16px system-ui, -apple-system, Segoe UI, Roboto';
    ctx.fillText(gameOver ? 'Tap FIRE / Press Space to restart' : 'Tap 继续 / Press Resume', W/2, H/2 + 24);
  }
}

// 简易 FPS
let last = performance.now(), frames = 0, fps = 0, fpsLast = performance.now();
function loop(){
  update(); draw();
  const now = performance.now();
  frames++;
  if (now - fpsLast >= 1000){
    fps = frames; frames = 0; fpsLast = now;
    fpsPill.textContent = `FPS: ${fps}`;
  }
  last = now;
  requestAnimationFrame(loop);
}
loop();

/* =================== 控制：暂停/继续/重开 =================== */
function pause(){ if (!paused){ paused = true; btnPause.style.display='none'; btnResume.style.display='inline-block'; } }
function resume(){ if (paused){ paused = false; btnResume.style.display='none'; btnPause.style.display='inline-block'; } }
function endGame(){
  gameOver = true; pauseFab.textContent = '▶';
  if (score > bestScore){ bestScore = score; localStorage.setItem(BEST_KEY, String(bestScore)); bestPill.textContent = `Best: ${bestScore}`; }
}
function restart(){
  score = 0; hp = 5; gameOver = false; paused = false;
  player.x = W/2; player.y = H/2; player.dir = 0;
  enemies.length = 0; for (let i=0;i<6;i++) spawnEnemy(difficultyMult());
  bullets.length = 0;
  scorePill.textContent = `Score: 0`; hpPill.textContent = `HP: 5`;
  pauseFab.textContent = 'II';
}

// 键盘空格重开
window.addEventListener('keydown', (e)=>{ if (e.code==='Space' && gameOver){ e.preventDefault(); restart(); }}, {passive:false});

// 顶部按钮
btnSettings.addEventListener('click', ()=>{
  drawer.style.display = drawer.style.display==='block' ? 'none' : 'block';
});
btnPause.addEventListener('click', pause);
btnResume.addEventListener('click', resume);

// 全屏
btnFullscreen.addEventListener('click', async ()=>{
  const el = document.documentElement;
  if (!document.fullscreenElement){ await el.requestFullscreen?.(); }
  else { await document.exitFullscreen?.(); }
});

// 重置最高分
btnResetBest.addEventListener('click', ()=>{
  localStorage.removeItem(BEST_KEY); bestScore = 0; bestPill.textContent = 'Best: 0';
});

// 自适应：当窗口尺寸显著变化时，调整 CSS 高度（canvas 尺寸保持内部逻辑固定像素）
function fit(){
  // 这里我们保持固定像素画布，利用 CSS 缩放；如需真正重绘分辨率，可加 DPR 逻辑
}
window.addEventListener('resize', fit);
fit();
