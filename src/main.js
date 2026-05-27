const HOURS = [6,7,8,9,10,11,12,13,14,15,16,17,18,19];
const NTA_WHATSAPP = '9779841044844';
const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function callFn(name, data) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify(data),
  });
  return r.json();
}

let S = { mobile:'', user:null, nat:'np', ranked:'no', date:'', slots:[], court:null, ref:'', matchType:'singles', bookings:[], paymentFile:null, paymentReady:null };
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
function fmtDate(d) {
  if (!d) return '';
  return new Date(d+'T00:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
}
function genRef() {
  return 'NTA-' + Date.now().toString(36).toUpperCase().slice(-4) + '-' + Math.random().toString(36).slice(2,5).toUpperCase();
}

async function checkMobile() {
  const v = document.getElementById('mobile-input').value.trim();
  const err = document.getElementById('mobile-err');
  if (!/^\d{10}$/.test(v)) { err.style.display='block'; return; }
  err.style.display='none';
  S.mobile = v;
  const btn = document.querySelector('#screen-login .btn-primary');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Checking…';
  try {
    const d = await callFn('lookup', { phone: v });
    if (d.found) {
      S.user = { name: d.name, nat: d.nat, ranked: d.ranked, verified: d.verified };
      renderChip(); show('screen-booking'); initDate();
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

function getPrice() {
  const rate = S.matchType==='singles' ? 400 : 600;
  return rate * S.slots.length;
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
function selRank(v) {
  S.ranked=v;
  document.getElementById('rank-yes').className='toggle-btn'+(v==='yes'?' selected':'');
  document.getElementById('rank-no').className='toggle-btn'+(v==='no'?' selected':'');
}
async function doRegister() {
  const name=document.getElementById('reg-name').value.trim();
  if (!name) { document.getElementById('reg-err').style.display='block'; return; }
  document.getElementById('reg-err').style.display='none';
  const btn = document.querySelector('#screen-register .btn-primary');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Registering…';
  try {
    await callFn('register', { phone: S.mobile, name, nat: S.nat, ranked: S.ranked==='yes' });
    S.user = { name, nat: S.nat, ranked: S.ranked==='yes', verified: false };
    renderChip(); show('screen-booking'); initDate();
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
  const rankBadge=u.ranked?'<span class="badge badge-ranked"><i class="ti ti-medal" style="font-size:10px;vertical-align:-1px"></i> Ranked</span>':'';
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
  const d=document.getElementById('book-date');
  const today=new Date().toISOString().split('T')[0];
  d.min=today; d.value=today;
  S.date=today; S.slots=[]; S.court=null; S.bookings=[];
  updateDayLabel(); hideCourts(); await fetchBookings(); renderSlots();
}
async function onDateChange() {
  S.date=document.getElementById('book-date').value;
  S.slots=[]; S.court=null; S.bookings=[];
  updateDayLabel(); hideCourts(); await fetchBookings(); renderSlots();
}
async function fetchBookings() {
  if (!S.date) return;
  const list=document.getElementById('slots-list');
  const sec=document.getElementById('slots-section');
  sec.style.display='block';
  list.innerHTML='<div style="text-align:center;padding:1rem;color:var(--text-faint);font-size:13px"><i class="ti ti-loader-2 spin"></i> Loading availability…</div>';
  try {
    const d = await callFn('get-bookings', { date: S.date });
    S.bookings=d.bookings||[];
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
    await callFn('book', {
      ref: S.ref, phone: S.mobile, name: S.user.name,
      court: S.court, date: S.date, time_label: fmtRange(S.slots),
      slots: S.slots, match_type: S.matchType, amount: getPrice()
    });
  } catch(e) { console.warn('Booking save failed:', e); }
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-check"></i> Confirm booking';
  document.getElementById('conf-ref').textContent=S.ref;
  document.getElementById('conf-court').textContent='Court '+S.court;
  document.getElementById('conf-date').textContent=fmtDate(S.date);
  document.getElementById('conf-time').textContent=fmtRange(S.slots)+' ('+S.slots.length+' hr)';
  document.getElementById('conf-player').textContent=S.user.name;
  document.getElementById('conf-type').textContent=S.matchType==='singles'?'Singles':'Doubles';
  document.getElementById('conf-price').textContent='Rs. '+getPrice().toLocaleString();
  document.getElementById('upload-area').className='upload-area';
  document.getElementById('upload-icon-el').innerHTML='<i class="ti ti-photo-up"></i>';
  document.getElementById('upload-text-el').innerHTML='<strong>Tap to upload</strong> screenshot or photo<br>of your payment';
  document.getElementById('upload-filename').textContent='';
  document.getElementById('submit-payment-btn').style.display='none';
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
    if (secs<=0) { clearInterval(timerInterval); el.textContent='Expired'; }
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
  btn.disabled=true;
  btn.innerHTML='<i class="ti ti-loader-2 spin"></i> Uploading…';
  try {
    const f = S.paymentReady ? await S.paymentReady : null;
    if (f) {
      await callFn('upload-payment', {
        ref: S.ref, fileData: f.data, fileName: f.name, mimeType: f.type
      });
    }
  } catch(e) { console.warn('Upload failed:',e); }
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
  window.open('https://wa.me/'+NTA_WHATSAPP+'?text='+msg,'_blank');
}

function bookAnother() {
  if (timerInterval) clearInterval(timerInterval);
  S.slots=[]; S.court=null;
  renderChip(); show('screen-booking'); initDate();
}
function logout() {
  if (timerInterval) clearInterval(timerInterval);
  S={mobile:'',user:null,nat:'np',ranked:'no',date:'',slots:[],court:null,ref:'',matchType:'singles'};
  document.getElementById('mobile-input').value='';
  document.getElementById('type-singles').className='toggle-btn selected';
  document.getElementById('type-doubles').className='toggle-btn';
  show('screen-login');
}

// Expose to window so inline HTML onclick handlers can reach these functions
Object.assign(window, {
  checkMobile, doRegister, selNat, selRank, selType,
  onDateChange, toggleSlot, clearCourt, confirmBooking,
  copyRef, handleUpload, submitPayment, sendWhatsapp,
  bookAnother, logout,
});
