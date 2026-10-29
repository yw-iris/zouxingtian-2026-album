/* 走向明天 · 2026 毕业画册
   滚动驱动的 3D 翻页：封面开合 → 逐页翻阅 → 印刷物随之散落 */
(function () {
  'use strict';

  var reader   = document.getElementById('reader');
  var stage    = document.getElementById('stage');
  var scene    = document.getElementById('bookScene');
  var outer    = document.getElementById('bookOuter');
  var inner    = document.getElementById('bookInner');
  var coverLeaf= document.getElementById('leafCover');
  var coverEdge= document.getElementById('coverEdge');
  var flipLeaf = document.getElementById('leafFlip');
  var flipFront= document.getElementById('flipFront');
  var flipBack = document.getElementById('flipBack');
  var quote    = document.getElementById('quote');
  var hintOpen = document.getElementById('hintOpen');
  var hintScroll= document.getElementById('hintScroll');
  var dotsWrap = document.getElementById('dots');
  var btnToc   = document.getElementById('btnToc');
  var btnBack  = document.getElementById('btnBack');
  var btnSound = document.getElementById('btnSound');
  var btnView  = document.getElementById('btnView');
  var btnFull  = document.getElementById('btnFull');
  var progress = document.getElementById('progress');
  var folio    = document.getElementById('folio');
  var dustWrap = document.getElementById('dust');
  var pageShadow = document.getElementById('pageShadow');

  var spreads = Array.prototype.slice.call(document.querySelectorAll('.spread'));
  var SPREADS = spreads.length;              // 7 个跨页
  var TOTAL   = SPREADS;                     // 7 步：1 步开合 + 6 步翻页
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('#nav a'));

  var clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  var lerp  = function (a, b, t) { return a + (b - a) * t; };
  var easeInOut = function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
  var smoothstep = function (a, b, x) {
    var t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  var fitOpen = 0.8, fitClosed = 0.8, flat = false, lastTurn = -2, lastOpen = -1, lastP = -1;
  var dots = [];

  /* ---------- 每页的 3D 层级：左页越靠前越高，右页越靠后越高 ---------- */
  spreads.forEach(function (sp, i) {
    var L = sp.querySelector('.page--left');
    var R = sp.querySelector('.page--right');
    L.style.setProperty('--zl', (SPREADS - i) + 'px');
    R.style.setProperty('--zr', (i) + 'px');
    sp._L = L; sp._R = R;
  });

  /* ---------- 指示点 ---------- */
  for (var i = 0; i < SPREADS; i++) {
    (function (idx) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'dot';
      b.setAttribute('aria-label', '翻到第 ' + (idx + 1) + ' 页');
      b.addEventListener('click', function () { gotoSpread(idx); });
      dotsWrap.appendChild(b);
      dots.push(b);
    })(i);
  }

  /* ---------- 光锥里的浮尘 ---------- */
  if (dustWrap) {
    for (var dm = 0; dm < 20; dm++) {
      var mote = document.createElement('i');
      mote.className = 'mote';
      var dur = 9 + Math.random() * 13;
      var size = (1 + Math.random() * 1.9).toFixed(1);
      mote.style.left = (6 + Math.random() * 88).toFixed(1) + '%';
      mote.style.top = (1 + Math.random() * 24).toFixed(1) + '%';
      mote.style.width = size + 'px';
      mote.style.height = size + 'px';
      mote.style.animationDuration = dur.toFixed(1) + 's';
      mote.style.animationDelay = (-Math.random() * dur).toFixed(1) + 's';
      mote.style.setProperty('--dx', (Math.random() * 46 - 23).toFixed(1) + 'px');
      mote.style.setProperty('--dy', (110 + Math.random() * 280).toFixed(0) + 'px');
      dustWrap.appendChild(mote);
    }
  }

  function computeFit() {
    var w = stage.clientWidth, h = stage.clientHeight;
    /* 合上时只看得到封面那一半，所以单独给一套更大的比例 */
    fitOpen   = Math.max(0.2, Math.min((w * 0.88) / 1260, (h * 0.84) / 810));
    fitClosed = Math.max(0.2, Math.min((w * 0.62) / 600,  (h * 0.70) / 562));
    return fitOpen;
  }

  /* ---------- 翻页内容装载 ---------- */
  function applyTurn(k) {
    flipFront.innerHTML = '';
    flipBack.innerHTML = '';
    if (k < 0) { flipLeaf.classList.remove('is-on'); return; }

    var front = spreads[k]._R.cloneNode(true);
    front.style.left = '0px';
    front.style.transform = 'translateZ(0px)';
    front.classList.remove('is-off');
    flipFront.appendChild(front);

    var back = spreads[k + 1]._L.cloneNode(true);
    back.style.left = '0px';
    back.style.transform = 'translateZ(0px)';
    back.classList.remove('is-off');
    flipBack.appendChild(back);
  }

  /* ---------- 跨页显隐 ---------- */
  var lastVis = '';
  function applyVis(k, openP) {
    var key = k + ':' + (openP < 0.95 ? 0 : 1);
    if (key === lastVis) return;
    lastVis = key;
    spreads.forEach(function (sp, i) {
      sp.classList.toggle('is-on', (k >= 0) ? (i === k || i === k + 1) : (i === 0));
      sp._L.classList.remove('is-off');
      sp._R.classList.remove('is-off');
    });
    /* 下一页的左页由翻动书页的背面遮住；封面未落定时左页不显示 */
    if (k >= 0) spreads[k + 1]._L.classList.add('is-off');
    else spreads[0]._L.classList.toggle('is-off', openP < 0.95);
  }

  /* ---------- 主渲染 ---------- */
  function render(p) {
    p = clamp(p, 0, TOTAL);

    var openP = clamp(p, 0, 1);
    var oe = easeInOut(openP);

    /* 镜头：合上时是斜俯视的册子，打开后推平为阅读视角 */
    var rx = flat ? 0 : lerp(46, 8.5, oe);
    var ry = flat ? 0 : lerp(-17, -2.4, oe);
    var rz = flat ? 0 : lerp(-1.2, 0, oe);
    inner.style.setProperty('--rx', rx.toFixed(2) + 'deg');
    inner.style.setProperty('--ry', ry.toFixed(2) + 'deg');
    inner.style.setProperty('--rz', rz.toFixed(2) + 'deg');
    outer.style.setProperty('--ox', lerp(-300, 0, oe).toFixed(1) + 'px');
    outer.style.setProperty('--oz', lerp(-40, 0, oe).toFixed(1) + 'px');
    outer.style.setProperty('--shs', (0.52 + 0.48 * oe).toFixed(3));
    outer.style.setProperty('--shy', lerp(-26, 12, oe).toFixed(1) + 'px');
    scene.style.setProperty('--fit', lerp(fitClosed, fitOpen, oe).toFixed(4));

    /* 封面开合 */
    coverLeaf.style.setProperty('--ang', (-180 * oe).toFixed(2) + 'deg');
    coverLeaf.style.setProperty('--lift', (Math.sin(Math.PI * openP) * 10).toFixed(1) + 'px');
    coverLeaf.style.setProperty('--bb', (0.92 + 0.08 * oe).toFixed(3));
    coverLeaf.style.setProperty('--sweep', openP.toFixed(3));
    coverLeaf.style.setProperty('--sw', (Math.sin(Math.PI * openP) * 0.5).toFixed(3));
    coverEdge.style.opacity = clamp(1 - openP * 1.35, 0, 1).toFixed(3);

    if (Math.abs(openP - lastOpen) > 0.02) {
      if (openP > 0.02 && lastOpen <= 0.02) playTurn();
      lastOpen = openP;
    }

    /* 翻页 */
    var k = -1, f = 0;
    if (p > 1) {
      k = clamp(Math.floor(p - 1), 0, SPREADS - 2);
      f = clamp((p - 1) - k, 0, 1);
    }
    if (k !== lastTurn) {
      applyTurn(k);
      if (k !== lastTurn && k >= 0) playTurn();
      lastTurn = k;
    }
    applyVis(k, openP);
    if (k >= 0) {
      var e = easeInOut(f);
      flipLeaf.classList.add('is-on');
      flipLeaf.style.setProperty('--ang', (-180 * e).toFixed(2) + 'deg');
      flipLeaf.style.setProperty('--lift', (5 + Math.sin(Math.PI * f) * 16).toFixed(1) + 'px');
      flipLeaf.style.setProperty('--bf', (1 - 0.1 * f).toFixed(3));
      flipLeaf.style.setProperty('--bb', (0.94 - 0.06 * f).toFixed(3));
      flipLeaf.style.setProperty('--sh', (Math.sin(Math.PI * f) * 0.5).toFixed(3));
      flipLeaf.style.setProperty('--sweep', f.toFixed(3));
      flipLeaf.style.setProperty('--sw', (Math.sin(Math.PI * f) * 0.85).toFixed(3));
      pageShadow.style.setProperty('--sx', (100 - f * 100).toFixed(1) + '%');
      pageShadow.style.setProperty('--so', (Math.sin(Math.PI * f) * 0.85).toFixed(3));
      /* 翻走的这一页上，散落的印刷物随之飘散 */
      var chips = flipFront.querySelectorAll('.chip');
      for (var ci = 0; ci < chips.length; ci++) chips[ci].style.setProperty('--sc', f.toFixed(4));
    } else {
      flipLeaf.classList.remove('is-on');
      pageShadow.style.setProperty('--so', '0');
    }

    /* 语录纸条：只在翻页的那一瞬浮出，落定即隐 */
    var q = smoothstep(1.54, 1.78, p) * (1 - smoothstep(1.88, 2.08, p));
    quote.style.setProperty('--q', q.toFixed(3));

    /* UI 状态 */
    var rest = p <= 1 ? 0 : clamp(Math.round(p - 1), 0, SPREADS - 1);
    for (var d = 0; d < dots.length; d++) dots[d].classList.toggle('is-on', d === rest);
    if (folio) folio.textContent = 'Page ' + (rest + 1) + ' / ' + SPREADS;

    /* 滚过画册后固定栏转为实底 */
    var past = window.pageYOffset > reader.offsetTop + reader.offsetHeight - window.innerHeight - 8;
    document.body.classList.toggle('past-reader', past);

    /* 导航高亮：画册内按跨页，画册外按下方板块 */
    navLinks.forEach(function (a) {
      var g = a.getAttribute('data-goto');
      var pn = a.getAttribute('data-panel');
      var on = pn ? false : ((g === 'cover') ? p < 0.6 : parseInt(g, 10) === rest);
      a.classList.toggle('is-active', on);
    });
    if (past) {
      var probe = window.pageYOffset + window.innerHeight * 0.5;
      var activePanel = null;
      ['about', 'contact'].forEach(function (id) {
        var sec = document.getElementById(id);
        if (sec && probe >= sec.offsetTop) activePanel = id;
      });
      navLinks.forEach(function (a) {
        var pn = a.getAttribute('data-panel');
        if (!pn) return;
        a.classList.toggle('is-active', pn === activePanel);
      });
    }

    if (hintOpen) hintOpen.classList.toggle('is-off', p > 0.12);
    if (hintScroll) hintScroll.style.opacity = p > 0.55 ? '1' : '0';
    if (btnToc) btnToc.classList.toggle('is-on', p > 0.55);

    /* 阅读进度 */
    if (progress) progress.style.setProperty('--p', (p / TOTAL).toFixed(4));
  }

  /* ---------- 滚动 ---------- */
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var p = window.pageYOffset / window.innerHeight;
      if (Math.abs(p - lastP) > 0.0004) { lastP = p; render(p); }
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- 跳转 ---------- */
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function scrollToY(y) {
    window.scrollTo({ top: y, behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  function gotoSpread(idx) {
    scrollToY(Math.min(idx + 1, SPREADS) * window.innerHeight);
  }
  function gotoCover() { scrollToY(0); }

  document.addEventListener('click', function (e) {
    var st = e.target.closest('[data-step]');
    if (st) {
      e.preventDefault();
      step(parseInt(st.getAttribute('data-step'), 10));
      return;
    }
    var pn = e.target.closest('[data-panel]');
    if (pn) {
      e.preventDefault();
      var sec = document.getElementById(pn.getAttribute('data-panel'));
      if (sec) scrollToY(sec.offsetTop - 8);
      return;
    }
    var t = e.target.closest('[data-goto]');
    if (!t) return;
    e.preventDefault();
    var g = t.getAttribute('data-goto');
    if (g === 'cover') gotoCover(); else gotoSpread(parseInt(g, 10));
  });

  if (hintOpen) hintOpen.addEventListener('click', function () { gotoSpread(0); });
  if (btnToc) btnToc.addEventListener('click', function () { gotoSpread(2); });
  if (btnBack) btnBack.addEventListener('click', function () { gotoCover(); });

  var pgPrev = document.getElementById('pgPrev');
  var pgNext = document.getElementById('pgNext');
  if (pgPrev) pgPrev.addEventListener('click', function () { step(-1); });
  if (pgNext) pgNext.addEventListener('click', function () { step(1); });

  function currentRest() {
    var p = clamp(window.pageYOffset / window.innerHeight, 0, TOTAL);
    return p <= 1 ? 0 : clamp(Math.round(p - 1), 0, SPREADS - 1);
  }
  function step(dir) {
    var p = clamp(window.pageYOffset / window.innerHeight, 0, TOTAL);
    if (p <= 0.6 && dir < 0) { gotoCover(); return; }
    var rest = currentRest();
    if (dir > 0) gotoSpread(Math.min(rest + 1, SPREADS - 1));
    else gotoSpread(Math.max(rest - 1, 0));
  }

  /* 点击合上的册子即打开 */
  scene.addEventListener('click', function (e) {
    if (e.target.closest('[data-goto]')) return;
    if (window.pageYOffset / window.innerHeight < 0.2) gotoSpread(0);
  });

  /* ---------- 键盘 ---------- */
  window.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'Home') { e.preventDefault(); gotoCover(); }
  });

  /* ---------- 翻页音效 ---------- */
  var audioCtx = null, soundOn = false;
  function playTurn() {
    if (!soundOn) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var dur = 0.42, sr = audioCtx.sampleRate, len = Math.floor(sr * dur);
      var buf = audioCtx.createBuffer(1, len, sr), data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) {
        var t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4);
      }
      var src = audioCtx.createBufferSource(); src.buffer = buf;
      var bp = audioCtx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.85;
      bp.frequency.setValueAtTime(1800, audioCtx.currentTime);
      bp.frequency.exponentialRampToValueAtTime(380, audioCtx.currentTime + dur);
      var g = audioCtx.createGain();
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.16, audioCtx.currentTime + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      src.connect(bp); bp.connect(g); g.connect(audioCtx.destination);
      src.start();
    } catch (err) { /* 静默 */ }
  }
  if (btnSound) btnSound.addEventListener('click', function () {
    soundOn = !soundOn;
    btnSound.classList.toggle('is-off', !soundOn);
    if (soundOn) playTurn();
  });

  /* ---------- 平面 / 立体视图 ---------- */
  if (btnView) btnView.addEventListener('click', function () {
    flat = !flat;
    btnView.classList.toggle('is-off', flat);
    btnView.title = flat ? '切换到立体视图' : '切换到平面视图';
    render(clamp(window.pageYOffset / window.innerHeight, 0, TOTAL));
  });

  /* ---------- 全屏 ---------- */
  if (btnFull) btnFull.addEventListener('click', function () {
    if (!document.fullscreenElement) {
      if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  });

  /* ---------- 尺寸 ---------- */
  function onResize() {
    computeFit();
    render(clamp(window.pageYOffset / window.innerHeight, 0, TOTAL));
  }
  window.addEventListener('resize', onResize);

  computeFit();
  coverLeaf.classList.add('is-on');
  render(clamp(window.pageYOffset / window.innerHeight, 0, TOTAL));
  /* 带 #锚点直达时浏览器可能在脚本之后才滚动，这里补一次重绘 */
  window.addEventListener('hashchange', function () {
    render(clamp(window.pageYOffset / window.innerHeight, 0, TOTAL));
  });
  setTimeout(function () {
    lastP = -1;
    render(clamp(window.pageYOffset / window.innerHeight, 0, TOTAL));
  }, 120);
})();
