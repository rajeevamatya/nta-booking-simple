import JSZip from 'jszip';

const SUPABASE_URL = 'https://njthghjidutnrrkxlfkv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_aPkJCYSzQWtTSeTETA5w8g_ZA1rtk3O';

let accessToken = null;
let userEmail = '';
let allMembers = [];
let allBookings = [];
let proofModalBookingId = null;
let adminProofFile = null;

let refreshInterval = null;
let selectedBookingIds = new Set();

function sbHeaders(extra = {}) {
  return { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...extra };
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
  if (r.status === 401) { handleExpired(); return []; }
  return r.json();
}
async function sbPatch(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method:'PATCH', headers: sbHeaders({'Prefer':'return=minimal'}), body: JSON.stringify(body) });
  if (r.status === 401) { handleExpired(); }
}
async function sbPost(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method:'POST', headers: sbHeaders({'Prefer':'return=minimal'}), body: JSON.stringify(body) });
  if (r.status === 401) { handleExpired(); return false; }
  return r.ok;
}
function genRef() {
  return 'NTA-' + Date.now().toString(36).toUpperCase().slice(-4) + '-' + Math.random().toString(36).slice(2,5).toUpperCase();
}

function handleExpired() {
  if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
  sessionStorage.removeItem('nta_token');
  sessionStorage.removeItem('nta_email');
  accessToken = null; userEmail = '';
  allMembers = []; allBookings = [];
  document.getElementById('main').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  const err = document.getElementById('login-err');
  err.textContent = 'Session expired — please sign in again.';
  err.style.display = 'block';
}

function updatePendingBadge() {
  const count = allBookings.filter(b => b.status === 'Pending Verification').length;
  const badge = document.getElementById('pending-badge');
  if (!badge) return;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'inline' : 'none';
}

function updateUnverifiedBadge() {
  const count = allMembers.filter(m => !m.is_verified).length;
  const badge = document.getElementById('unverified-badge');
  if (!badge) return;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'inline' : 'none';
}

function startAutoRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(async () => {
    try {
      const bookings = await sbGet('bookings?select=*&order=created_at.desc');
      if (Array.isArray(bookings)) {
        allBookings = bookings;
        renderBookings(); updatePendingBadge();
      }
    } catch(e) {}
  }, 60000);
}

async function doLogin() {
  const email = document.getElementById('email-input').value.trim();
  const pw = document.getElementById('pw-input').value;
  const err = document.getElementById('login-err');
  if (!email || !pw) return;
  const btn = document.querySelector('#login-screen .btn-primary');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Signing in…';
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pw }),
    });
    const data = await r.json();
    if (!data.access_token) {
      err.textContent = 'Incorrect email or password.';
      err.style.display = 'block';
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-lock-open"></i> Sign in';
      return;
    }
    accessToken = data.access_token;
    userEmail = data.user?.email || email;
    sessionStorage.setItem('nta_token', accessToken);
    sessionStorage.setItem('nta_email', userEmail);
    document.getElementById('admin-email').textContent = userEmail;
    err.style.display = 'none';
    allMembers = await sbGet('members?select=*&order=registered_at.desc');
    allBookings = await sbGet('bookings?select=*&order=created_at.desc');
    const sd = await sbGet('settings?id=eq.1&select=*');
    allSettings = sd && sd[0] ? sd[0] : {};
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main').style.display = 'block';
    renderMembersStats(); renderMembers(); updateUnverifiedBadge();
    renderBookings(); updatePendingBadge();
    loadSettingsForm(allSettings);
    startAutoRefresh();
  } catch(e) {
    err.textContent = 'Network error — check your connection.';
    err.style.display = 'block';
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-lock-open"></i> Sign in';
}

async function doLogout() {
  if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
  if (accessToken) {
    fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${accessToken}` },
    }).catch(() => {});
  }
  accessToken = null;
  userEmail = '';
  allMembers = []; allBookings = [];
  sessionStorage.removeItem('nta_token');
  sessionStorage.removeItem('nta_email');
  document.getElementById('admin-email').textContent = '';
  document.getElementById('email-input').value = '';
  document.getElementById('pw-input').value = '';
  document.getElementById('login-err').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('main').style.display = 'none';
}

function showTab(tab) {
  ['members','bookings','settings'].forEach(t =>
    document.getElementById('tab-'+t).style.display = t === tab ? 'block' : 'none'
  );
  document.querySelectorAll('.nav-item[data-tab]').forEach(el =>
    el.classList.toggle('active', el.dataset.tab === tab)
  );
}

function renderMembersStats() {
  const total = allMembers.length;
  const verified = allMembers.filter(m => m.is_verified).length;
  const ranked = allMembers.filter(m => m.is_ranked).length;
  document.getElementById('members-stats').innerHTML = `
    <div class="stat"><div class="stat-val">${total}</div><div class="stat-lbl">Total members</div></div>
    <div class="stat"><div class="stat-val">${verified}</div><div class="stat-lbl">Verified</div></div>
    <div class="stat"><div class="stat-val">${ranked}</div><div class="stat-lbl">Ranked players</div></div>`;
}

function renderMembers() {
  const q = document.getElementById('member-search').value.toLowerCase();
  const filtered = allMembers.filter(m => !q || m.name.toLowerCase().includes(q) || m.phone.includes(q));
  const tbody = document.getElementById('members-tbody');
  if (!filtered.length) { tbody.innerHTML = `<tr><td colspan="7" class="empty">No members found.</td></tr>`; return; }
  tbody.innerHTML = filtered.map(m => `
    <tr id="mrow-${m.phone}">
      <td style="font-family:monospace;font-size:12px">${esc(m.phone)}</td>
      <td style="font-weight:500">${esc(m.name)}</td>
      <td>${m.nationality === 'np'
        ? `<span class="badge badge-np"><i class="ti ti-flag" style="font-size:10px"></i> Nepalese</span>`
        : `<span class="badge badge-intl"><i class="ti ti-world" style="font-size:10px"></i> Non-NP</span>`}</td>
      <td>${playerTypeBadge(m)}</td>
      <td>${m.is_verified
        ? `<span class="badge badge-verified"><i class="ti ti-circle-check" style="font-size:10px"></i> Verified</span>`
        : `<span class="badge badge-unverified"><i class="ti ti-circle" style="font-size:10px"></i> Unverified</span>`}</td>
      <td style="color:var(--text-muted);font-size:12px">${fmtDate(m.registered_at)}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        ${m.is_verified
          ? `<button class="action-btn btn-unverify" onclick="toggleVerify('${m.phone}',false)"><i class="ti ti-circle-x"></i> Unverify</button>`
          : `<button class="action-btn btn-verify" onclick="toggleVerify('${m.phone}',true)"><i class="ti ti-circle-check"></i> Verify</button>`}
        <button class="action-btn btn-edit" onclick="editMember('${m.phone}')"><i class="ti ti-pencil"></i> Edit</button>
      </td>
    </tr>`).join('');
}

async function toggleVerify(phone, verified) {
  await sbPatch(`members?phone=eq.${encodeURIComponent(phone)}`, { is_verified: verified });
  const m = allMembers.find(x => x.phone === phone);
  if (m) m.is_verified = verified;
  renderMembersStats(); renderMembers(); updateUnverifiedBadge();
}

function editMember(phone) {
  const m = allMembers.find(x => x.phone === phone);
  if (!m) return;
  const row = document.getElementById(`mrow-${phone}`);
  row.innerHTML = `
    <td style="font-family:monospace;font-size:12px">${esc(m.phone)}</td>
    <td><input class="edit-input" id="edit-name-${phone}" value="${esc(m.name)}" style="width:140px"></td>
    <td>
      <select class="edit-select" id="edit-nat-${phone}">
        <option value="np" ${m.nationality==='np'?'selected':''}>Nepalese</option>
        <option value="intl" ${m.nationality!=='np'?'selected':''}>Non-NP</option>
      </select>
    </td>
    <td>
      <select class="edit-select" id="edit-player-type-${phone}">
        <option value="recreational" ${(m.player_type||'recreational')==='recreational'?'selected':''}>Recreational</option>
        <option value="ranked" ${(m.player_type||'recreational')==='ranked'?'selected':''}>Ranked</option>
        <option value="coach" ${(m.player_type||'recreational')==='coach'?'selected':''}>Coach</option>
      </select>
    </td>
    <td>${m.is_verified
      ? `<span class="badge badge-verified"><i class="ti ti-circle-check" style="font-size:10px"></i> Verified</span>`
      : `<span class="badge badge-unverified">Unverified</span>`}</td>
    <td style="color:var(--text-muted);font-size:12px">${fmtDate(m.registered_at)}</td>
    <td style="display:flex;gap:6px">
      <button class="action-btn btn-save" onclick="saveMember('${phone}')"><i class="ti ti-check"></i> Save</button>
      <button class="action-btn btn-cancel-edit" onclick="renderMembers()"><i class="ti ti-x"></i></button>
    </td>`;
}

async function saveMember(phone) {
  const name = document.getElementById(`edit-name-${phone}`).value.trim();
  const nationality = document.getElementById(`edit-nat-${phone}`).value;
  const player_type = document.getElementById(`edit-player-type-${phone}`).value;
  if (!name) return;
  await sbPatch(`members?phone=eq.${encodeURIComponent(phone)}`, { name, nationality, player_type, is_ranked: player_type === 'ranked' });
  const m = allMembers.find(x => x.phone === phone);
  if (m) { m.name = name; m.nationality = nationality; m.player_type = player_type; m.is_ranked = player_type === 'ranked'; }
  renderMembersStats(); renderMembers();
}

function renderBookingsStats() {
  const list = getFilteredBookings();
  const total      = list.length;
  const pending    = list.filter(b => b.status === 'Awaiting Payment').length;
  const review     = list.filter(b => b.status === 'Pending Verification').length;
  const confirmed  = list.filter(b => b.status === 'Confirmed').length;
  const cancelled  = list.filter(b => b.status === 'Cancelled').length;
  document.getElementById('bookings-stats').innerHTML = `
    <div class="stat"><div class="stat-val">${total}</div><div class="stat-lbl">Total</div></div>
    <div class="stat"><div class="stat-val" style="color:#854d0e">${pending}</div><div class="stat-lbl">Awaiting payment</div></div>
    <div class="stat"><div class="stat-val" style="color:#1e40af">${review}</div><div class="stat-lbl">Pending verification</div></div>
    <div class="stat"><div class="stat-val" style="color:#166534">${confirmed}</div><div class="stat-lbl">Confirmed</div></div>
    <div class="stat"><div class="stat-val" style="color:#6b7280">${cancelled}</div><div class="stat-lbl">Cancelled</div></div>`;
}

function getDateCutoff(days) {
  if (!days || days <= 0) return null;
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getFilteredBookings() {
  const q = (document.getElementById('booking-search')?.value || '').toLowerCase();
  const statusF = document.getElementById('booking-status-filter')?.value || '';
  const dateF = document.getElementById('booking-date-filter')?.value || '';
  const todayStr = new Date().toISOString().split('T')[0];
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  const yesterdayStr = yest.toISOString().split('T')[0];
  const cutoffStr = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; };
  return allBookings.filter(b => {
    if (statusF && b.status !== statusF) return false;
    if (dateF === 'today'     && b.date !== todayStr)     return false;
    if (dateF === 'yesterday' && b.date !== yesterdayStr) return false;
    if (dateF === '7'  && b.date < cutoffStr(7))  return false;
    if (dateF === '30' && b.date < cutoffStr(30)) return false;
    if (q && !b.ref.toLowerCase().includes(q) && !b.name.toLowerCase().includes(q) && !(b.phone||'').includes(q)) return false;
    return true;
  });
}

function renderBookings() {
  renderBookingsStats();
  const filtered = getFilteredBookings();
  const tbody = document.getElementById('bookings-tbody');
  if (!filtered.length) { tbody.innerHTML = `<tr><td colspan="9" class="empty">No bookings found.</td></tr>`; return; }
  const now = Date.now();
  tbody.innerHTML = filtered.map(b => {
    const hasProof = !!b.proof_url;
    const canConfirm = b.status === 'Pending Verification' || b.status === 'Awaiting Payment';
    const canCancel  = b.status !== 'Cancelled' && b.status !== 'Confirmed';
    const isOverdue  = b.status === 'Awaiting Payment' && b.created_at && (now - new Date(b.created_at).getTime()) > 10 * 60 * 1000;
    let actions = '';
    if (canConfirm) actions += `<button class="action-btn btn-paid" onclick="updateBooking('${b.id}','Confirmed')" style="padding:4px 9px;font-size:11px">Confirm</button>`;
    if (b.status === 'Confirmed') actions += `<button class="action-btn btn-unverify" onclick="updateBooking('${b.id}','Pending Verification')" style="padding:4px 9px;font-size:11px">Undo</button>`;
    if (canCancel) actions += `<button class="action-btn btn-cancel" onclick="updateBooking('${b.id}','Cancelled')" style="padding:4px 9px;font-size:11px">Cancel</button>`;
    if (hasProof) actions += `<button class="action-btn" onclick="openProofModal('${b.id}')" style="padding:4px 9px;font-size:11px;color:var(--text-muted);border-color:var(--border)"><i class="ti ti-photo" style="font-size:11px;vertical-align:-1px"></i> View proof</button>`;
    else if (b.status === 'Awaiting Payment') actions += `<button class="action-btn" onclick="openProofModal('${b.id}')" style="padding:4px 9px;font-size:11px;color:var(--text-muted);border-color:var(--border)"><i class="ti ti-upload" style="font-size:11px;vertical-align:-1px"></i> Upload proof</button>`;
    return `
    <tr${b.status === 'Pending Verification' ? ' class="needs-action"' : ''}>
      <td style="padding-right:0"><input type="checkbox" class="bulk-cb" data-id="${b.id}" ${selectedBookingIds.has(b.id) ? 'checked' : ''} onchange="toggleBookingSelect('${b.id}',this.checked)"></td>
      <td style="font-family:monospace;font-size:12px;font-weight:500">${esc(b.ref)}</td>
      <td>${esc(b.name)}<br><span style="font-size:11px;color:var(--text-muted)">${esc(b.phone)}</span></td>
      <td style="text-align:center;font-weight:600">Court ${b.court}</td>
      <td style="font-size:12px;white-space:nowrap">${fmtDateShort(b.date)}<br><span style="color:var(--text-muted)">${esc(b.time_label)}</span></td>
      <td><span style="font-size:12px;text-transform:capitalize">${esc(b.match_type)}</span></td>
      <td style="font-weight:500">Rs. ${b.amount.toLocaleString()}</td>
      <td>${statusBadge(b.status, isOverdue)}</td>
      <td><div style="display:flex;gap:5px;flex-wrap:wrap">${actions}</div></td>
    </tr>`;
  }).join('');
  updateBulkBar();
}

function updateBulkBar() {
  const bar = document.getElementById('bulk-bar');
  const count = selectedBookingIds.size;
  if (bar) bar.style.display = count > 0 ? 'flex' : 'none';
  const countEl = document.getElementById('bulk-count');
  if (countEl) countEl.textContent = `${count} booking${count !== 1 ? 's' : ''} selected`;
  const allCb = document.getElementById('bulk-select-all');
  if (!allCb) return;
  const visibleIds = getFilteredBookings().map(b => b.id);
  const selectedVisible = visibleIds.filter(id => selectedBookingIds.has(id));
  allCb.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
  allCb.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
}

function toggleBookingSelect(id, checked) {
  if (checked) selectedBookingIds.add(id);
  else selectedBookingIds.delete(id);
  updateBulkBar();
}

function toggleSelectAll(checked) {
  getFilteredBookings().forEach(b => {
    if (checked) selectedBookingIds.add(b.id);
    else selectedBookingIds.delete(b.id);
  });
  renderBookings();
}

function clearBulkSelection() {
  selectedBookingIds.clear();
  renderBookings();
}

async function bulkAction(status) {
  if (!selectedBookingIds.size) return;
  const ids = [...selectedBookingIds];
  await Promise.all(ids.map(id => sbPatch(`bookings?id=eq.${id}`, { status })));
  ids.forEach(id => {
    const b = allBookings.find(x => x.id === id);
    if (b) b.status = status;
  });
  selectedBookingIds.clear();
  renderBookings();
  updatePendingBadge();
}

async function updateBooking(id, status) {
  await sbPatch(`bookings?id=eq.${id}`, { status });
  const b = allBookings.find(x => x.id === id);
  if (b) b.status = status;
  renderBookings();
}

function openProofModal(id) {
  const b = allBookings.find(x => x.id === id);
  if (!b) return;
  proofModalBookingId = id;
  document.getElementById('proof-modal-title').textContent = b.ref;
  document.getElementById('proof-modal-sub').textContent =
    `${b.name} · ${fmtDateShort(b.date)} · Rs. ${b.amount.toLocaleString()}`;
  document.getElementById('proof-modal-status').innerHTML = statusBadge(b.status);
  const img = document.getElementById('proof-modal-img');
  const noProof = document.getElementById('proof-modal-no-proof');
  if (b.proof_url) {
    img.src = b.proof_url;
    img.style.display = 'block';
    noProof.style.display = 'none';
  } else {
    img.src = '';
    img.style.display = 'none';
    noProof.style.display = 'block';
  }
  const payBtn           = document.getElementById('proof-modal-pay-btn');
  const cancelBtn        = document.getElementById('proof-modal-cancel-btn');
  const unpayBtn         = document.getElementById('proof-modal-unpay-btn');
  const uploadSection    = document.getElementById('proof-modal-upload-section');
  const uploadConfirmBtn = document.getElementById('proof-modal-upload-confirm-btn');
  const isAwaiting = b.status === 'Awaiting Payment';
  payBtn.style.display           = b.status === 'Pending Verification' ? 'inline-flex' : 'none';
  unpayBtn.style.display         = b.status === 'Confirmed' ? 'inline-flex' : 'none';
  cancelBtn.style.display        = (b.status !== 'Cancelled' && b.status !== 'Confirmed') ? 'inline-flex' : 'none';
  uploadSection.style.display    = isAwaiting ? 'block' : 'none';
  uploadConfirmBtn.style.display = 'none';
  document.getElementById('proof-modal-upload-icon').style.color = 'var(--text-faint)';
  document.getElementById('proof-modal-upload-text').innerHTML = '<strong>Click to select</strong> payment screenshot';
  document.getElementById('proof-modal-upload-filename').textContent = '';
  document.getElementById('proof-modal-upload-err').style.display = 'none';
  document.getElementById('proof-modal-file-input').value = '';
  adminProofFile = null;
  document.getElementById('proof-modal').classList.add('open');
}

function closeProofModal() {
  document.getElementById('proof-modal').classList.remove('open');
  proofModalBookingId = null;
  adminProofFile = null;
}

async function updateBookingFromModal(status) {
  if (!proofModalBookingId) return;
  const id = proofModalBookingId;
  closeProofModal();
  await updateBooking(id, status);
}

function handleAdminProofSelect(input) {
  if (!input.files.length) return;
  const file = input.files[0];
  adminProofFile = file;
  document.getElementById('proof-modal-upload-icon').style.color = 'var(--green)';
  document.getElementById('proof-modal-upload-text').innerHTML = `<strong style="color:var(--green)">File selected</strong>`;
  document.getElementById('proof-modal-upload-filename').textContent = file.name;
  document.getElementById('proof-modal-upload-err').style.display = 'none';
  document.getElementById('proof-modal-upload-confirm-btn').style.display = 'inline-flex';
}

async function adminUploadAndConfirm() {
  if (!proofModalBookingId || !adminProofFile) return;
  const id = proofModalBookingId;
  const b = allBookings.find(x => x.id === id);
  if (!b) return;
  const btn = document.getElementById('proof-modal-upload-confirm-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Uploading…';
  document.getElementById('proof-modal-upload-err').style.display = 'none';
  try {
    const file = adminProofFile;
    const path = `${b.ref}.jpg`;
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/payment-proofs/${path}`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${accessToken}`, 'Content-Type': file.type, 'x-upsert': 'true' },
      body: file,
    });
    if (!up.ok) throw new Error('Upload failed ' + up.status);
    const proofUrl = `${SUPABASE_URL}/storage/v1/object/public/payment-proofs/${b.ref}.jpg`;
    await sbPatch(`bookings?id=eq.${id}`, { status: 'Confirmed', proof_url: proofUrl });
    const local = allBookings.find(x => x.id === id);
    if (local) { local.status = 'Confirmed'; local.proof_url = proofUrl; }
    closeProofModal();
    renderBookings(); updatePendingBadge();
  } catch(e) {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-upload"></i> Upload &amp; confirm';
    document.getElementById('proof-modal-upload-err').style.display = 'block';
  }
}

function showExportModal() {
  const opts = [
    { label: 'Last 30 days', days: 30 },
    { label: 'Last 90 days', days: 90 },
    { label: 'Export all',   days: 0  },
  ];
  const body = document.getElementById('export-modal-body');
  const proofCounts = opts.map(o => {
    const cutoff = getDateCutoff(o.days);
    const list = cutoff
      ? allBookings.filter(b => b.created_at && new Date(b.created_at) >= cutoff)
      : allBookings;
    return { total: list.length, proofs: list.filter(b => b.proof_url).length };
  });
  body.innerHTML = `
    <label style="display:flex;align-items:center;gap:9px;font-size:13px;cursor:pointer;padding:.7rem 1rem;background:var(--surface2);border-radius:var(--radius-sm);border:1px solid var(--border);margin-bottom:14px">
      <input type="checkbox" id="export-include-proofs" style="width:15px;height:15px;accent-color:var(--green);cursor:pointer">
      Also download payment proofs (ZIP)
    </label>
    ${opts.map((o, i) => `<button class="export-opt" onclick="doExport(${o.days})">
      <span>${o.label}</span>
      <span class="export-opt-count">${proofCounts[i].total} booking${proofCounts[i].total !== 1 ? 's' : ''} · ${proofCounts[i].proofs} with proof</span>
    </button>`).join('')}`;
  document.getElementById('export-modal').classList.add('open');
}

function closeExportModal() {
  document.getElementById('export-modal').classList.remove('open');
}

function openAddMemberModal() {
  ['am-phone','am-name'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('am-nationality').value = 'np';
  document.getElementById('am-player-type').value = 'recreational';
  document.getElementById('am-verified').checked = false;
  document.getElementById('am-error').style.display = 'none';
  document.getElementById('add-member-modal').classList.add('open');
  document.getElementById('am-phone').focus();
}
function closeAddMemberModal() {
  document.getElementById('add-member-modal').classList.remove('open');
}
async function submitAddMember() {
  const phone = normalizePhone(document.getElementById('am-phone').value.trim());
  const name  = document.getElementById('am-name').value.trim();
  const err   = document.getElementById('am-error');
  if (!phone || !name) { err.textContent = 'Phone and name are required.'; err.style.display='block'; return; }
  const btn = document.getElementById('am-submit-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const player_type = document.getElementById('am-player-type').value;
  const ok = await sbPost('members', {
    phone, name,
    nationality: document.getElementById('am-nationality').value,
    player_type,
    is_ranked:   player_type === 'ranked',
    is_verified: document.getElementById('am-verified').checked,
  });
  btn.disabled = false; btn.innerHTML = '<i class="ti ti-check"></i> Add Member';
  if (ok) {
    closeAddMemberModal();
    allMembers = await sbGet('members?select=*&order=registered_at.desc');
    renderMembers(); updateUnverifiedBadge();
  } else {
    err.textContent = 'Failed to save. Phone may already exist.'; err.style.display = 'block';
  }
}

function openAddBookingModal() {
  ['ab-name','ab-phone'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('ab-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('ab-court').value = '1';
  document.getElementById('ab-type').value = 'singles';
  document.getElementById('ab-status').value = 'Awaiting Payment';
  document.getElementById('ab-error').style.display = 'none';
  const from = allSettings.open_from ?? 6;
  const to   = allSettings.open_to   ?? 19;
  const sel  = document.getElementById('ab-start');
  sel.innerHTML = '';
  for (let h = from; h < to; h++) {
    const o = document.createElement('option'); o.value = h; o.textContent = fmtHour(h); sel.appendChild(o);
  }
  abUpdateAmount();
  document.getElementById('add-booking-modal').classList.add('open');
  document.getElementById('ab-name').focus();
}
function closeAddBookingModal() {
  document.getElementById('add-booking-modal').classList.remove('open');
}
function abUpdateAmount() {
  const type = document.getElementById('ab-type').value;
  const price = type === 'singles' ? (allSettings.price_singles ?? 400) : (allSettings.price_doubles ?? 600);
  const dur = parseInt(document.getElementById('ab-duration')?.value || '1');
  document.getElementById('ab-amount').value = price * dur;
}
async function submitAddBooking() {
  const name  = document.getElementById('ab-name').value.trim();
  const phone = normalizePhone(document.getElementById('ab-phone').value.trim());
  const date  = document.getElementById('ab-date').value;
  const err   = document.getElementById('ab-error');
  if (!name || !phone || !date) { err.textContent = 'Name, phone and date are required.'; err.style.display='block'; return; }
  const startH = parseInt(document.getElementById('ab-start').value);
  const dur    = parseInt(document.getElementById('ab-duration').value);
  const slots  = Array.from({length: dur}, (_, i) => startH + i);
  const endH   = startH + dur;
  const timeLabel = `${fmtHour(startH)} – ${fmtHour(endH)}`;
  const btn = document.getElementById('ab-submit-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const ok = await sbPost('bookings', {
    ref:        genRef(),
    name, phone,
    court:      parseInt(document.getElementById('ab-court').value),
    date,
    time_label: timeLabel,
    slots,
    match_type: document.getElementById('ab-type').value,
    amount:     parseInt(document.getElementById('ab-amount').value),
    status:     document.getElementById('ab-status').value,
  });
  btn.disabled = false; btn.innerHTML = '<i class="ti ti-check"></i> Add Booking';
  if (ok) {
    closeAddBookingModal();
    allBookings = await sbGet('bookings?select=*&order=created_at.desc');
    renderBookings(); updatePendingBadge();
  } else {
    err.textContent = 'Failed to save. Please try again.'; err.style.display = 'block';
  }
}

async function doExport(days) {
  const includeProofs = document.getElementById('export-include-proofs')?.checked;
  closeExportModal();
  const cutoff = getDateCutoff(days);
  const filtered = cutoff
    ? allBookings.filter(b => b.created_at && new Date(b.created_at) >= cutoff)
    : allBookings;
  const csv = 'Ref,Name,Phone,Court,Date,Time,Match,Amount,Status,Created,ProofURL\n' +
    filtered.map(b => [b.ref, b.name, b.phone, b.court, b.date, b.time_label, b.match_type,
      b.amount, b.status, b.created_at||'', b.proof_url||''].map(csvCell).join(',')).join('\n');
  const label = days > 0 ? `last-${days}days` : 'all';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `bookings-${label}.csv`; a.click();
  URL.revokeObjectURL(url);
  if (includeProofs) await downloadProofsZip(filtered, label);
}

async function downloadProofsZip(bookings, label) {
  const withProof = bookings.filter(b => b.proof_url);
  if (!withProof.length) return;
  const zip = new JSZip();
  await Promise.all(withProof.map(async b => {
    try {
      const res = await fetch(b.proof_url);
      if (!res.ok) return;
      const blob = await res.blob();
      const ext = (b.proof_url.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
      zip.file(`${b.ref}.${ext}`, blob);
    } catch(e) {}
  }));
  const content = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url; a.download = `payment-proofs-${label}.zip`; a.click();
  URL.revokeObjectURL(url);
}

function aiCheckCell(b) {
  const d = b.ai_check_details;
  if (!d) return '<span style="font-size:11px;color:var(--text-faint)">—</span>';

  const row = (ok, soft, label, detail) =>
    `<tr><td style="padding:2px 6px 2px 0;font-weight:600;${ok ? 'color:#16a34a' : soft ? 'color:#92400e' : 'color:#b91c1c'}">${ok ? '✓' : soft ? '~' : '✗'}</td><td style="padding:2px 0;white-space:nowrap"><strong>${label}:</strong> ${esc(String(detail))}</td></tr>`;

  const tooltip = [
    row(d.amount?.ok,   false, 'Amount',   `Rs.${d.amount?.extracted ?? '?'} (expected Rs.${d.amount?.expected ?? '?'})`),
    row(d.date?.ok,     false, 'Date',     `${d.date?.extracted ?? '?'} (booked ${d.date?.bookingCreated ?? '?'})`),
    row(d.receiver?.ok, true,  'Receiver', d.receiver?.extracted ?? '?'),
    row(d.sender?.ok,   true,  'Sender',   `${d.sender?.extracted ?? '?'}`),
  ].join('');

  const pass = b.ai_checked;
  const icon = pass ? '✓' : '✗';
  const color = pass ? '#16a34a' : '#b91c1c';
  const bg    = pass ? '#dcfce7' : '#fee2e2';

  return `<span class="ai-check-cell" style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-size:13px;font-weight:700;color:${color};background:${bg};cursor:default;position:relative" data-ai-tooltip="${encodeURIComponent('<table style=\'font-size:12px;border-collapse:collapse\'>' + tooltip + '</table>')}">${icon}</span>`;
}

function playerTypeBadge(m) {
  const t = m.player_type || (m.is_ranked ? 'ranked' : 'recreational');
  if (t === 'ranked') return `<span class="badge badge-ranked"><i class="ti ti-medal" style="font-size:10px"></i> Ranked</span>`;
  if (t === 'coach')  return `<span class="badge badge-coach"><i class="ti ti-whistle" style="font-size:10px"></i> Coach</span>`;
  return `<span style="color:var(--text-faint);font-size:12px">Recreational</span>`;
}

function statusBadge(s, overdue = false) {
  const map = {
    'Awaiting Payment':    overdue ? 'badge-overdue' : 'badge-pending',
    'Pending Verification':'badge-submitted',
    'Confirmed':           'badge-paid',
    'Cancelled':           'badge-cancelled',
  };
  return `<span class="badge ${map[s]||''}">${esc(s)}</span>`;
}

function exportCSV(type) {
  if (type !== 'members') return;
  const csv = 'Phone,Name,Nationality,Ranked,Verified,Registered\n' +
    allMembers.map(m => [m.phone, m.name, m.nationality, m.is_ranked, m.is_verified, m.registered_at].map(csvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'members.csv'; a.click();
  URL.revokeObjectURL(url);
}

let allSettings = {};

function fmtHour(h) {
  if (h === 0) return '12:00 AM';
  if (h === 12) return '12:00 PM';
  return h < 12 ? `${h}:00 AM` : `${h-12}:00 PM`;
}

function populateHourSelects() {
  ['s-open-from','s-open-to','s-night-starts'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel || sel.options.length > 0) return;
    for (let h = 5; h <= 22; h++) {
      const o = document.createElement('option');
      o.value = h; o.textContent = fmtHour(h);
      sel.appendChild(o);
    }
  });
}

function loadSettingsForm(s) {
  populateHourSelects();
  document.getElementById('s-closure-from').value = s.closure_from || '';
  document.getElementById('s-closure-to').value = s.closure_to || '';
  document.getElementById('s-closure-message').value = s.closure_message || '';
  document.getElementById('s-open-from').value = s.open_from ?? 6;
  document.getElementById('s-open-to').value = s.open_to ?? 19;
  document.getElementById('s-price-singles').value = s.price_singles ?? 400;
  document.getElementById('s-price-doubles').value = s.price_doubles ?? 600;
  document.getElementById('s-discount-ranked').value = s.discount_ranked ?? 25;
  document.getElementById('s-discount-coach').value  = s.discount_coach  ?? 25;
  document.getElementById('s-night-premium').value   = s.night_premium   ?? 25;
  document.getElementById('s-night-starts').value    = s.night_starts    ?? 18;
  document.getElementById('s-whatsapp').value = s.whatsapp || '';
  if (s.qr_url) {
    document.getElementById('s-qr-preview').src = s.qr_url;
    document.getElementById('s-qr-preview-wrap').style.display = 'block';
  }
  updateClosureStatusIndicator(s);
}

function updateClosureStatusIndicator(s) {
  const el = document.getElementById('s-closure-status');
  if (!el) return;
  if (!s.closure_from) {
    el.innerHTML = '<i class="ti ti-circle-off" style="font-size:13px"></i> No closure set';
    el.style.color = 'var(--text-faint)';
    return;
  }
  const today = new Date().toISOString().split('T')[0];
  const active = s.closure_from <= today && (!s.closure_to || s.closure_to >= today);
  const future = s.closure_from > today;
  if (active) {
    const until = s.closure_to ? ` until ${s.closure_to}` : ' (indefinite)';
    el.innerHTML = `<i class="ti ti-alert-circle" style="font-size:13px"></i> Active — banner showing${until}`;
    el.style.color = '#d97706';
  } else if (future) {
    el.innerHTML = `<i class="ti ti-clock" style="font-size:13px"></i> Scheduled from ${s.closure_from}`;
    el.style.color = 'var(--text-muted)';
  } else {
    el.innerHTML = `<i class="ti ti-circle-check" style="font-size:13px"></i> Past closure — no banner showing`;
    el.style.color = 'var(--text-faint)';
  }
}

async function saveSettings(type, evt) {
  const btn = evt.target.closest('button');
  const orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Saving…';
  let patch = {};
  if (type === 'closure') {
    patch = {
      closure_from: document.getElementById('s-closure-from').value || null,
      closure_to:   document.getElementById('s-closure-to').value || null,
      closure_message: document.getElementById('s-closure-message').value.trim() || null,
    };
  } else if (type === 'hours') {
    patch = {
      open_from: parseInt(document.getElementById('s-open-from').value),
      open_to:   parseInt(document.getElementById('s-open-to').value),
    };
  } else if (type === 'pricing') {
    patch = {
      price_singles: parseInt(document.getElementById('s-price-singles').value),
      price_doubles: parseInt(document.getElementById('s-price-doubles').value),
      night_premium: parseInt(document.getElementById('s-night-premium').value) || 0,
      night_starts:  parseInt(document.getElementById('s-night-starts').value)  || 18,
    };
  } else if (type === 'discount') {
    patch = {
      discount_ranked: parseInt(document.getElementById('s-discount-ranked').value) || 0,
      discount_coach:  parseInt(document.getElementById('s-discount-coach').value)  || 0,
    };
  } else if (type === 'contact') {
    patch = { whatsapp: document.getElementById('s-whatsapp').value.trim() };
  }
  await sbPatch('settings?id=eq.1', patch);
  Object.assign(allSettings, patch);
  if (type === 'closure') updateClosureStatusIndicator(allSettings);
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-circle-check" style="color:var(--green)"></i> Saved';
  setTimeout(() => { btn.innerHTML = orig; }, 2000);
}

async function uploadQR(input) {
  if (!input.files.length) return;
  const file = input.files[0];
  const status = document.getElementById('s-qr-status');
  status.innerHTML = '<i class="ti ti-loader-2 spin"></i> Uploading…';
  const path = 'settings/qr.jpg';
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/payment-proofs/${path}`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
    body: file,
  });
  if (up.ok) {
    const qrUrl = `${SUPABASE_URL}/storage/v1/object/public/payment-proofs/${path}?t=${Date.now()}`;
    await sbPatch('settings?id=eq.1', { qr_url: qrUrl });
    allSettings.qr_url = qrUrl;
    document.getElementById('s-qr-preview').src = qrUrl;
    document.getElementById('s-qr-preview-wrap').style.display = 'block';
    status.textContent = 'Uploaded!';
  } else {
    const err = await up.json().catch(() => ({}));
    status.textContent = `Upload failed: ${err.message || up.status}`;
  }
  setTimeout(() => { status.textContent = ''; input.value = ''; }, 4000);
}

async function init() {
  const saved = sessionStorage.getItem('nta_token');
  if (!saved) return;
  accessToken = saved;
  userEmail = sessionStorage.getItem('nta_email') || '';
  try {
    const [members, bookings] = await Promise.all([
      sbGet('members?select=*&order=registered_at.desc'),
      sbGet('bookings?select=*&order=created_at.desc'),
    ]);
    if (!Array.isArray(members) || !Array.isArray(bookings)) {
      sessionStorage.removeItem('nta_token');
      sessionStorage.removeItem('nta_email');
      return;
    }
    allMembers = members;
    allBookings = bookings;
    const sd = await sbGet('settings?id=eq.1&select=*');
    allSettings = sd && sd[0] ? sd[0] : {};
    document.getElementById('admin-email').textContent = userEmail;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main').style.display = 'block';
    renderMembersStats(); renderMembers(); updateUnverifiedBadge();
    renderBookings(); updatePendingBadge();
    loadSettingsForm(allSettings);
    startAutoRefresh();
  } catch(e) {
    sessionStorage.removeItem('nta_token');
    sessionStorage.removeItem('nta_email');
  }
}

init();

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function csvCell(v) { const s = String(v??''); return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g,'""')}"` : s; }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : ''; }
function fmtDateShort(d) { return d ? new Date(d+'T00:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}) : ''; }

(function() {
  const tip = document.createElement('div');
  tip.id = 'ai-tooltip';
  document.body.appendChild(tip);

  document.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-ai-tooltip]');
    if (!el) return;
    tip.innerHTML = decodeURIComponent(el.dataset.aiTooltip);
    tip.style.display = 'block';
  });
  document.addEventListener('mousemove', e => {
    if (tip.style.display === 'none') return;
    const x = e.clientX + 12, y = e.clientY + 12;
    tip.style.left = (x + tip.offsetWidth > window.innerWidth ? e.clientX - tip.offsetWidth - 8 : x) + 'px';
    tip.style.top  = (y + tip.offsetHeight > window.innerHeight ? e.clientY - tip.offsetHeight - 8 : y) + 'px';
  });
  document.addEventListener('mouseout', e => {
    if (!e.target.closest('[data-ai-tooltip]')) return;
    tip.style.display = 'none';
  });
})();

Object.assign(window, {
  doLogin, doLogout, showTab, renderMembers, renderBookings,
  exportCSV, openAddMemberModal, closeAddMemberModal, submitAddMember,
  openAddBookingModal, closeAddBookingModal, abUpdateAmount, submitAddBooking,
  showExportModal, closeExportModal, doExport,
  toggleVerify, editMember, saveMember,
  updateBooking, toggleBookingSelect, toggleSelectAll, clearBulkSelection, bulkAction,
  openProofModal, closeProofModal,
  updateBookingFromModal, handleAdminProofSelect, adminUploadAndConfirm,
  saveSettings, uploadQR,
});
