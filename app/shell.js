// ChildTube — khung giao diện bản 2: 4 tab (Hôm nay · Học · Kỷ niệm · Gia đình), chọn bé ở trên cùng, chuông "Cần bạn".
// Các màn hình cũ (duyệt video, kênh, lịch sử, thư viện, tìm, cài đặt) vẫn dùng được như trang con có nút quay lại.

const V = { child: null, back: 'today', counts: null };
const MAIN = ['today', 'learn', 'feed', 'family'];
const SUB_OF = { review: 'today', history: 'today', list: 'learn', groups: 'learn', search: 'learn', settings: 'family' };
const SUB_TITLE = { review: 'Cần bạn', history: 'Lịch sử xem', list: 'Kênh & video', groups: 'Thư viện', search: 'Tìm trên YouTube', settings: 'Cài đặt' };
const ROLE_ICON = { owner: '👩', parent: '👨', relative: '👵', teacher: '🧑‍🏫', child: '🧒' };

function kids() { return (S && S.children) || []; }
function curKid() {
  const ks = kids();
  if (V.child === 'all' && ks.length > 1) return null;
  if (!V.child || (V.child !== 'all' && !ks.some((k) => k.id === V.child))) {
    let saved = null; try { saved = localStorage.getItem('ct-child'); } catch (e) { /* bỏ qua */ }
    V.child = saved && (saved === 'all' || ks.some((k) => k.id === saved)) ? saved : ks[0] ? ks[0].id : 'all';
  }
  return V.child === 'all' ? null : ks.find((k) => k.id === V.child) || null;
}
const kidAge = (k) => (k && k.birth ? ageOf(k.birth) : '');
function setKid(id) { V.child = id; try { localStorage.setItem('ct-child', id); } catch (e) { /* bỏ qua */ } render(); }

// Thanh chọn bé + chuông
function kidbarHtml() {
  const ks = kids(), k = curKid();
  const n = V.counts == null ? (typeof pendTotal === 'function' ? pendTotal() : 0) : V.counts;
  const av = (id, emoji, label, on) => `<button class="kb-kid ${on ? 'on' : ''}" data-a="V-kid" data-id="${id}"><span class="kb-av">${esc(emoji)}</span><span class="kb-n">${esc(label)}</span></button>`;
  return `<div class="kb">${ks.map((x) => av(x.id, x.emoji, x.name + (kidAge(x) ? ' · ' + kidAge(x).replace(' tuổi', 't') : ''), k && k.id === x.id)).join('')}
    ${ks.length > 1 ? av('all', '👨‍👩‍👧', 'Cả nhà', !k) : ''}${!ks.length ? '<button class="kb-kid" data-a="V-addkid"><span class="kb-av">＋</span><span class="kb-n">Thêm bé</span></button>' : ''}</div>`;
}
function topbar() {
  const n = V.counts == null ? (typeof pendTotal === 'function' ? pendTotal() : 0) : V.counts;
  const bell = $('#v-bell');
  if (bell) { bell.querySelector('b').textContent = n > 99 ? '99+' : n; bell.querySelector('b').classList.toggle('hidden', !n); }
}

// Chuyển tab
function vGo(t, sub) {
  if (!MAIN.includes(t) && !SUB_OF[t]) t = 'today';
  if (SUB_OF[t] && MAIN.includes(tab)) V.back = tab;
  tab = t;
  const main = MAIN.includes(t) ? t : SUB_OF[t];
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === main));
  if (sub !== undefined) V.sub = sub;
  render(); window.scrollTo(0, 0);
}

const _renderV1 = render;
render = function () {
  if (!S) return;
  document.body.classList.add('v2');
  topbar();
  const view = $('#view');
  if (S.restricted) {
    // Người thân / giáo viên: Kỷ niệm (thả cảm xúc, bình luận), Học (chỉ xem), Gia đình (tài khoản)
    document.body.classList.add('ro2');
    if (!['feed', 'learn', 'family'].includes(tab)) { tab = 'feed'; document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === 'feed')); }
    if (tab === 'feed') return Feed.render();
    if (tab === 'family') return Hub.render();
    _renderV1(); return;
  }
  if (tab === 'today') return Today.render();
  if (tab === 'learn') return Learn.render();
  if (tab === 'feed') return Feed.render();
  if (tab === 'family') return Hub.render();
  // trang con kiểu cũ
  _renderV1();
  view.insertAdjacentHTML('afterbegin', `<div class="v-sub"><button class="v-back" data-a="V-back">‹</button><b>${esc(SUB_TITLE[tab] || '')}</b></div>`);
};
// tiêu đề trang (dùng trong các màn hình mới)
const pageHead = (title, sub) => `<div class="v-head">${kidbarHtml()}<h1>${title}</h1>${sub ? `<div class="v-subt">${sub}</div>` : ''}</div>`;

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-a^="V-"]');
  if (!b) return;
  const a = b.dataset.a;
  if (a === 'V-kid') return setKid(b.dataset.id);
  if (a === 'V-back') return vGo(V.back || SUB_OF[tab] || 'today');
  if (a === 'V-bell') return vGo('review');
  if (a === 'V-go') return vGo(b.dataset.v);
  if (a === 'V-addkid') return vGo('settings');
});
