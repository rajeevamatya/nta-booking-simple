let HOURS = [6,7,8,9,10,11,12,13,14,15,16,17,18,19];
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY;

let CONFIG = {
  openFrom: 6, openTo: 19,
  priceSingles: 400, priceDoubles: 600,
  whatsapp: '9779841044844',
  qrUrl: null,
  discountRanked: 25, discountCoach: 25,
  nightPremium: 25, nightStarts: 18,
  closureFrom: null, closureTo: null, closureMessage: '',
};

function sbHeaders(extra = {}) {
  return { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...extra };
}
function normalizePhone(v) {
  if (!v) return v;
  if (v.startsWith('+')) return v;
  const d = v.replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('9')) return '+977' + d;
  if (d.length === 13 && d.startsWith('977')) return '+' + d;
  return v;
}
async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  return r.json();
}
async function sbPost(path, body) {
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method:'POST', headers: sbHeaders({'Prefer':'return=minimal'}), body: JSON.stringify(body) });
}
async function sbPatch(path, body) {
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method:'PATCH', headers: sbHeaders({'Prefer':'return=minimal'}), body: JSON.stringify(body) });
}

let S = { mobile:'', user:null, nat:'np', playerType:'recreational', date:'', slots:[], court:null, ref:'', matchType:'singles', bookings:[], paymentFile:null, paymentReady:null };
let timerInterval = null;

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0,0);
}

function fmt12(h) {
  if (h===0) return '12:00 AM';
  if (h===12) return '12:00 PM';
  return h<12 ? h+':00 AM' : (h-12)+':00 PM';
}
function fmtRange(slots) {
  if (!slots.length) return '';
  return fmt12(slots[0]) + ' – ' + fmt12(slots[slots.length-1]+1);
}
function genRef() {
  return 'NTA-' + Date.now().toString(36).toUpperCase().slice(-4) + '-' + Math.random().toString(36).slice(2,5).toUpperCase();
}

async function checkMobile() {
  const v = document.getElementById('mobile-input').value.trim();
  const err = document.getElementById('mobile-err');
  const digits = v.replace(/\D/g, '');
  if (!digits || digits.length < 6) { err.style.display='block'; return; }
  err.style.display='none';
  const cc = document.getElementById('country-code').value;
  S.mobile = cc + digits;
  const btn = document.querySelector('#screen-login .btn-primary');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Checking…';
  try {
    const data = await sbGet(`members?phone=eq.${encodeURIComponent(S.mobile)}&select=*`);
    if (data && data.length > 0) {
      const m = data[0];
      const playerType = m.player_type || (m.is_ranked ? 'ranked' : 'recreational');
      S.user = { name: m.name, nat: m.nationality, playerType, verified: m.is_verified };
      renderChip(); show('screen-booking'); updatePriceLabels(); initDate();
    } else {
      document.getElementById('reg-mobile').value = v;
      show('screen-register');
    }
  } catch(e) {
    err.textContent = 'Network error — please try again.';
    err.style.display = 'block';
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-arrow-right"></i> Continue';
}

function getDiscount() {
  if (!S.user) return 0;
  if (S.user.playerType === 'ranked') return CONFIG.discountRanked;
  if (S.user.playerType === 'coach')  return CONFIG.discountCoach;
  return 0;
}
function hasNightSlots() {
  return CONFIG.nightPremium > 0 && S.slots.some(h => h >= CONFIG.nightStarts);
}
function nightNoteText() {
  return `<i class="ti ti-moon" style="font-size:11px;vertical-align:-1px;margin-right:3px"></i>Includes night rate (+${CONFIG.nightPremium}%) for hours after ${fmt12(CONFIG.nightStarts)}`;
}
function getPrice() {
  const baseRate = S.matchType === 'singles' ? CONFIG.priceSingles : CONFIG.priceDoubles;
  const disc = getDiscount();
  const total = S.slots.reduce((sum, h) => {
    const rate = h >= CONFIG.nightStarts ? Math.round(baseRate * (1 + CONFIG.nightPremium / 100)) : baseRate;
    return sum + rate;
  }, 0);
  return disc ? Math.round(total * (1 - disc / 100)) : total;
}
function updatePriceLabels() {
  const disc = getDiscount();
  const applyDisc = (v) => disc ? Math.round(v * (1 - disc / 100)) : v;
  const sDay = applyDisc(CONFIG.priceSingles);
  const dDay = applyDisc(CONFIG.priceDoubles);
  const tag = disc ? ` <span style="font-size:10px;background:var(--accent);color:var(--green-dark);border-radius:4px;padding:1px 5px;font-weight:700;vertical-align:1px">${disc}% off</span>` : '';
  const sEl = document.getElementById('type-singles');
  const dEl = document.getElementById('type-doubles');
  if (sEl) sEl.innerHTML = `<i class="ti ti-user" style="font-size:12px;vertical-align:-2px;margin-right:4px"></i>Singles · Rs. ${sDay}/hr${tag}`;
  if (dEl) dEl.innerHTML = `<i class="ti ti-users" style="font-size:12px;vertical-align:-2px;margin-right:4px"></i>Doubles · Rs. ${dDay}/hr${tag}`;
  const note = document.getElementById('night-rate-note');
  if (note) {
    if (CONFIG.nightPremium > 0) {
      const sNight = applyDisc(Math.round(CONFIG.priceSingles * (1 + CONFIG.nightPremium / 100)));
      const dNight = applyDisc(Math.round(CONFIG.priceDoubles * (1 + CONFIG.nightPremium / 100)));
      note.innerHTML = `<i class="ti ti-moon" style="font-size:11px;vertical-align:-1px;margin-right:3px"></i>Night rate after ${fmt12(CONFIG.nightStarts)}: Rs. ${sNight} singles · Rs. ${dNight} doubles (+${CONFIG.nightPremium}%)`;
      note.style.display = 'block';
    } else {
      note.style.display = 'none';
    }
  }
}
function selType(v) {
  S.matchType=v;
  document.getElementById('type-singles').className='toggle-btn'+(v==='singles'?' selected':'');
  document.getElementById('type-doubles').className='toggle-btn'+(v==='doubles'?' selected':'');
  if (S.court) {
    document.getElementById('sum-type').textContent=v==='singles'?'Singles':'Doubles';
    document.getElementById('sum-price').textContent='Rs. '+getPrice().toLocaleString();
  }
}
function selNat(v) {
  S.nat=v;
  document.getElementById('nat-np').className='toggle-btn'+(v==='np'?' selected':'');
  document.getElementById('nat-intl').className='toggle-btn'+(v==='intl'?' selected':'');
}
function selPlayerType(v) {
  S.playerType=v;
  ['recreational','ranked','coach'].forEach(t => {
    document.getElementById('rank-'+t).className='toggle-btn'+(v===t?' selected':'');
  });
}
async function doRegister() {
  const name=document.getElementById('reg-name').value.trim();
  if (!name) { document.getElementById('reg-err').style.display='block'; return; }
  document.getElementById('reg-err').style.display='none';
  const btn = document.querySelector('#screen-register .btn-primary');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Registering…';
  try {
    await sbPost('members', { phone:S.mobile, name, nationality:S.nat, player_type:S.playerType, is_ranked:S.playerType==='ranked' });
    S.user = { name, nat:S.nat, playerType:S.playerType, verified:false };
    renderChip(); show('screen-booking'); updatePriceLabels(); initDate();
  } catch(e) {
    const regErr = document.getElementById('reg-err');
    regErr.textContent = 'Network error — please try again.';
    regErr.style.display = 'block';
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-user-plus"></i> Register &amp; continue';
}

function renderChip() {
  const u=S.user;
  const ini=u.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const verifiedBadge=u.verified
    ?'<span class="badge badge-verified"><i class="ti ti-circle-check" style="font-size:10px;vertical-align:-1px"></i> Verified</span>'
    :'<span class="badge badge-unverified"><i class="ti ti-circle" style="font-size:10px;vertical-align:-1px"></i> Unverified</span>';
  const rankBadge=u.playerType==='ranked'
    ?'<span class="badge badge-ranked"><i class="ti ti-medal" style="font-size:10px;vertical-align:-1px"></i> Ranked</span>'
    :u.playerType==='coach'
    ?'<span class="badge badge-coach"><i class="ti ti-whistle" style="font-size:10px;vertical-align:-1px"></i> Coach</span>'
    :'';
  document.getElementById('user-chip').innerHTML=`
    <div class="user-chip">
      <div class="avatar">${ini}</div>
      <div>
        <div class="chip-name">${u.name} ${rankBadge} ${verifiedBadge}</div>
        <div class="chip-phone">${S.mobile}</div>
      </div>
    </div>`;
}

function updateDayLabel() {
  const el = document.getElementById('date-day-label');
  if (!S.date) { el.textContent = ''; return; }
  const d = new Date(S.date + 'T00:00:00');
  el.textContent = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
async function initDate() {
  S.date=new Date().toISOString().split('T')[0];
  S.slots=[]; S.court=null; S.bookings=[];
  document.getElementById('date-today').classList.add('selected');
  document.getElementById('date-tomorrow').classList.remove('selected');
  updateDayLabel(); hideCourts(); await fetchBookings(); renderSlots();
}
async function selDate(which) {
  const d=new Date(); if(which==='tomorrow') d.setDate(d.getDate()+1);
  S.date=d.toISOString().split('T')[0];
  S.slots=[]; S.court=null; S.bookings=[];
  document.getElementById('date-today').classList.toggle('selected', which==='today');
  document.getElementById('date-tomorrow').classList.toggle('selected', which==='tomorrow');
  updateDayLabel(); hideCourts(); await fetchBookings(); renderSlots();
}
async function fetchBookings() {
  if (!S.date) return;
  const list=document.getElementById('slots-list');
  const sec=document.getElementById('slots-section');
  sec.style.display='block';
  list.innerHTML='<div style="text-align:center;padding:1rem;color:var(--text-faint);font-size:13px"><i class="ti ti-loader-2 spin"></i> Loading availability…</div>';
  try {
    const data=await sbGet(`bookings?date=eq.${S.date}&status=neq.Cancelled&select=court,slots`);
    S.bookings=data||[];
  } catch(e) { S.bookings=[]; }
}
function isSlotFull(h) {
  const taken=new Set(S.bookings.filter(b=>b.slots.includes(h)).map(b=>b.court));
  return taken.size>=6;
}

function renderSlots() {
  const sec=document.getElementById('slots-section');
  if (!S.date) { sec.style.display='none'; return; }
  sec.style.display='block';
  document.getElementById('slots-list').innerHTML=HOURS.map(h=>{
    const label=fmt12(h)+' – '+fmt12(h+1);
    const full=isSlotFull(h);
    return `<div class="slot-cell${full?' slot-full':''}" id="slot-${h}" data-h="${h}"
      ${full?'style="opacity:0.42;cursor:not-allowed"':(`onclick="toggleSlot(${h})"`)}>
      ${label}<span class="slot-badge" id="slot-badge-${h}" style="display:${full?'inline':'none'}">${full?'Full':'2nd hr'}</span></div>`;
  }).join('');
}

function toggleSlot(h) {
  if (isSlotFull(h)) return;
  const cur=S.slots;
  if (cur.includes(h)) {
    S.slots = cur.length===2 ? [h===cur[0]?cur[1]:cur[0]] : [];
  } else {
    if (!cur.length) {
      S.slots=[h];
    } else if (cur.length===1 && Math.abs(h-cur[0])===1) {
      S.slots=[Math.min(h,cur[0]),Math.max(h,cur[0])];
    } else {
      S.slots=[h];
    }
  }
  document.getElementById('slot-err').style.display='none';
  updateSlotUI();
  if (S.slots.length) renderCourts(); else hideCourts();
}

function updateSlotUI() {
  const adjacent = S.slots.length===1
    ? [S.slots[0]-1, S.slots[0]+1].filter(h=>HOURS.includes(h)&&!isSlotFull(h))
    : [];
  HOURS.forEach(h=>{
    const el=document.getElementById('slot-'+h);
    const badge=document.getElementById('slot-badge-'+h);
    if (!el || el.classList.contains('slot-full')) return;
    badge.style.display='none';
    if (S.slots.length===1 && S.slots[0]===h) {
      el.className='slot-cell sel-single';
    } else if (S.slots.length===2 && S.slots[0]===h) {
      el.className='slot-cell sel-first';
    } else if (S.slots.length===2 && S.slots[1]===h) {
      el.className='slot-cell sel-second';
      badge.style.display='inline';
    } else if (adjacent.includes(h)) {
      el.className='slot-cell slot-hint';
    } else {
      el.className='slot-cell';
    }
  });
}

function takenForSlots(date,slots) {
  const taken=new Set();
  S.bookings.forEach(b=>{ if(slots.some(s=>b.slots.includes(s))) taken.add(b.court); });
  return [...taken];
}

function renderCourts() {
  S.court=null;
  const taken=takenForSlots(S.date,S.slots);
  document.getElementById('courts-pill').textContent=fmtRange(S.slots);
  const grid=document.getElementById('court-grid');
  grid.innerHTML='';
  for (let c=1;c<=6;c++) {
    const isTaken=taken.includes(c);
    const div=document.createElement('div');
    div.className='court-card '+(isTaken?'booked':'available');
    div.innerHTML=`
      <div class="${isTaken?'court-icon taken':'court-icon'}"><i class="ti ti-tournament"></i></div>
      <div class="court-num">${c}</div>
      <div class="court-lbl ${isTaken?'lbl-taken':'lbl-free'}">${isTaken?'Booked':'Free'}</div>`;
    if (!isTaken) div.onclick=()=>selectCourt(div,c);
    grid.appendChild(div);
  }
  document.getElementById('courts-section').style.display='block';
  document.getElementById('confirm-bar').style.display='none';
  document.getElementById('select-hint').style.display='block';
}

function hideCourts() {
  document.getElementById('courts-section').style.display='none';
  document.getElementById('confirm-bar').style.display='none';
  S.court=null;
}

function selectCourt(el,c) {
  document.querySelectorAll('.court-card').forEach(x=>{
    if (x.classList.contains('selected')) { x.classList.remove('selected'); x.classList.add('available'); }
  });
  el.classList.remove('available'); el.classList.add('selected');
  S.court=c;
  document.getElementById('sum-court').textContent='Court '+c;
  document.getElementById('sum-date').textContent=fmtDate(S.date);
  document.getElementById('sum-time').textContent=fmtRange(S.slots);
  document.getElementById('sum-dur').textContent=S.slots.length===2?'2 hours':'1 hour';
  document.getElementById('sum-type').textContent=S.matchType==='singles'?'Singles':'Doubles';
  document.getElementById('sum-price').textContent='Rs. '+getPrice().toLocaleString();
  const snn = document.getElementById('sum-night-note');
  if (hasNightSlots()) { snn.innerHTML = nightNoteText(); snn.style.display='block'; } else { snn.style.display='none'; }
  document.getElementById('select-hint').style.display='none';
  document.getElementById('confirm-bar').style.display='block';
}

function clearCourt() {
  document.querySelectorAll('.court-card.selected').forEach(x=>{x.classList.remove('selected');x.classList.add('available');});
  S.court=null;
  document.getElementById('confirm-bar').style.display='none';
  document.getElementById('select-hint').style.display='block';
}

async function confirmBooking() {
  S.ref=genRef();
  const btn = document.querySelector('#confirm-bar .btn-accent');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Confirming…';
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
      method: 'POST',
      headers: sbHeaders({'Prefer':'return=minimal'}),
      body: JSON.stringify({ ref:S.ref, phone:S.mobile, name:S.user.name,
        court:S.court, date:S.date, time_label:fmtRange(S.slots),
        slots:S.slots, match_type:S.matchType, amount:getPrice(),
        status:'Awaiting Payment' })
    });
    if (!r.ok) throw new Error('Server error '+r.status);
  } catch(e) {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i> Confirm booking';
    const hint = document.getElementById('select-hint');
    hint.innerHTML = '<span style="color:#dc2626"><i class="ti ti-alert-circle" style="vertical-align:-2px"></i> Could not save booking — please check your connection and try again.</span>';
    hint.style.display = 'block';
    return;
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-check"></i> Confirm booking';
  document.getElementById('conf-ref').textContent=S.ref;
  document.getElementById('conf-court').textContent='Court '+S.court;
  document.getElementById('conf-date').textContent=fmtDate(S.date);
  document.getElementById('conf-time').textContent=fmtRange(S.slots)+' ('+S.slots.length+' hr)';
  document.getElementById('conf-player').textContent=S.user.name;
  document.getElementById('conf-type').textContent=S.matchType==='singles'?'Singles':'Doubles';
  document.getElementById('conf-price').textContent='Rs. '+getPrice().toLocaleString();
  const cnn = document.getElementById('conf-night-note');
  if (hasNightSlots()) { cnn.innerHTML = nightNoteText(); cnn.style.display='block'; } else { cnn.style.display='none'; }
  document.getElementById('upload-area').className='upload-area';
  document.getElementById('upload-icon-el').innerHTML='<i class="ti ti-photo-up"></i>';
  document.getElementById('upload-text-el').innerHTML='<strong>Tap to upload</strong> screenshot or photo<br>of your payment';
  document.getElementById('upload-filename').textContent='';
  document.getElementById('submit-payment-btn').style.display='none';
  document.getElementById('upload-err').style.display='none';
  document.getElementById('timer-msg').style.display='none';
  show('screen-success');
  startTimer();
}

function copyRef() {
  const text = S.ref;
  const btn = document.getElementById('copy-ref-btn');
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-999px;left:-999px;opacity:0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  if (navigator.clipboard) navigator.clipboard.writeText(text).catch(()=>{});
  btn.classList.add('copied');
  btn.innerHTML = '<i class="ti ti-check"></i>';
  setTimeout(() => {
    btn.classList.remove('copied');
    btn.innerHTML = '<i class="ti ti-copy"></i>';
  }, 1800);
}
function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  let secs=600;
  const el=document.getElementById('timer-count');
  el.className='';
  function tick() {
    const m=Math.floor(secs/60), s=secs%60;
    el.textContent=m+':'+(s<10?'0':'')+s;
    if (secs<=60) el.className='urgent';
    if (secs<=0) { clearInterval(timerInterval); el.textContent='0:00'; document.getElementById('timer-msg').style.display='block'; }
    secs--;
  }
  tick();
  timerInterval=setInterval(tick,1000);
}

function handleUpload(input) {
  if (!input.files.length) return;
  const file=input.files[0];
  S.paymentFile=null;
  S.paymentReady=new Promise(resolve=>{
    const reader=new FileReader();
    reader.onload=function(e){
      const img=new Image();
      img.onload=function(){
        const MAX=800;
        const scale=Math.min(1,MAX/Math.max(img.width,img.height));
        const canvas=document.createElement('canvas');
        canvas.width=Math.round(img.width*scale);
        canvas.height=Math.round(img.height*scale);
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        const compressed=canvas.toDataURL('image/jpeg',0.6);
        resolve({ data:compressed.split(',')[1], name:file.name.replace(/\.[^.]+$/,'.jpg'), type:'image/jpeg' });
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  });
  document.getElementById('upload-area').className='upload-area uploaded';
  document.getElementById('upload-icon-el').innerHTML='<i class="ti ti-circle-check" style="color:var(--green)"></i>';
  document.getElementById('upload-text-el').innerHTML='<strong style="color:var(--green)">File selected</strong>';
  document.getElementById('upload-filename').textContent=file.name;
  document.getElementById('submit-payment-btn').style.display='flex';
}

async function submitPayment() {
  if (timerInterval) clearInterval(timerInterval);
  const btn=document.getElementById('submit-payment-btn');
  const uploadErr=document.getElementById('upload-err');
  btn.disabled=true;
  btn.innerHTML='<i class="ti ti-loader-2 spin"></i> Uploading…';
  uploadErr.style.display='none';
  try {
    const f = S.paymentReady ? await S.paymentReady : null;
    if (f) {
      const bytes = atob(f.data);
      const ab = new ArrayBuffer(bytes.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < bytes.length; i++) ia[i] = bytes.charCodeAt(i);
      const blob = new Blob([ab], { type: f.type });
      const path = `${S.ref}.jpg`;
      const up = await fetch(`${SUPABASE_URL}/storage/v1/object/payment-proofs/${path}`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': f.type, 'x-upsert': 'true' },
        body: blob,
      });
      if (!up.ok) throw new Error('Upload failed '+up.status);
      const proofUrl = `${SUPABASE_URL}/storage/v1/object/public/payment-proofs/${S.ref}.jpg`;
      await sbPatch(`bookings?ref=eq.${encodeURIComponent(S.ref)}`, { status:'Pending Verification', proof_url:proofUrl });
    }
  } catch(e) {
    btn.disabled=false;
    btn.innerHTML='<i class="ti ti-send"></i> Submit payment proof';
    uploadErr.style.display='block';
    return;
  }
  btn.disabled=false;
  btn.innerHTML='<i class="ti ti-send"></i> Submit payment proof';
  document.getElementById('paid-ref').textContent=S.ref;
  show('screen-paid');
}

function sendWhatsapp() {
  const msg=encodeURIComponent(
    'Here\'s my payment for Ref: '+S.ref+' 🎾\n\n'+
    '📋 Booking details:\n'+
    '• Court '+S.court+' · '+(S.matchType==='singles'?'Singles':'Doubles')+'\n'+
    '• '+fmtDate(S.date)+'\n'+
    '• '+fmtRange(S.slots)+'\n'+
    '• Total: Rs. '+getPrice().toLocaleString()+'\n\n'+
    'Payment proof attached. Please confirm. Thanks!'
  );
  window.open('https://wa.me/'+CONFIG.whatsapp+'?text='+msg,'_blank');
}

async function loadSettings() {
  try {
    const data = await sbGet('settings?id=eq.1&select=*');
    const s = data && data[0] ? data[0] : {};

    if (s.open_from != null && s.open_to != null) {
      CONFIG.openFrom = s.open_from;
      CONFIG.openTo   = s.open_to;
      HOURS = [];
      for (let h = CONFIG.openFrom; h <= CONFIG.openTo; h++) HOURS.push(h);
    }
    if (s.price_singles)        CONFIG.priceSingles  = s.price_singles;
    if (s.price_doubles)        CONFIG.priceDoubles  = s.price_doubles;
    if (s.whatsapp)             CONFIG.whatsapp      = s.whatsapp;
    if (s.discount_ranked != null) CONFIG.discountRanked = s.discount_ranked;
    if (s.discount_coach  != null) CONFIG.discountCoach  = s.discount_coach;
    if (s.night_premium   != null) CONFIG.nightPremium   = s.night_premium;
    if (s.night_starts    != null) CONFIG.nightStarts    = s.night_starts;

    updatePriceLabels();

    if (s.qr_url) {
      CONFIG.qrUrl = s.qr_url;
      const qrSection = document.getElementById('qr-section');
      const qrImg     = document.getElementById('qr-img');
      if (qrSection && qrImg) {
        qrImg.src = s.qr_url;
        qrSection.style.display = 'block';
      }
    }

    CONFIG.closureFrom    = s.closure_from    || null;
    CONFIG.closureTo      = s.closure_to      || null;
    CONFIG.closureMessage = s.closure_message || '';
    updateClosureBanner();
  } catch(e) {
    console.warn('Settings load failed, using defaults');
  }
}

function updateClosureBanner() {
  const banner = document.getElementById('closure-banner');
  const text   = document.getElementById('closure-banner-text');
  if (!banner || !CONFIG.closureFrom || !CONFIG.closureMessage) {
    if (banner) banner.style.display = 'none';
    return;
  }
  const today = new Date().toISOString().split('T')[0];

  const warn = new Date(CONFIG.closureFrom);
  warn.setDate(warn.getDate() - 7);
  const warnDate = warn.toISOString().split('T')[0];

  const isActive   = CONFIG.closureFrom <= today && (!CONFIG.closureTo || CONFIG.closureTo >= today);
  const isUpcoming = !isActive && today >= warnDate;

  if (isActive) {
    text.textContent = CONFIG.closureMessage;
  } else if (isUpcoming) {
    text.textContent = `Upcoming closure from ${fmtDate(CONFIG.closureFrom)}${CONFIG.closureTo ? ' to ' + fmtDate(CONFIG.closureTo) : ''}: ${CONFIG.closureMessage}`;
  }
  banner.style.display = (isActive || isUpcoming) ? 'flex' : 'none';
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(d)} ${months[parseInt(m)-1]}`;
}

async function refreshBookingStatus() {
  const btn = document.getElementById('refresh-status-btn');
  btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Checking…';
  btn.disabled = true;
  try {
    const data = await sbGet(`bookings?ref=eq.${encodeURIComponent(S.ref)}&select=status`);
    if (data && data[0]) updatePaidStatusUI(data[0].status);
  } catch(e) {}
  btn.innerHTML = '<i class="ti ti-refresh"></i> Refresh status';
  btn.disabled = false;
}

function updatePaidStatusUI(status) {
  const badge = document.getElementById('paid-status-badge');
  const ring = document.getElementById('paid-ring');
  const icon = document.getElementById('paid-ring-icon');
  const title = document.getElementById('paid-title');
  const sub = document.getElementById('paid-subtitle');
  if (status === 'Confirmed') {
    badge.style.cssText = 'display:inline-flex;align-items:center;gap:5px;padding:5px 14px;border-radius:20px;font-size:13px;font-weight:500;background:#dcfce7;color:#166534';
    badge.innerHTML = '<i class="ti ti-circle-check" style="font-size:13px"></i> Booking confirmed!';
    ring.style.background = '#dcfce7'; ring.style.borderColor = '#86efac';
    icon.style.color = '#16a34a';
    title.textContent = 'Booking confirmed!';
    sub.textContent = 'Your court booking is confirmed. See you on the court! 🎾';
    document.getElementById('replace-proof-section').style.display = 'none';
    document.getElementById('refresh-status-btn').style.display = 'none';
  } else if (status === 'Pending Verification') {
    badge.style.cssText = 'display:inline-flex;align-items:center;gap:5px;padding:5px 14px;border-radius:20px;font-size:13px;font-weight:500;background:#dbeafe;color:#1e40af';
    badge.innerHTML = '<i class="ti ti-clock" style="font-size:13px"></i> Pending verification';
  } else if (status === 'Awaiting Payment') {
    badge.style.cssText = 'display:inline-flex;align-items:center;gap:5px;padding:5px 14px;border-radius:20px;font-size:13px;font-weight:500;background:#fef9c3;color:#854d0e';
    badge.innerHTML = '<i class="ti ti-clock" style="font-size:13px"></i> Awaiting payment';
  } else if (status === 'Cancelled') {
    badge.style.cssText = 'display:inline-flex;align-items:center;gap:5px;padding:5px 14px;border-radius:20px;font-size:13px;font-weight:500;background:#f1f5f9;color:#6b7280';
    badge.innerHTML = '<i class="ti ti-x" style="font-size:13px"></i> Booking cancelled';
    document.getElementById('replace-proof-section').style.display = 'none';
  }
}

let replacePaymentReady = null;

function handleReplaceUpload(input) {
  if (!input.files.length) return;
  const file = input.files[0];
  replacePaymentReady = new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        const MAX = 800;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL('image/jpeg', 0.6);
        resolve({ data: compressed.split(',')[1], name: file.name.replace(/\.[^.]+$/, '.jpg'), type: 'image/jpeg' });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
  document.getElementById('replace-upload-area').className = 'upload-area uploaded';
  document.getElementById('replace-upload-text').innerHTML = '<strong style="color:var(--green)">File selected</strong>';
  document.getElementById('replace-upload-filename').textContent = file.name;
  document.getElementById('replace-submit-btn').style.display = 'flex';
}

async function submitReplacePayment() {
  const btn = document.getElementById('replace-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Uploading…';
  try {
    const f = replacePaymentReady ? await replacePaymentReady : null;
    if (f) {
      const bytes = atob(f.data);
      const ab = new ArrayBuffer(bytes.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < bytes.length; i++) ia[i] = bytes.charCodeAt(i);
      const blob = new Blob([ab], { type: f.type });
      const path = `${S.ref}.jpg`;
      const up = await fetch(`${SUPABASE_URL}/storage/v1/object/payment-proofs/${path}`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': f.type, 'x-upsert': 'true' },
        body: blob,
      });
      if (!up.ok) throw new Error('Upload failed '+up.status);
      const proofUrl = `${SUPABASE_URL}/storage/v1/object/public/payment-proofs/${S.ref}.jpg`;
      await sbPatch(`bookings?ref=eq.${encodeURIComponent(S.ref)}`, { proof_url: proofUrl });
      document.getElementById('replace-upload-area').className = 'upload-area';
      document.getElementById('replace-upload-text').innerHTML = '<strong>Tap to replace</strong> payment proof';
      document.getElementById('replace-upload-filename').textContent = '';
      document.getElementById('replace-submit-btn').style.display = 'none';
      document.getElementById('replace-file-input').value = '';
      document.getElementById('replace-err').style.display = 'none';
      replacePaymentReady = null;
      const area = document.getElementById('replace-upload-area');
      area.className = 'upload-area uploaded';
      document.getElementById('replace-upload-text').innerHTML = '<strong style="color:var(--green)">New proof uploaded successfully!</strong>';
      setTimeout(() => {
        area.className = 'upload-area';
        document.getElementById('replace-upload-text').innerHTML = '<strong>Tap to replace</strong> payment proof';
      }, 3000);
    }
  } catch(e) {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-send"></i> Submit new proof';
    document.getElementById('replace-err').style.display = 'block';
    return;
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-send"></i> Submit new proof';
}

function bookAnother() {
  if (timerInterval) clearInterval(timerInterval);
  S.slots=[]; S.court=null;
  renderChip(); show('screen-booking'); initDate();
}
function logout() {
  if (timerInterval) clearInterval(timerInterval);
  S={mobile:'',user:null,nat:'np',playerType:'recreational',date:'',slots:[],court:null,ref:'',matchType:'singles'};
  document.getElementById('mobile-input').value='';
  document.getElementById('type-singles').className='toggle-btn selected';
  document.getElementById('type-doubles').className='toggle-btn';
  ['recreational','ranked','coach'].forEach(t => {
    const el = document.getElementById('rank-'+t);
    if (el) el.className='toggle-btn'+(t==='recreational'?' selected':'');
  });
  updatePriceLabels();
  show('screen-login');
}

loadSettings();

Object.assign(window, {
  checkMobile, show, selNat, selPlayerType, doRegister, selDate, selType,
  toggleSlot, clearCourt, confirmBooking, copyRef, handleUpload,
  submitPayment, sendWhatsapp, bookAnother, logout,
  refreshBookingStatus, handleReplaceUpload, submitReplacePayment,
});
