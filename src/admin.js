const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let adminPw = '';
let allMembers = [];
let allBookings = [];

async function adminCall(action, params = {}) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/admin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'x-admin-password': adminPw,
    },
    body: JSON.stringify({ action, ...params }),
  });
  return r.json();
}

async function doLogin() {
  const pw = document.getElementById('pw-input').value;
  if (!pw) return;
  const btn = document.querySelector('#login-screen .btn-primary');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Signing in…';
  adminPw = pw;
  const res = await adminCall('getMembers').catch(() => ({ error: 'Network error' }));
  if (res.error === 'Unauthorized' || res.error === 'Network error') {
    document.getElementById('login-err').style.display = 'block';
    document.getElementById('login-err').textContent = res.error === 'Network error'
      ? 'Network error — check your connection.' : 'Incorrect password.';
    adminPw = '';
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-lock-open"></i> Sign in';
    return;
  }
  allMembers = res.members || [];
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('main').style.display = 'block';
  renderMembersStats();
  renderMembers();
  adminCall('getBookings').then(res => {
    allBookings = res.bookings || [];
    renderBookingsStats();
    renderBookings();
  });
}

function doLogout() {
  adminPw = '';
  allMembers = [];
  allBookings = [];
  document.getElementById('pw-input').value = '';
  document.getElementById('login-err').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('main').style.display = 'none';
}

function showTab(tab) {
  document.getElementById('tab-members').style.display = tab === 'members' ? 'block' : 'none';
  document.getElementById('tab-bookings').style.display = tab === 'bookings' ? 'block' : 'none';
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', (i === 0) === (tab === 'members')));
  if (tab === 'bookings' && !allBookings.length) {
    adminCall('getBookings').then(res => { allBookings = res.bookings || []; renderBookingsStats(); renderBookings(); });
  }
}

// ── MEMBERS ──────────────────────────────────────────────────────────────────

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
  const filtered = allMembers.filter(m =>
    !q || m.name.toLowerCase().includes(q) || m.phone.includes(q)
  );
  const tbody = document.getElementById('members-tbody');
  if (!filtered.length) { tbody.innerHTML = `<tr><td colspan="7" class="empty">No members found.</td></tr>`; return; }
  tbody.innerHTML = filtered.map(m => `
    <tr id="mrow-${m.phone}">
      <td style="font-family:monospace;font-size:12px">${esc(m.phone)}</td>
      <td style="font-weight:500">${esc(m.name)}</td>
      <td>${m.nationality === 'np'
        ? `<span class="badge badge-np"><i class="ti ti-flag" style="font-size:10px"></i> Nepalese</span>`
        : `<span class="badge badge-intl"><i class="ti ti-world" style="font-size:10px"></i> Non-NP</span>`}</td>
      <td>${m.is_ranked
        ? `<span class="badge badge-ranked"><i class="ti ti-medal" style="font-size:10px"></i> Ranked</span>`
        : `<span style="color:var(--text-faint);font-size:12px">Recreational</span>`}</td>
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
  await adminCall('updateMember', { phone, is_verified: verified });
  const m = allMembers.find(x => x.phone === phone);
  if (m) m.is_verified = verified;
  renderMembersStats();
  renderMembers();
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
      <select class="edit-select" id="edit-ranked-${phone}">
        <option value="false" ${!m.is_ranked?'selected':''}>Recreational</option>
        <option value="true" ${m.is_ranked?'selected':''}>Ranked</option>
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
  const nat = document.getElementById(`edit-nat-${phone}`).value;
  const ranked = document.getElementById(`edit-ranked-${phone}`).value === 'true';
  if (!name) return;
  await adminCall('updateMember', { phone, name, nationality: nat, is_ranked: ranked });
  const m = allMembers.find(x => x.phone === phone);
  if (m) { m.name = name; m.nationality = nat; m.is_ranked = ranked; }
  renderMembersStats();
  renderMembers();
}

// ── BOOKINGS ──────────────────────────────────────────────────────────────────

function renderBookingsStats() {
  const total = allBookings.length;
  const submitted = allBookings.filter(b => b.status === 'Payment Submitted').length;
  const paid = allBookings.filter(b => b.status === 'Paid').length;
  const pending = allBookings.filter(b => b.status === 'Pending Payment').length;
  document.getElementById('bookings-stats').innerHTML = `
    <div class="stat"><div class="stat-val">${total}</div><div class="stat-lbl">Total bookings</div></div>
    <div class="stat"><div class="stat-val" style="color:#1e40af">${submitted}</div><div class="stat-lbl">Awaiting review</div></div>
    <div class="stat"><div class="stat-val" style="color:#166534">${paid}</div><div class="stat-lbl">Paid & confirmed</div></div>
    <div class="stat"><div class="stat-val" style="color:#854d0e">${pending}</div><div class="stat-lbl">Pending payment</div></div>`;
}

function renderBookings() {
  const q = (document.getElementById('booking-search')?.value || '').toLowerCase();
  const statusF = document.getElementById('booking-status-filter')?.value || '';
  const dateF = document.getElementById('booking-date-filter')?.value || '';
  const filtered = allBookings.filter(b => {
    if (statusF && b.status !== statusF) return false;
    if (dateF && b.date !== dateF) return false;
    if (q && !b.ref.toLowerCase().includes(q) && !b.name.toLowerCase().includes(q)) return false;
    return true;
  });
  const tbody = document.getElementById('bookings-tbody');
  if (!filtered.length) { tbody.innerHTML = `<tr><td colspan="9" class="empty">No bookings found.</td></tr>`; return; }
  tbody.innerHTML = filtered.map(b => `
    <tr>
      <td style="font-family:monospace;font-size:12px;font-weight:500">${esc(b.ref)}</td>
      <td>${esc(b.name)}<br><span style="font-size:11px;color:var(--text-muted)">${esc(b.phone)}</span></td>
      <td style="text-align:center;font-weight:600">Court ${b.court}</td>
      <td style="font-size:12px">${fmtDateShort(b.date)}</td>
      <td style="font-size:12px">${esc(b.time_label)}</td>
      <td><span style="font-size:12px;text-transform:capitalize">${esc(b.match_type)}</span></td>
      <td style="font-weight:500">Rs. ${b.amount.toLocaleString()}</td>
      <td>${statusBadge(b.status)}</td>
      <td style="display:flex;gap:5px;flex-wrap:wrap">
        ${b.proof_url ? `<a href="${b.proof_url}" target="_blank" class="action-btn btn-proof"><i class="ti ti-photo"></i> Proof</a>` : ''}
        ${b.status === 'Payment Submitted' ? `<button class="action-btn btn-paid" onclick="updateBooking('${b.id}','Paid')"><i class="ti ti-check"></i> Mark paid</button>` : ''}
        ${b.status !== 'Cancelled' && b.status !== 'Paid' ? `<button class="action-btn btn-cancel" onclick="updateBooking('${b.id}','Cancelled')"><i class="ti ti-x"></i> Cancel</button>` : ''}
      </td>
    </tr>`).join('');
}

async function updateBooking(id, status) {
  await adminCall('updateBooking', { id, status });
  const b = allBookings.find(x => x.id === id);
  if (b) b.status = status;
  renderBookingsStats();
  renderBookings();
}

function statusBadge(s) {
  const map = {
    'Pending Payment': 'badge-pending',
    'Payment Submitted': 'badge-submitted',
    'Paid': 'badge-paid',
    'Cancelled': 'badge-cancelled',
  };
  return `<span class="badge ${map[s] || ''}">${esc(s)}</span>`;
}

// ── CSV EXPORT ────────────────────────────────────────────────────────────────

async function exportCSV(type) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/admin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'x-admin-password': adminPw,
    },
    body: JSON.stringify({ action: 'exportCSV', type }),
  });
  const csv = await r.text();
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${type}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : ''; }
function fmtDateShort(d) { return d ? new Date(d+'T00:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}) : ''; }

// Expose to window for inline HTML onclick handlers
Object.assign(window, {
  doLogin, doLogout, showTab,
  toggleVerify, editMember, saveMember, renderMembers,
  updateBooking, exportCSV,
});
