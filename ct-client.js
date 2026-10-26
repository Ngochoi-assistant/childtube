// ChildTube — kết nối tới máy chủ Cloudflare (Worker childtube-api), thay cho thư viện supabase-js.
// Giữ cùng cách gọi app.js đang dùng: supabase.createClient(url).auth / .rpc / .functions.invoke,
// nên app không phải sửa. Phiên đăng nhập lưu trong localStorage['ct-session'].
(function () {
  'use strict';
  function createClient(url) {
    var KEY = 'ct-session', listeners = [], session = null;
    try { session = JSON.parse(localStorage.getItem(KEY)); } catch (e) { session = null; }
    function save(s) {
      session = s;
      try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch (e) { /* bỏ qua */ }
    }
    function emit(ev) { listeners.forEach(function (cb) { try { cb(ev, session); } catch (e) { console.error(e); } }); }
    async function call(path, body, method) {
      var headers = { 'Content-Type': 'application/json' };
      if (session && session.access_token) headers.Authorization = 'Bearer ' + session.access_token;
      var r = await fetch(url + path, { method: method || 'POST', headers: headers, body: body === undefined ? undefined : JSON.stringify(body) });
      var j = null;
      try { j = await r.json(); } catch (e) { j = null; }
      if (r.status === 401 && session) { save(null); emit('SIGNED_OUT'); }
      return { ok: r.ok, status: r.status, j: j };
    }
    var err = function (j) { var m = (j && (j.message || j.error)) || 'Lỗi kết nối'; return { message: m, context: { json: async function () { return { error: m }; } } }; };
    var asSession = function (j) { return { access_token: j.access_token, user: j.user }; };

    // Tài khoản chuyển từ Supabase: lần đầu đăng nhập phải nhập mã thiết lập để dùng mật khẩu vừa gõ làm mật khẩu mới.
    // Mã nhập ở ô "Mã thiết lập" trên màn đăng nhập (không dùng window.prompt: nhiều trình duyệt trong app chặn hộp thoại này).
    async function setup(email, password, code) {
      if (!code) return { data: { session: null }, error: { message: 'NEED_SETUP' } };
      var r = await call('/auth/v1/setup', { email: email, code: String(code).trim(), password: password });
      if (!r.ok) return { data: { session: null }, error: err(r.j) };
      save(asSession(r.j)); emit('SIGNED_IN');
      return { data: { session: session, user: session.user }, error: null };
    }
    async function login(path, email, password, code) {
      if (code) return setup(email, password, code);
      var r = await call('/auth/v1/' + path, { email: email, password: password });
      if (!r.ok && r.j && r.j.message === 'NEED_SETUP') return setup(email, password, null);
      if (!r.ok) return { data: { session: null }, error: err(r.j) };
      save(asSession(r.j)); emit('SIGNED_IN');
      return { data: { session: session, user: session.user }, error: null };
    }

    return {
      auth: {
        onAuthStateChange: function (cb) {
          listeners.push(cb);
          setTimeout(function () { cb(session ? 'SIGNED_IN' : 'SIGNED_OUT', session); }, 0);
          return { data: { subscription: { unsubscribe: function () { listeners = listeners.filter(function (x) { return x !== cb; }); } } } };
        },
        getSession: async function () { return { data: { session: session } }; },
        signUp: function (o) { return login('signup', o.email, o.password); },
        signInWithPassword: function (o) { return login('token', o.email, o.password, o.setupCode); },
        updateUser: async function (o) { var r = await call('/auth/v1/user', o, 'PUT'); return r.ok ? { data: r.j, error: null } : { data: null, error: err(r.j) }; },
        signOut: async function () { await call('/auth/v1/logout', {}); save(null); emit('SIGNED_OUT'); return { error: null }; },
      },
      rpc: async function (fn, args) {
        var r = await call('/rest/v1/rpc/' + fn, args || {});
        return r.ok ? { data: r.j, error: null } : { data: null, error: err(r.j) };
      },
      functions: {
        invoke: async function (name, opts) {
          var r = await call('/functions/v1/' + name, (opts && opts.body) || {});
          return r.ok ? { data: r.j, error: null } : { data: null, error: err(r.j) };
        },
      },
    };
  }
  // Chỉ thay supabase-js khi web/config.js chọn máy chủ Cloudflare (backend: 'cloudflare'); quay lại Supabase = sửa một dòng config.js.
  if (window.CT_CONFIG && window.CT_CONFIG.backend === 'cloudflare') window.supabase = { createClient: createClient };
})();
