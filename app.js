/* Foto Bareng: camera, PeerJS connection, synced shooting protocol, result UI. */
(function () {
  'use strict';
  const C = window.Compose;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const FAKE = params.get('fake') === '1';
  const ID_PREFIX = 'fotobareng-';
  const COUNT_MS = 1000;      // per countdown number
  const SHOT_GAP_MS = 1600;   // pause after each capture
  const FRAME_WAIT_MS = 5000; // how long to wait for the friend's last frames
  const SHOTS = { strip3: 3, strip4: 4, grid4: 4 };

  const st = {
    role: null,          // 'host' | 'guest' | 'solo'
    stream: null,
    mirror: !FAKE,
    remoteMirror: !FAKE,
    peer: null,
    conn: null,
    call: null,
    code: null,
    layout: 'strip4',
    rtt: Infinity,
    busy: false,
    session: null,
    result: { filter: 'normal', theme: 'cream', deco: 'hearts', title: 'foto bareng', showDate: true },
    shots: null,
    blob: null,
    renderToken: 0,
  };

  // ---------- UI helpers ----------
  const screens = ['scrHome', 'scrJoin', 'scrBooth', 'scrResult'];
  function show(id) {
    screens.forEach((s) => { $(s).hidden = s !== id; });
    window.scrollTo(0, 0);
  }
  function status(kind, text) {
    const p = $('status');
    p.hidden = false;
    p.dataset.s = kind;
    p.textContent = text;
  }
  function msg(text, bad, retry) {
    const m = $('msg');
    m.className = 'msg' + (bad ? ' bad' : '');
    m.textContent = text || '';
    if (retry) {
      const b = document.createElement('button');
      b.className = 'btn small';
      b.style.marginLeft = '10px';
      b.textContent = 'Coba lagi';
      b.onclick = retry;
      m.appendChild(b);
    }
  }
  let toastT;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2400);
  }
  function duo() { return st.role !== 'solo'; }
  function connected() { return !!(st.conn && st.conn.open); }
  function randCode(n) {
    const a = 'abcdefghjkmnpqrstuvwxyz23456789';
    let s = '';
    const r = crypto.getRandomValues(new Uint32Array(n));
    for (let i = 0; i < n; i++) s += a[r[i] % a.length];
    return s;
  }
  function cleanCode(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12); }
  function send(obj) { if (connected()) { try { st.conn.send(obj); } catch (e) { console.warn('send failed', e); } } }

  function updateStartButton() {
    const b = $('btnStart');
    if (st.busy) { b.disabled = true; return; }
    b.disabled = duo() ? !connected() : !st.stream;
  }
  function setLayout(l, broadcast) {
    if (!SHOTS[l]) return;
    st.layout = l;
    document.querySelectorAll('#layoutGroup .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.layout === l)));
    if (broadcast) send({ type: 'settings', layout: l });
  }
  function lockControls(lock) {
    document.querySelectorAll('#layoutGroup .chip').forEach((c) => { c.disabled = lock; });
    updateStartButton();
  }

  // ---------- camera ----------
  function fakeStream(role) {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 480;
    const ctx = c.getContext('2d');
    const hue = role === 'guest' ? 210 : role === 'solo' ? 140 : 8;
    let f = 0;
    const draw = () => {
      f++;
      const g = ctx.createLinearGradient(0, 0, 640, 480);
      g.addColorStop(0, 'hsl(' + hue + ',70%,72%)');
      g.addColorStop(1, 'hsl(' + ((hue + 40) % 360) + ',55%,38%)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 640, 480);
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.beginPath(); ctx.arc(320 + Math.sin(f / 8) * 120, 220, 70, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.font = 'bold 44px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(role === 'guest' ? 'TAMU' : role === 'solo' ? 'SOLO' : 'HOST', 320, 400);
      ctx.font = '22px monospace';
      ctx.fillText(new Date().toLocaleTimeString(), 320, 440);
    };
    draw();
    setInterval(draw, 1000 / 15);
    return c.captureStream(15);
  }

  async function getStream(withAudio) {
    if (st.stream) return st.stream;
    if (FAKE) { st.stream = fakeStream(st.role); return st.stream; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Browser ini tidak bisa membuka kamera. Pastikan halaman dibuka lewat https dan pakai Chrome atau Safari terbaru.');
    }
    const video = { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } };
    try {
      st.stream = await navigator.mediaDevices.getUserMedia({ video, audio: withAudio ? { echoCancellation: true, noiseSuppression: true } : false });
    } catch (e) {
      if (withAudio && e.name !== 'NotAllowedError') {
        st.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false }).catch((e2) => { throw camError(e2); });
      } else if (withAudio && e.name === 'NotAllowedError') {
        // maybe only the mic was refused: retry video only
        st.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false }).catch((e2) => { throw camError(e2); });
        toast('Mikrofon tidak diizinkan, lanjut tanpa suara');
      } else {
        throw camError(e);
      }
    }
    return st.stream;
  }
  function camError(e) {
    if (e && e.name === 'NotAllowedError') return new Error('Izin kamera ditolak. Izinkan kamera untuk situs ini di pengaturan browser, lalu muat ulang halaman.');
    if (e && e.name === 'NotFoundError') return new Error('Kamera tidak ditemukan di perangkat ini.');
    if (e && e.name === 'NotReadableError') return new Error('Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi.');
    return new Error('Kamera tidak bisa dibuka: ' + (e && e.message ? e.message : e));
  }
  function attachLocal() {
    const v = $('vMe');
    v.srcObject = st.stream;
    v.classList.toggle('mirror', st.mirror);
    v.play().catch(() => {});
    const hasAudio = st.stream.getAudioTracks().length > 0;
    $('btnMic').hidden = !hasAudio;
  }

  // ---------- booth screen ----------
  function enterBooth() {
    show('scrBooth');
    $('stage').classList.toggle('solo', !duo());
    attachLocal();
    $('vThem').classList.toggle('mirror', st.remoteMirror);
    updateStartButton();
  }

  // ---------- connection ----------
  function newPeer(id) {
    // PeerJS 1.5.4 ships default STUN + TURN (eu-0/us-0.turn.peerjs.com), so no ICE config here.
    const p = id ? new Peer(id, { debug: 1 }) : new Peer({ debug: 1 });
    p.on('disconnected', () => { if (!p.destroyed) { try { p.reconnect(); } catch (e) { /* ignore */ } } });
    return p;
  }

  function createRoom() {
    st.code = randCode(6);
    status('wait', 'Membuat ruangan…');
    const p = newPeer(ID_PREFIX + st.code);
    st.peer = p;
    p.on('open', () => {
      if (connected()) return; // signalling reconnect while a friend is already here
      const link = inviteLink();
      $('roomCode').textContent = st.code;
      $('invite').hidden = false;
      $('invite').dataset.link = link;
      status('wait', 'Menunggu teman');
      msg('Kirim link ke temanmu. Begitu dia bergabung, videonya muncul di sini.');
    });
    p.on('connection', (c) => {
      // Newest joiner wins: a phone that dropped off may not signal close for a while,
      // so a rejoin must replace the stale connection.
      if (st.conn && st.conn !== c) {
        const old = st.conn;
        st.conn = null;
        try { old.close(); } catch (e) { /* ignore */ }
      }
      setupConn(c);
    });
    p.on('call', (call) => {
      if (st.call && st.call !== call) { try { st.call.close(); } catch (e) { /* ignore */ } }
      call.answer(st.stream);
      setupCall(call);
    });
    p.on('error', (e) => {
      console.warn('peer error', e.type, e);
      if (e.type === 'unavailable-id') { p.destroy(); createRoom(); return; }
      if (['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible'].includes(e.type)) {
        status('bad', 'Tidak tersambung');
        msg('Gagal menghubungi server ruangan. Cek internetmu.', true, () => { p.destroy(); createRoom(); });
      }
    });
  }

  function inviteLink() {
    return location.origin + location.pathname + (FAKE ? '?fake=1' : '') + '#room=' + st.code;
  }

  function joinRoom() {
    if (!st.peer || st.peer.destroyed) {
      status('wait', 'Menyambung…');
      const p = newPeer();
      st.peer = p;
      p.on('open', () => { if (!connected()) connectToHost(); });
      p.on('error', (e) => {
        console.warn('peer error', e.type, e);
        if (e.type === 'peer-unavailable') {
          status('bad', 'Ruangan tidak ada');
          msg('Ruangan tidak ditemukan. Cek kodenya, atau minta temanmu membuka ruangannya lagi.', true, connectToHost);
        } else if (['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible'].includes(e.type)) {
          status('bad', 'Tidak tersambung');
          msg('Gagal menghubungi server ruangan. Cek internetmu.', true, () => { p.destroy(); joinRoom(); });
        }
      });
    } else if (st.peer.open) {
      connectToHost();
    }
  }

  function connectToHost() {
    const hostId = ID_PREFIX + st.code;
    status('wait', 'Menyambung…');
    msg('Menyambung ke ruangan ' + st.code + '…');
    if (st.conn) { try { st.conn.close(); } catch (e) { /* ignore */ } st.conn = null; }
    if (st.call) { try { st.call.close(); } catch (e) { /* ignore */ } st.call = null; }
    const c = st.peer.connect(hostId, { reliable: true });
    setupConn(c);
    setupCall(st.peer.call(hostId, st.stream));
    setTimeout(() => {
      if (st.conn === c && !c.open) {
        status('bad', 'Belum tersambung');
        msg('Belum bisa tersambung. Coba ganti jaringan (WiFi atau data seluler), lalu coba lagi.', true, connectToHost);
      }
    }, 15000);
  }

  function setupConn(c) {
    st.conn = c;
    c.on('open', () => {
      if (st.conn !== c) return;
      status('ok', 'Terhubung');
      msg(st.role === 'host' ? 'Temanmu sudah masuk. Atur layout lalu tekan Mulai.' : 'Tersambung! Siapa pun boleh menekan Mulai.');
      $('invite').hidden = true;
      send({ type: 'hello', mirror: st.mirror });
      if (st.role === 'host') {
        send({ type: 'settings', layout: st.layout });
        st.rtt = Infinity;
        [0, 300, 700].forEach((d) => setTimeout(() => send({ type: 'ping', t: performance.now() }), d));
      }
      updateStartButton();
    });
    c.on('data', onData);
    c.on('close', () => {
      if (st.conn !== c) return;
      st.conn = null;
      status('bad', 'Teman terputus');
      $('themEmpty').hidden = false;
      $('themEmpty').textContent = st.role === 'host' ? 'Teman terputus. Menunggu dia bergabung lagi…' : 'Terputus dari ruangan.';
      if (st.role === 'host') {
        $('invite').hidden = false;
        msg('Koneksi terputus. Temanmu bisa membuka link yang sama untuk masuk lagi.');
      } else {
        msg('Koneksi terputus.', true, connectToHost);
      }
      updateStartButton();
    });
    c.on('error', (e) => console.warn('conn error', e));
  }

  function setupCall(call) {
    if (!call) return;
    st.call = call;
    call.on('stream', (s) => {
      const v = $('vThem');
      v.srcObject = s;
      v.classList.toggle('mirror', st.remoteMirror);
      v.play().catch(() => {
        // autoplay with sound blocked: play muted and let a tap unmute
        v.muted = true;
        v.play().catch(() => {});
        toast('Ketuk video temanmu untuk menyalakan suara');
        v.addEventListener('click', () => { v.muted = false; v.play(); }, { once: true });
      });
      $('themEmpty').hidden = true;
    });
    call.on('close', () => {
      if (st.call !== call) return;
      $('vThem').srcObject = null;
      $('themEmpty').hidden = false;
    });
    call.on('error', (e) => console.warn('call error', e));
    const watch = () => {
      const pc = call.peerConnection;
      if (!pc) { setTimeout(watch, 300); return; }
      pc.addEventListener('iceconnectionstatechange', () => {
        if (pc.iceConnectionState === 'failed') {
          msg('Video tidak bisa tersambung di jaringan ini. Coba ganti jaringan (WiFi lain atau data seluler).', true, st.role === 'guest' ? connectToHost : null);
        }
      });
    };
    watch();
  }

  // ---------- protocol ----------
  function onData(d) {
    if (!d || typeof d !== 'object') return;
    switch (d.type) {
      case 'hello':
        st.remoteMirror = !!d.mirror;
        $('vThem').classList.toggle('mirror', st.remoteMirror);
        break;
      case 'ping': send({ type: 'pong', t: d.t }); break;
      case 'pong': st.rtt = Math.min(st.rtt, performance.now() - d.t); break;
      case 'settings': if (!st.busy) setLayout(d.layout, false); break;
      case 'request-start': if (st.role === 'host' && !st.busy) hostStart(); break;
      case 'start': if (st.role === 'guest' && !st.busy) beginSession({ id: d.s, layout: d.layout, shots: d.shots }, 0); break;
      case 'frame': onFrame(d); break;
      case 'full':
        status('bad', 'Ruangan penuh');
        msg('Ruangan ini sudah berisi dua orang.', true);
        break;
    }
  }

  function hostStart() {
    const info = { id: randCode(8), layout: st.layout, shots: SHOTS[st.layout] };
    if (duo()) send({ type: 'start', s: info.id, layout: info.layout, shots: info.shots });
    // guest starts on receipt; we start half a round-trip later so the countdowns line up
    const delay = duo() ? Math.min(400, (isFinite(st.rtt) ? st.rtt : 120) / 2) : 0;
    beginSession(info, delay);
  }

  function beginSession(info, delay) {
    st.busy = true;
    setLayout(info.layout, false);
    show('scrBooth');
    lockControls(true);
    $('tray').innerHTML = '';
    msg('Siap-siap… lihat ke kamera!');
    const ses = {
      id: info.id, layout: info.layout, n: info.shots,
      mine: [], theirs: [], fallback: [],
      waiter: null, done: false,
      aspect: duo() ? C.DUO_HALF : C.SOLO,
    };
    st.session = ses;
    const step = 3 * COUNT_MS + SHOT_GAP_MS;
    const t0 = performance.now() + delay;
    const at = (ms, fn) => setTimeout(() => { if (st.session === ses) fn(); }, Math.max(0, t0 + ms - performance.now()));
    for (let i = 0; i < ses.n; i++) {
      const base = i * step;
      at(base, () => { label(i, ses.n); countdown(3); });
      at(base + COUNT_MS, () => countdown(2));
      at(base + 2 * COUNT_MS, () => countdown(1));
      at(base + 3 * COUNT_MS, () => capture(ses, i));
    }
    at((ses.n - 1) * step + 3 * COUNT_MS + 700, () => finish(ses));
  }

  function label(i, n) {
    const l = $('shotLabel');
    l.hidden = false;
    l.textContent = 'Foto ' + (i + 1) + ' dari ' + n;
  }
  function countdown(n) {
    const c = $('count');
    c.textContent = n;
    c.classList.remove('show');
    void c.offsetWidth;
    c.classList.add('show');
    clearTimeout(countdown.t);
    countdown.t = setTimeout(() => { c.classList.remove('show'); c.textContent = ''; }, COUNT_MS);
  }
  function flash() {
    ['flashMe', 'flashThem'].forEach((id) => {
      const f = $(id);
      f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
    });
  }

  function capture(ses, i) {
    flash();
    const mine = C.grab($('vMe'), ses.aspect, st.mirror, 960);
    const thumb = C.grab(mine, ses.aspect, false, 160);
    $('tray').appendChild(thumb);
    ses.mine[i] = C.canvasToBlob(mine, 'image/jpeg', 0.9);
    if (duo()) {
      const vt = $('vThem');
      if (vt.srcObject && vt.videoWidth) ses.fallback[i] = C.grab(vt, ses.aspect, st.remoteMirror, 960);
      ses.mine[i].then(async (blob) => {
        if (!blob) return;
        const buf = await blob.arrayBuffer();
        send({ type: 'frame', s: ses.id, i, data: buf });
      });
    }
  }

  function onFrame(d) {
    const ses = st.session;
    if (!ses || ses.id !== d.s || typeof d.i !== 'number') return;
    const data = d.data instanceof Blob ? d.data : new Blob([d.data], { type: 'image/jpeg' });
    ses.theirs[d.i] = data;
    if (ses.waiter) ses.waiter();
  }

  function haveAllTheirs(ses) {
    for (let i = 0; i < ses.n; i++) if (!ses.theirs[i]) return false;
    return true;
  }

  async function finish(ses) {
    $('shotLabel').hidden = true;
    if (duo() && !haveAllTheirs(ses)) {
      msg('Menunggu foto dari temanmu…');
      await new Promise((resolve) => {
        const t = setTimeout(resolve, FRAME_WAIT_MS);
        ses.waiter = () => { if (haveAllTheirs(ses)) { clearTimeout(t); resolve(); } };
      });
      ses.waiter = null;
    }
    if (st.session !== ses) return;
    let usedFallback = 0;
    const shots = [];
    for (let i = 0; i < ses.n; i++) {
      const mineImg = await C.blobToImage(await ses.mine[i]);
      let theirImg = null;
      if (duo()) {
        if (ses.theirs[i]) theirImg = await C.blobToImage(ses.theirs[i]);
        if (!theirImg) { theirImg = ses.fallback[i] || null; usedFallback++; }
      }
      if (st.role === 'guest') shots.push({ a: theirImg, b: mineImg });
      else shots.push({ a: mineImg, b: theirImg });
    }
    ses.done = true;
    st.busy = false;
    lockControls(false);
    msg('');
    C.clearCache();
    st.shots = shots;
    st.result.seed = (Math.random() * 1e9) | 0;
    st.result.layout = ses.layout;
    st.result.duo = duo();
    st.result.date = new Date();
    $('resultNote').textContent = usedFallback
      ? usedFallback + ' foto temanmu diambil dari video karena koneksi lambat, jadi kualitasnya sedikit lebih rendah.'
      : (duo() ? 'Temanmu mendapat foto yang sama di HP-nya dan bisa menghias versinya sendiri.' : '');
    show('scrResult');
    renderResult();
  }

  // ---------- result ----------
  let renderT;
  function renderResultSoon() { clearTimeout(renderT); renderT = setTimeout(renderResult, 140); }
  async function renderResult() {
    if (!st.shots) return;
    const token = ++st.renderToken;
    st.blob = null;
    try { await document.fonts.load('italic 500 60px "Fraunces"'); await document.fonts.load('500 30px "DM Sans"'); } catch (e) { /* ok */ }
    if (token !== st.renderToken) return;
    C.render($('out'), st.shots, st.result);
    const blob = await C.canvasToBlob($('out'), 'image/jpeg', 0.92);
    if (token === st.renderToken) st.blob = blob;
  }
  function fileName() {
    const d = st.result.date || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return 'foto-bareng-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + '.jpg';
  }
  function download() {
    if (!st.blob) { toast('Sebentar, fotonya masih diproses…'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(st.blob);
    a.download = fileName();
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function share() {
    if (!st.blob) { toast('Sebentar, fotonya masih diproses…'); return; }
    const file = new File([st.blob], fileName(), { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).catch((e) => {
        if (e && e.name !== 'AbortError') { toast('Tidak bisa membagikan, fotonya disimpan saja'); download(); }
      });
    } else {
      toast('Browser ini belum bisa membagikan file, fotonya disimpan');
      download();
    }
  }

  function pressGroup(groupSel, attr, value) {
    document.querySelectorAll(groupSel + ' [data-' + attr + ']').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
  }

  // ---------- wiring ----------
  async function startAs(role, code) {
    st.role = role;
    st.code = code || null;
    try {
      await getStream(role !== 'solo');
    } catch (e) {
      show(role === 'guest' ? 'scrJoin' : 'scrHome');
      status('bad', 'Kamera');
      toast(e.message);
      alert(e.message);
      st.role = null;
      return;
    }
    enterBooth();
    if (role === 'host') createRoom();
    else if (role === 'guest') joinRoom();
    else { status('ok', 'Mode sendiri'); msg('Pilih layout lalu tekan Mulai.'); }
  }

  $('btnCreate').onclick = () => startAs('host');
  $('btnSolo').onclick = () => startAs('solo');
  $('joinForm').onsubmit = (e) => {
    e.preventDefault();
    const code = cleanCode($('joinCode').value);
    if (code.length < 4) { toast('Kodenya kurang lengkap'); return; }
    startAs('guest', code);
  };
  $('btnJoin').onclick = () => startAs('guest', st.code);

  document.querySelectorAll('#layoutGroup .chip').forEach((b) => {
    b.onclick = () => { if (!st.busy) setLayout(b.dataset.layout, true); };
  });
  $('btnStart').onclick = () => {
    if (st.busy) return;
    if (st.role === 'guest') {
      if (!connected()) return;
      send({ type: 'request-start' });
      msg('Memulai…');
    } else {
      hostStart();
    }
  };
  $('btnMic').onclick = () => {
    const tracks = st.stream ? st.stream.getAudioTracks() : [];
    if (!tracks.length) return;
    const on = !tracks[0].enabled;
    tracks.forEach((t) => { t.enabled = on; });
    $('btnMic').textContent = on ? '🎙️' : '🔇';
    $('btnMic').title = on ? 'Matikan mikrofon' : 'Nyalakan mikrofon';
    $('btnMic').setAttribute('aria-label', $('btnMic').title);
  };
  $('btnCopy').onclick = async () => {
    const link = $('invite').dataset.link;
    try { await navigator.clipboard.writeText(link); toast('Link disalin'); }
    catch (e) { prompt('Salin link ini:', link); }
  };
  $('btnInvite').onclick = () => {
    const link = $('invite').dataset.link;
    const text = 'Yuk foto bareng! Buka link ini ya: ' + link;
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  };

  // result controls
  const themeGroup = $('themeGroup');
  C.THEMES.forEach((t) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.theme = t.id;
    b.title = t.name;
    b.setAttribute('aria-label', 'Frame ' + t.name);
    b.style.background = 'linear-gradient(135deg, ' + t.bg + ' 60%, ' + t.accent + ' 60%)';
    b.setAttribute('aria-pressed', String(t.id === st.result.theme));
    b.onclick = () => { st.result.theme = t.id; pressGroup('#themeGroup', 'theme', t.id); renderResult(); };
    themeGroup.appendChild(b);
  });
  document.querySelectorAll('#filterGroup .chip').forEach((b) => {
    b.onclick = () => { st.result.filter = b.dataset.filter; pressGroup('#filterGroup', 'filter', b.dataset.filter); renderResult(); };
  });
  document.querySelectorAll('#decoGroup .chip').forEach((b) => {
    b.onclick = () => { st.result.deco = b.dataset.deco; pressGroup('#decoGroup', 'deco', b.dataset.deco); renderResult(); };
  });
  $('titleInput').oninput = (e) => { st.result.title = e.target.value; renderResultSoon(); };
  $('dateCheck').onchange = (e) => { st.result.showDate = e.target.checked; renderResult(); };
  $('btnDownload').onclick = download;
  $('btnShare').onclick = share;
  $('btnAgain').onclick = () => {
    $('tray').innerHTML = '';
    enterBooth();
    if (duo()) msg(connected() ? 'Siap untuk sesi berikutnya.' : 'Teman belum tersambung.');
    else msg('Pilih layout lalu tekan Mulai.');
  };

  // ---------- route ----------
  const m = location.hash.match(/room=([a-z0-9]+)/i);
  if (m) {
    st.code = cleanCode(m[1]);
    $('joinShow').textContent = st.code;
    show('scrJoin');
  } else {
    show('scrHome');
  }

  // debug handle for testing
  window.__pb = st;
})();
