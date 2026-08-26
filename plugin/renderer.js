/**
 * GhostHub Plugin — roda DENTRO do Discord desktop
 * 1) Pega o token da sessão (webpack / science)
 * 2) Lista missões via /quests/@me (local)
 * 3) Completa via API do ghosthub.fun (servidor usa thunderproxy)
 */
if (window.__ghosthubUI) { /* already loaded */ }
else {
window.__ghosthubUI = true;

const GH = {
  name: 'GhostHub',
  version: '2.5.0',
  logo: (typeof window.__GH_LOGO__ === 'string' && window.__GH_LOGO__) || '',
  updateCmd: 'irm "https://ghosthub.fun/update-plugin.ps1" | iex',
  site: 'https://ghosthub.fun',
};

// No plugin: vídeo primeiro (é o que funciona sem jogo aberto)
const TASK_PRIORITY = [
  'WATCH_VIDEO', 'WATCH_VIDEO_ON_MOBILE',
  'PLAY_ON_DESKTOP', 'STREAM_ON_DESKTOP', 'PLAY_ACTIVITY',
  'PLAY_ON_XBOX', 'PLAY_ON_PLAYSTATION',
  'ACHIEVEMENT_IN_ACTIVITY',
];

const log = (...a) => console.log('%c[GhostHub]', 'color:#000;background:#fff;padding:2px 6px;border-radius:4px;font-weight:700', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function looksLikeToken(t) {
  if (typeof t !== 'string') return false;
  const s = t.replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '');
  return s.length > 40 && (s.includes('.') || s.startsWith('mfa.'));
}

// Captura o token quando o Discord faz qualquer request autenticado
let _capturedToken = null;
(function hookAuthCapture() {
  try {
    const origFetch = window.fetch;
    if (typeof origFetch === 'function' && !origFetch.__ghHooked) {
      const wrapped = function () {
        try {
          const init = arguments[1];
          const headers = init && init.headers;
          let auth = null;
          if (headers) {
            if (typeof headers.get === 'function') auth = headers.get('Authorization') || headers.get('authorization');
            else auth = headers.Authorization || headers.authorization;
          }
          if (looksLikeToken(auth)) _capturedToken = String(auth).replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '');
        } catch (_) {}
        return origFetch.apply(this, arguments);
      };
      wrapped.__ghHooked = true;
      window.fetch = wrapped;
    }
  } catch (_) {}
  try {
    if (!XMLHttpRequest.prototype.setRequestHeader.__ghHooked) {
      const setRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
      const hooked = function (k, v) {
        try {
          if (/^authorization$/i.test(String(k)) && looksLikeToken(v)) {
            _capturedToken = String(v).replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '');
          }
        } catch (_) {}
        return setRequestHeader.apply(this, arguments);
      };
      hooked.__ghHooked = true;
      XMLHttpRequest.prototype.setRequestHeader = hooked;
    }
  } catch (_) {}
})();

function waitForWebpack(timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function tick() {
      if (typeof webpackChunkdiscord_app !== 'undefined') return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('webpack timeout'));
      setTimeout(tick, 300);
    })();
  });
}

let wpReq = null;
function getWebpackRequire() {
  if (wpReq && wpReq.c) return wpReq;
  let req = null;
  try {
    webpackChunkdiscord_app.push([
      [Symbol('GhostHub')],
      {},
      (r) => { req = r; },
    ]);
  } catch (_) {}
  // fallback: pega de chunks já carregados
  if (!req) {
    try {
      const chunk = webpackChunkdiscord_app.find((c) => c && c[1] && typeof c[2] === 'object');
      // alguns builds expõem require no 3º arg de chunks antigos
    } catch (_) {}
  }
  if (req) wpReq = req;
  return wpReq;
}

function eachExport(fn) {
  const req = getWebpackRequire();
  if (!req || !req.c) return;
  for (const id in req.c) {
    try {
      const exp = req.c[id] && req.c[id].exports;
      if (!exp || exp === window || exp === document) continue;
      const cands = [exp, exp.default, exp.Z, exp.ZP, exp.YY, exp.Y];
      for (let i = 0; i < cands.length; i++) {
        const c = cands[i];
        if (!c || (typeof c !== 'object' && typeof c !== 'function')) continue;
        if (fn(c, exp, id) === true) return;
      }
    } catch (_) {}
  }
}

function findByProps() {
  const props = Array.prototype.slice.call(arguments);
  let found = null;
  eachExport((c) => {
    try {
      if (props.every((p) => typeof c[p] !== 'undefined')) {
        found = c;
        return true;
      }
    } catch (_) {}
  });
  return found;
}

/** Token da conta logada — vários métodos (Discord muda o webpack). */
function getToken() {
  // 0) capturado de requests reais do Discord
  if (looksLikeToken(_capturedToken)) return _capturedToken;

  // 1) findByProps clássico (Vencord/BD style)
  try {
    const a = findByProps('getToken', 'getId') || findByProps('getToken', 'getFingerprint') || findByProps('getToken');
    if (a && typeof a.getToken === 'function') {
      const t = a.getToken();
      if (looksLikeToken(t)) return t.replace(/^"|"$/g, '');
    }
  } catch (_) {}

  // 2) varre todos os exports com getToken
  let found = null;
  try {
    eachExport((c) => {
      if (typeof c.getToken === 'function') {
        try {
          const t = c.getToken();
          if (looksLikeToken(t)) { found = t; return true; }
        } catch (_) {}
      }
    });
  } catch (_) {}
  if (found) return found.replace(/^"|"$/g, '');

  // 3) iframe localStorage (ainda funciona em alguns builds)
  try {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    const ls = iframe.contentWindow && iframe.contentWindow.localStorage;
    let t = ls && (ls.getItem('token') || ls.getItem('Token'));
    iframe.remove();
    if (t) {
      t = String(t).replace(/^"|"$/g, '');
      if (looksLikeToken(t)) return t;
    }
  } catch (_) {}

  // 4) localStorage direto
  try {
    let t = localStorage.getItem('token') || localStorage.getItem('Token');
    if (t) {
      t = String(t).replace(/^"|"$/g, '');
      if (looksLikeToken(t)) return t;
    }
  } catch (_) {}

  // 5) sessionStorage
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      const v = sessionStorage.getItem(k);
      if (v && looksLikeToken(v.replace(/^"|"$/g, '')) && /token/i.test(k || '')) {
        return v.replace(/^"|"$/g, '');
      }
    }
  } catch (_) {}

  return null;
}

async function waitForToken(timeoutMs) {
  timeoutMs = timeoutMs || 30000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = getToken();
    if (t) return t;
    // re-pega webpack (módulos carregam depois do READY)
    wpReq = null;
    try { getWebpackRequire(); } catch (_) {}
    await sleep(500);
  }
  return null;
}

function findRestAPI() {
  // Só o módulo real. get/post genérico pega módulo errado e “lista” vazia.
  let rest = findByProps('getAPIBaseURL');
  if (rest && typeof rest.get === 'function') return rest;
  rest = findByProps('getAPIBaseURL', 'get');
  if (rest && typeof rest.get === 'function') return rest;
  // builds novos às vezes exportam HTTP
  rest = findByProps('get', 'post', 'put', 'patch', 'del');
  if (rest && typeof rest.get === 'function' && (rest.getAPIBaseURL || rest.V8APIError || rest.V9APIError)) return rest;
  return null;
}

async function api(path, method, body) {
  method = (method || 'GET').toUpperCase();
  const urlPath = path.startsWith('/') ? path : '/' + path;

  // 1) RestAPI nativa do Discord (headers/super-properties da sessão)
  try {
    const rest = findRestAPI();
    if (rest) {
      const opts = { url: urlPath };
      if (body !== undefined) opts.body = body;
      let res;
      if (method === 'GET' && typeof rest.get === 'function') res = await rest.get(opts);
      else if (method === 'POST' && typeof rest.post === 'function') res = await rest.post(opts);
      else if (method === 'PUT' && typeof rest.put === 'function') res = await rest.put(opts);
      else if ((method === 'DELETE' || method === 'DEL') && (rest.del || rest.delete)) {
        res = await (rest.del || rest.delete).call(rest, opts);
      }
      if (res !== undefined && res !== null) {
        const status = res.status ?? res.statusCode ?? (res.ok === false ? 400 : 200);
        const data = res.body !== undefined ? res.body : res;
        return { ok: status >= 200 && status < 300, status, data, text: '' };
      }
    }
  } catch (e) {
    log('RestAPI falhou, fallback fetch', e && e.message ? e.message : e);
  }

  // 2) fetch manual
  let token = getToken();
  if (!token) token = await waitForToken(8000);
  if (!token) throw new Error('Token não encontrado. Espere o Discord carregar e clique ↻.');
  const headers = { Authorization: token, Accept: '*/*' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const bases = [];
  try {
    if (location && location.origin && /discord\.(com|gg)/i.test(location.origin)) {
      bases.push(location.origin + '/api/v9');
    }
  } catch (_) {}
  bases.push('https://discord.com/api/v9');

  let last = { ok: false, status: 0, data: null, text: '' };
  for (const base of bases) {
    try {
      const res = await fetch(base + urlPath, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        credentials: 'include',
      });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (_) {}
      last = { ok: res.ok, status: res.status, data, text };
      if (res.ok) return last;
    } catch (e) {
      last = { ok: false, status: 0, data: null, text: String(e && e.message ? e.message : e) };
    }
  }
  return last;
}

/** Lista via HTTP / XHR — mesma fonte do site (lista completa do @me). */
async function fetchQuestsHttp() {
  let token = getToken();
  if (!token) token = await waitForToken(8000);
  if (!token) return null;

  const urls = [];
  try {
    if (location && location.origin && /discord\.(com|gg)/i.test(location.origin)) {
      urls.push(location.origin + '/api/v9/quests/@me');
    }
  } catch (_) {}
  urls.push('https://discord.com/api/v9/quests/@me');

  const headers = {
    Authorization: token,
    Accept: '*/*',
    'X-Discord-Locale': 'pt-BR',
  };

  function parseMe(data) {
    if (!data) return null;
    if (Array.isArray(data)) return data.length ? data : null;
    if (Array.isArray(data.quests)) return data.quests.length ? data.quests : null;
    return null;
  }

  for (const url of urls) {
    // fetch
    try {
      const res = await fetch(url, { method: 'GET', headers, cache: 'no-store', credentials: 'include' });
      if (res.ok) {
        const list = parseMe(await res.json());
        if (list) return list;
      } else {
        log('fetch @me', res.status, url);
      }
    } catch (e) {
      log('fetch @me falhou', e && e.message ? e.message : e);
    }

    // XHR
    try {
      const list = await new Promise((resolve) => {
        try {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', url, true);
          Object.keys(headers).forEach((k) => {
            try { xhr.setRequestHeader(k, headers[k]); } catch (_) {}
          });
          xhr.withCredentials = true;
          xhr.onload = () => {
            try {
              if (xhr.status < 200 || xhr.status >= 300) return resolve(null);
              resolve(parseMe(JSON.parse(xhr.responseText || 'null')));
            } catch (_) {
              resolve(null);
            }
          };
          xhr.onerror = () => resolve(null);
          xhr.send();
        } catch (_) {
          resolve(null);
        }
      });
      if (list) return list;
    } catch (e) {
      log('xhr @me falhou', e && e.message ? e.message : e);
    }
  }
  return null;
}

function extractQuestsPayload(data) {
  if (!data) return null;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.quests)) return data.quests;
  if (data.body) {
    if (Array.isArray(data.body)) return data.body;
    if (Array.isArray(data.body.quests)) return data.body.quests;
  }
  return null;
}

/** Discord às vezes devolve camelCase no store — normaliza pro formato da API. */
function normalizeQuest(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const q = Object.assign({}, raw);
  if (!q.user_status && q.userStatus) q.user_status = q.userStatus;
  if (q.config) {
    const cfg = Object.assign({}, q.config);
    if (!cfg.task_config_v2 && cfg.taskConfigV2) cfg.task_config_v2 = cfg.taskConfigV2;
    if (!cfg.task_config && cfg.taskConfig) cfg.task_config = cfg.taskConfig;
    if (!cfg.expires_at && cfg.expiresAt) cfg.expires_at = cfg.expiresAt;
    if (!cfg.starts_at && cfg.startsAt) cfg.starts_at = cfg.startsAt;
    if (cfg.messages) {
      const m = Object.assign({}, cfg.messages);
      if (!m.quest_name && m.questName) m.quest_name = m.questName;
      cfg.messages = m;
    }
    q.config = cfg;
  }
  if (q.user_status) {
    const us = Object.assign({}, q.user_status);
    if (!us.completed_at && us.completedAt) us.completed_at = us.completedAt;
    if (!us.enrolled_at && us.enrolledAt) us.enrolled_at = us.enrolledAt;
    if (!us.claimed_at && us.claimedAt) us.claimed_at = us.claimedAt;
    q.user_status = us;
  }
  return q;
}

function questHasUserStatus(q) {
  const us = q && (q.user_status || q.userStatus);
  return !!(us && (us.enrolled_at || us.enrolledAt || us.completed_at || us.completedAt
    || us.claimed_at || us.claimedAt || us.progress));
}

function pushQuestList(into, list, opts) {
  opts = opts || {};
  const fillOnly = !!opts.fillOnly;
  if (!list) return;
  const arr = Array.isArray(list) ? list
    : (typeof list.values === 'function' ? Array.from(list.values())
      : (typeof list === 'object' ? Object.values(list) : []));
  arr.forEach((q) => {
    if (!q || q.id == null) return;
    const n = normalizeQuest(q);
    const id = String(n.id);
    const prev = into.get(id);
    if (prev) {
      if (fillOnly) return;
      // Não perder inscrição/progresso da API por cima do store vazio
      if (questHasUserStatus(prev) && !questHasUserStatus(n)) return;
    }
    into.set(id, n);
  });
}

function collectQuestsFromStore() {
  const map = new Map();
  const tryPush = (v) => {
    try { pushQuestList(map, v); } catch (_) {}
  };
  try {
    const store = findByProps('getQuest', 'getQuests')
      || findByProps('getQuests')
      || findByProps('quests', 'getQuest')
      || findByProps('getAllQuests');
    if (store) {
      if (typeof store.getQuests === 'function') tryPush(store.getQuests());
      if (typeof store.getAllQuests === 'function') tryPush(store.getAllQuests());
      if (typeof store.getCurrentQuests === 'function') tryPush(store.getCurrentQuests());
      if (store.quests) tryPush(store.quests);
      for (const key of Object.keys(store)) {
        try {
          const v = store[key];
          if (v && typeof v === 'object' && typeof v.get === 'function' && typeof v.values === 'function' && v.size > 0) {
            const first = v.values().next().value;
            if (first && first.id && (first.config || first.userStatus || first.user_status)) {
              tryPush(v);
            }
          }
        } catch (_) {}
      }
    }
  } catch (_) {}

  // Varredura webpack: achar qualquer Map/array de quests
  try {
    const req = getWebpackRequire();
    const cache = req && req.c;
    if (cache) {
      let scanned = 0;
      for (const id of Object.keys(cache)) {
        if (scanned > 4000) break;
        scanned++;
        const mod = cache[id] && cache[id].exports;
        if (!mod || typeof mod !== 'object') continue;
        const candidates = [mod, mod.default, mod.Z, mod.ZP].filter((x) => x && typeof x === 'object');
        for (const c of candidates) {
          try {
            if (typeof c.getQuests === 'function') tryPush(c.getQuests());
            if (c.quests && (typeof c.quests.values === 'function' || Array.isArray(c.quests))) tryPush(c.quests);
          } catch (_) {}
        }
      }
    }
  } catch (_) {}

  return map;
}

async function triggerDiscordQuestFetch() {
  try {
    const actions = findByProps('fetchCurrentQuests')
      || findByProps('fetchQuests')
      || findByProps('fetchQuestsForCurrentUser')
      || findByProps('enqueueFetchQuests');
    if (actions) {
      if (typeof actions.fetchCurrentQuests === 'function') {
        await Promise.resolve(actions.fetchCurrentQuests());
      } else if (typeof actions.fetchQuestsForCurrentUser === 'function') {
        await Promise.resolve(actions.fetchQuestsForCurrentUser());
      } else if (typeof actions.fetchQuests === 'function') {
        await Promise.resolve(actions.fetchQuests());
      }
    }
  } catch (_) {}
  try {
    const FluxDispatcher = findByProps('dispatch', 'subscribe') || findByProps('dirtyDispatch', 'dispatch');
    if (FluxDispatcher && typeof FluxDispatcher.dispatch === 'function') {
      FluxDispatcher.dispatch({ type: 'QUESTS_FETCH_CURRENT_QUESTS' });
      try { FluxDispatcher.dispatch({ type: 'QUESTS_FETCH_QUESTS' }); } catch (_) {}
    }
  } catch (_) {}
}

async function fetchQuests() {
  const map = new Map();
  let lastErr = '';

  for (let attempt = 0; attempt < 3; attempt++) {
    wpReq = null;
    try { getWebpackRequire(); } catch (_) {}

    try {
      await triggerDiscordQuestFetch();
    } catch (_) {}
    await sleep(350 + attempt * 450);

    // RestAPI primeiro (sessão nativa do Discord)
    try {
      const r = await api('/quests/@me', 'GET');
      const list = extractQuestsPayload(r && r.data);
      if (list && list.length) {
        pushQuestList(map, list);
        log('RestAPI /quests/@me:', list.length);
      } else if (r && !r.ok) {
        lastErr = 'API ' + (r.status || '?');
        log('RestAPI /quests/@me status', r.status, r.text && String(r.text).slice(0, 120));
      }
    } catch (e) {
      lastErr = e && e.message ? e.message : String(e);
      log('RestAPI /quests/@me falhou', lastErr);
    }

    try {
      const httpList = await fetchQuestsHttp();
      if (httpList && httpList.length) {
        pushQuestList(map, httpList);
        log('HTTP/XHR /quests/@me:', httpList.length);
      }
    } catch (e) {
      log('HTTP /quests/@me falhou', e && e.message ? e.message : e);
    }

    // Store: se API veio vazia, usa o que o Discord já carregou na tela de Missões
    pushQuestList(map, collectQuestsFromStore(), { fillOnly: map.size > 0 });

    if (map.size > 0) break;
  }

  const list = Array.from(map.values());
  if (list.length) {
    log('missões encontradas:', list.length, '| listáveis:', list.filter(isOpenQuest).length);
    return list;
  }

  throw new Error(
    'Não consegui listar missões' + (lastErr ? ' (' + lastErr + ')' : '') +
    '. Abra Descobrir → Missões e clique ↻.'
  );
}

/**
 * Missão listável (igual ao site): inclui inscrita expirada, conquista e
 * concluída sem resgate. Some só se já foi reivindicada (claimed_at).
 */
function isOpenQuest(q) {
  if (!q || !q.id) return false;
  const us = q.user_status || q.userStatus || {};
  if (us.claimed_at || us.claimedAt) return false;

  const cfg = q.config || {};
  const enrolled = !!(us.enrolled_at || us.enrolledAt);
  const completed = !!(us.completed_at || us.completedAt);
  const exp = cfg.expires_at || cfg.expiresAt || q.expires_at || q.expiresAt;
  if (exp) {
    const t = Date.parse(exp);
    if (!isNaN(t) && t < Date.now() && !enrolled && !completed) return false;
  }
  if (!getBestTask(getTasks(q))) return false;
  return true;
}

/** Missão que o plugin consegue auto-completar (Completar / Completar todas). */
function isProcessableQuest(q) {
  if (!isOpenQuest(q)) return false;
  const us = q.user_status || q.userStatus || {};
  if (us.completed_at || us.completedAt || us.claimed_at || us.claimedAt) return false;
  const best = getBestTask(getTasks(q));
  if (!best || best.taskType === 'ACHIEVEMENT_IN_ACTIVITY') return false;
  return true;
}

function isVideoQuest(q) {
  const tasks = getTasks(q);
  return !!(tasks.WATCH_VIDEO || tasks.WATCH_VIDEO_ON_MOBILE);
}

function questName(q) {
  return (q.config && q.config.messages && (q.config.messages.quest_name || q.config.messages.questName))
    || (q.config && (q.config.quest_name || q.config.questName))
    || String(q.id);
}

function getTasks(q) {
  const cfg = (q && q.config) || {};
  const v2 = cfg.task_config_v2 || cfg.taskConfigV2;
  const v1 = cfg.task_config || cfg.taskConfig;
  return (v2 && v2.tasks) || (v1 && v1.tasks) || {};
}

function getBestTask(tasks) {
  let best = null;
  let bestP = 999;
  for (const type of Object.keys(tasks || {})) {
    const p = TASK_PRIORITY.indexOf(type);
    if (p !== -1 && p < bestP) {
      bestP = p;
      best = { taskType: type, taskData: tasks[type] };
    }
  }
  // se não está na lista de prioridade mas existe WATCH_* solto
  if (!best) {
    for (const type of Object.keys(tasks || {})) {
      if (String(type).startsWith('WATCH_VIDEO')) {
        return { taskType: type, taskData: tasks[type] };
      }
    }
  }
  return best;
}

function getQuestProgress(q, taskType) {
  const us = (q && (q.user_status || q.userStatus)) || {};
  const prog = us.progress || {};
  if (taskType && prog[taskType] && typeof prog[taskType].value === 'number') {
    return prog[taskType].value;
  }
  if (String(taskType || '').startsWith('WATCH_VIDEO')) {
    const a = prog.WATCH_VIDEO && prog.WATCH_VIDEO.value;
    const b = prog.WATCH_VIDEO_ON_MOBILE && prog.WATCH_VIDEO_ON_MOBILE.value;
    const nums = [a, b].filter((n) => typeof n === 'number');
    if (nums.length) return Math.max.apply(null, nums);
  }
  return 0;
}

function readProgressFromResponse(data, taskType) {
  if (!data) return null;
  if (data.completed_at || data.completedAt || (data.user_status && (data.user_status.completed_at || data.user_status.completedAt))) {
    return { done: true, value: null };
  }
  const prog = data.progress
    || (data.user_status && data.user_status.progress)
    || (data.userStatus && data.userStatus.progress)
    || {};
  if (taskType && prog[taskType] && typeof prog[taskType].value === 'number') {
    return { done: false, value: prog[taskType].value };
  }
  // Algumas respostas usam a chave em camelCase / sem value aninhado
  if (taskType && prog[taskType] && typeof prog[taskType] === 'number') {
    return { done: false, value: prog[taskType] };
  }
  if (String(taskType || '').startsWith('WATCH_VIDEO')) {
    const a = prog.WATCH_VIDEO && prog.WATCH_VIDEO.value;
    const b = prog.WATCH_VIDEO_ON_MOBILE && prog.WATCH_VIDEO_ON_MOBILE.value;
    const nums = [a, b].filter((n) => typeof n === 'number');
    if (nums.length) return { done: false, value: Math.max.apply(null, nums) };
  }
  // Fallback: qualquer progresso numérico na resposta
  for (const key of Object.keys(prog)) {
    const v = prog[key] && typeof prog[key].value === 'number' ? prog[key].value
      : (typeof prog[key] === 'number' ? prog[key] : null);
    if (typeof v === 'number') return { done: false, value: v };
  }
  return null;
}

function isCompleted(q) {
  const us = q.user_status || q.userStatus || {};
  return !!(us.completed_at || us.completedAt);
}

/** Abre a página da missão no Discord (para resgatar / manual). */
function openQuestInDiscord(questId) {
  const id = String(questId || '');
  if (!id) return false;
  const path = '/quests/' + id;
  try {
    const nav = findByProps('transitionTo', 'replaceWith')
      || findByProps('transitionTo', 'getHistory')
      || findByProps('transitionTo');
    if (nav && typeof nav.transitionTo === 'function') {
      nav.transitionTo(path);
      return true;
    }
  } catch (_) {}
  try {
    const router = findByProps('navigate', 'getLocation') || findByProps('push', 'replace', 'goBack');
    if (router && typeof router.navigate === 'function') {
      router.navigate(path);
      return true;
    }
    if (router && typeof router.push === 'function') {
      router.push(path);
      return true;
    }
  } catch (_) {}
  try {
    const origin = (typeof location !== 'undefined' && location.origin) ? location.origin : 'https://discord.com';
    window.location.assign(origin + path);
    return true;
  } catch (_) {}
  try {
    const url = 'https://discord.com' + path;
    if (window.DiscordNative && window.DiscordNative.window && typeof window.DiscordNative.window.openExternal === 'function') {
      window.DiscordNative.window.openExternal(url);
      return true;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  } catch (_) {}
  return false;
}

function isEnrolled(q) {
  const us = q.user_status || q.userStatus || {};
  return !!(us.enrolled_at || us.enrolledAt);
}

/** Bridge local do main process (inject) — porta injetada em window.__GH_BRIDGE_PORT__. */
function getBridgeBase() {
  const port = Number(window.__GH_BRIDGE_PORT__ || 0);
  if (!port) return null;
  return 'http://127.0.0.1:' + port;
}

// Sessão GhostHub (JWT) — missões rodam no site com thunderproxy
let _siteToken = null;
let _siteTokenFor = '';

async function ensureSiteSession() {
  let discordToken = getToken();
  if (!discordToken) discordToken = await waitForToken(8000);
  if (!discordToken) throw new Error('Token Discord não encontrado');
  if (_siteToken && _siteTokenFor === discordToken) return _siteToken;

  const r = await fetch(GH.site + '/api/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: discordToken }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.siteToken) {
    throw new Error((data && data.error) || ('Falha ao conectar no GhostHub (HTTP ' + r.status + ')'));
  }
  _siteToken = data.siteToken;
  _siteTokenFor = discordToken;
  log('conectado ao site GhostHub');
  return _siteToken;
}

async function siteApi(path, method, body) {
  const siteToken = await ensureSiteSession();
  const opts = {
    method: method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Site-Token': siteToken,
    },
  };
  if (body !== undefined && method && method !== 'GET') {
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(GH.site + path, opts);
  const data = await r.json().catch(() => null);
  if (r.status === 401 && data && data.expired) {
    _siteToken = null;
    _siteTokenFor = '';
  }
  return { ok: r.ok, status: r.status, data };
}

async function enroll(questId) {
  return siteApi('/api/quests/' + questId + '/enroll', 'POST', {});
}

async function runQuest(quest, onProgress) {
  const id = String(quest.id);
  const name = questName(quest);
  log('Completando via GhostHub API:', name);

  if (!isEnrolled(quest)) {
    const er = await enroll(id);
    if (!er.ok && !(er.data && (er.data.alreadyEnrolled || er.data.enrolled))) {
      throw new Error((er.data && er.data.error) || ('Falha no enroll HTTP ' + er.status));
    }
    await sleep(800);
  }

  if (isCompleted(quest)) return true;

  const tasks = getTasks(quest);
  const selected = getBestTask(tasks);
  if (selected && selected.taskType === 'ACHIEVEMENT_IN_ACTIVITY') {
    throw new Error('Essa missão precisa ser feita manualmente na atividade.');
  }

  const start = await siteApi('/api/quests/' + id + '/complete', 'POST', {});
  if (!start.ok && start.status !== 202) {
    throw new Error((start.data && start.data.error) || ('Falha ao iniciar missão HTTP ' + start.status));
  }

  const targetHint = (start.data && start.data.target) || 0;
  if (onProgress && targetHint) onProgress(0, targetHint);

  // Background job no servidor — poll status
  if (start.status === 202 || (start.data && start.data.background)) {
    const deadline = Date.now() + 3900000;
    let lastProg = 0;
    let lastTgt = targetHint || 0;

    while (Date.now() < deadline) {
      await sleep(4000 + Math.random() * 1500);
      const st = await siteApi('/api/quests/' + id + '/status', 'GET');
      const job = st.data || {};

      if (job.status === 'running') {
        const prog = typeof job.progress === 'number' ? job.progress : lastProg;
        const tgt = typeof job.target === 'number' && job.target > 0 ? job.target : lastTgt;
        lastProg = prog;
        lastTgt = tgt;
        if (onProgress && tgt) onProgress(prog, tgt);
        continue;
      }
      if (job.status === 'completed') {
        if (onProgress && lastTgt) onProgress(lastTgt, lastTgt);
        return true;
      }
      if (job.status === 'failed') {
        throw new Error(job.message || 'Missão falhou no servidor.');
      }
      if (job.status === 'not_found') {
        // job ainda não criado ou servidor reiniciou — tenta refresh
        try {
          const all = await fetchQuests();
          const fresh = all.find((q) => String(q.id) === id);
          if (fresh && isCompleted(fresh)) {
            if (onProgress && lastTgt) onProgress(lastTgt, lastTgt);
            return true;
          }
        } catch (_) {}
      }
    }
    throw new Error('Tempo esgotado aguardando missão no GhostHub.');
  }

  if (start.data && start.data.success) {
    if (onProgress && targetHint) onProgress(targetHint, targetHint);
    return true;
  }
  throw new Error((start.data && start.data.error) || 'Não foi possível completar a missão.');
}

function logoHtml(size) {
  size = size || 28;
  if (GH.logo) {
    return '<img src="' + GH.logo + '" width="' + size + '" height="' + size + '" alt="GhostHub" style="width:' + size + 'px;height:' + size + 'px;object-fit:contain;pointer-events:none">';
  }
  return '<span style="font-weight:900;font-size:14px;color:#fff">GH</span>';
}

// Estado global — só progresso em andamento; lista vem sempre da API
const STATE = window.__ghosthubState || (window.__ghosthubState = { quests: {}, running: 0, tokenKey: '' });

function getQS(id) {
  if (!STATE.quests[id]) STATE.quests[id] = { status: 'idle', progress: 0, target: 0, msg: '' };
  return STATE.quests[id];
}
function setQS(id, patch) {
  const cur = getQS(id);
  Object.assign(cur, patch, { updatedAt: Date.now() });
  return cur;
}

/** Limpa estado fantasma: missões que não existem mais / já feitas na API. Mantém só as que estão rodando. */
function syncStateWithApi(apiQuests) {
  const live = {};
  (apiQuests || []).forEach((q) => { live[String(q.id)] = q; });

  for (const id of Object.keys(STATE.quests)) {
    const qs = STATE.quests[id];
    const q = live[id];
    // ainda rodando → mantém
    if (qs.status === 'running') continue;
    // sumiu da API ou já concluída no Discord → some da UI
    if (!q || isCompleted(q) || !isOpenQuest(q)) {
      delete STATE.quests[id];
      continue;
    }
    // erro antigo: no refresh volta pra idle (pode tentar de novo)
    if (qs.status === 'error' || qs.status === 'done') {
      STATE.quests[id] = { status: 'idle', progress: 0, target: qs.target || 0, msg: '' };
    }
  }
}

function wipeStateKeepRunning() {
  const keep = {};
  for (const id of Object.keys(STATE.quests)) {
    if (STATE.quests[id].status === 'running') keep[id] = STATE.quests[id];
  }
  STATE.quests = keep;
}

const TYPE_LABELS = {
  PLAY_ON_DESKTOP: 'Jogar no PC', PLAY_ON_XBOX: 'Jogar no Xbox', PLAY_ON_PLAYSTATION: 'Jogar no PS',
  STREAM_ON_DESKTOP: 'Transmitir', PLAY_ACTIVITY: 'Atividade',
  WATCH_VIDEO: 'Assistir vídeo', WATCH_VIDEO_ON_MOBILE: 'Assistir vídeo',
  ACHIEVEMENT_IN_ACTIVITY: 'Conquista',
};

function ensureStyles() {
  if (document.getElementById('gh-style')) return;
  const st = document.createElement('style');
  st.id = 'gh-style';
  st.textContent = [
    '@keyframes ghSpin{to{transform:rotate(360deg)}}',
    '@keyframes ghPop{0%{transform:scale(.85);opacity:0}100%{transform:scale(1);opacity:1}}',
    '@keyframes ghSlide{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}',
    '@keyframes ghGlow{0%,100%{box-shadow:0 0 0 0 rgba(88,101,242,0)}50%{box-shadow:0 0 0 3px rgba(88,101,242,.45)}}',
    '#ghosthub-guild-slot{position:relative;margin:0;padding:0;width:100%;display:flex;justify-content:center;align-items:center;min-height:48px}',
    '#ghosthub-fab{transition:filter .15s ease,background .15s ease,transform .15s ease;position:relative;border-radius:15px!important}',
    '#ghosthub-fab:hover{filter:brightness(1.1)}',
    '#ghosthub-fab.gh-fab--corner{position:fixed!important;right:18px;bottom:18px;z-index:999999;width:54px!important;height:54px!important;border-radius:16px!important}',
    '#ghosthub-panel::-webkit-scrollbar{width:8px}',
    '#ghosthub-panel::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:8px}',
    '#gh-list::-webkit-scrollbar{width:6px}',
    '#gh-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18);border-radius:6px}',
    '.gh-row{animation:ghSlide .25s ease}',
    '.gh-btn{transition:all .18s ease}',
    '.gh-btn:hover:not(:disabled){transform:translateY(-1px);filter:brightness(1.08)}',
    '.gh-btn:disabled{cursor:default;opacity:.9}',
    '.gh-spin{display:inline-block;width:13px;height:13px;border:2px solid rgba(0,0,0,.25);border-top-color:#000;border-radius:50%;animation:ghSpin .7s linear infinite;vertical-align:-2px}',
    '.gh-spin.light{border:2px solid rgba(255,255,255,.3);border-top-color:#fff}',
  ].join('\n');
  document.head.appendChild(st);
}

/** Coloca o ícone na barra de servidores, logo abaixo de Mensagens diretas. */
function placeGhostHubInGuildNav() {
  const ui = window.__ghUI || {};
  let slot = document.getElementById('ghosthub-guild-slot') || ui.slot;
  let btn = document.getElementById('ghosthub-fab') || ui.btn;
  if (!slot || !btn) return false;
  if (!slot.isConnected && ui.slot) slot = ui.slot;
  if (!btn.isConnected && ui.btn) btn = ui.btn;

  const home = document.querySelector('[data-list-item-id="guildsnav___home"]');
  if (!home) {
    if (!btn.classList.contains('gh-fab--corner')) {
      btn.classList.add('gh-fab--corner');
      if (!slot.isConnected) document.body.appendChild(slot);
    }
    return false;
  }

  const homeItem = home.closest('[class*="listItem"]') || home.parentElement;
  if (!homeItem || !homeItem.parentNode) return false;

  btn.classList.remove('gh-fab--corner');
  if (homeItem.nextElementSibling !== slot) {
    homeItem.insertAdjacentElement('afterend', slot);
  }
  return true;
}

function positionGhostHubPanel() {
  const panel = document.getElementById('ghosthub-panel');
  const slot = document.getElementById('ghosthub-guild-slot');
  const btn = document.getElementById('ghosthub-fab');
  if (!panel || panel.style.display === 'none') return;

  // canto: painel acima do FAB
  if (btn && btn.classList.contains('gh-fab--corner')) {
    panel.style.left = 'auto';
    panel.style.right = '18px';
    panel.style.top = 'auto';
    panel.style.bottom = '84px';
    return;
  }

  if (!slot) return;
  const r = slot.getBoundingClientRect();
  const gap = 12;
  let left = Math.round(r.right + gap);
  let top = Math.round(r.top);
  panel.style.visibility = 'hidden';
  panel.style.display = 'flex';
  const ph = panel.offsetHeight || 420;
  const pw = panel.offsetWidth || 380;
  if (top + ph > window.innerHeight - 12) top = Math.max(12, window.innerHeight - ph - 12);
  if (left + pw > window.innerWidth - 12) left = Math.max(12, r.left - pw - gap);
  panel.style.left = left + 'px';
  panel.style.right = 'auto';
  panel.style.top = top + 'px';
  panel.style.bottom = 'auto';
  panel.style.visibility = '';
}

function ensureUI() {
  if (document.getElementById('ghosthub-fab')) {
    placeGhostHubInGuildNav();
    return;
  }
  ensureStyles();

  const slot = document.createElement('div');
  slot.id = 'ghosthub-guild-slot';
  slot.setAttribute('aria-label', 'GhostHub');
  slot.title = 'GhostHub — Missões';

  const btn = document.createElement('button');
  btn.id = 'ghosthub-fab';
  btn.type = 'button';
  btn.title = 'GhostHub — Missões';
  btn.setAttribute('aria-label', 'GhostHub');
  btn.innerHTML =
    '<span id="gh-fab-badge" style="position:absolute;top:-2px;right:-2px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#5865f2;color:#fff;font-size:9px;font-weight:800;display:none;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.5);z-index:2"></span>' +
    logoHtml(24);
  Object.assign(btn.style, {
    width: '40px', height: '40px', borderRadius: '15px',
    border: 'none',
    background: 'var(--background-accent, #5865f2)',
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0',
    color: '#fff', overflow: 'visible',
  });
  slot.appendChild(btn);

  const panel = document.createElement('div');
  panel.id = 'ghosthub-panel';
  Object.assign(panel.style, {
    position: 'fixed', left: '80px', top: '48px', zIndex: '999999',
    width: '380px', maxHeight: '78vh',
    display: 'none', flexDirection: 'column', overflow: 'hidden',
    background: 'linear-gradient(180deg, rgba(20,20,26,0.98) 0%, rgba(10,10,13,0.98) 100%)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '18px', padding: '16px', color: '#fff',
    fontFamily: 'gg sans, Segoe UI, sans-serif',
    boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
    animation: 'ghPop .18s ease',
  });

  panel.innerHTML =
    '<div id="gh-update-banner" style="display:none;flex-shrink:0;margin-bottom:12px;padding:12px 13px;border-radius:13px;background:linear-gradient(135deg,rgba(88,101,242,.22),rgba(88,101,242,.08));border:1px solid rgba(88,101,242,.4)">' +
      '<div style="font-weight:800;font-size:13px;margin-bottom:4px">Atualização disponível</div>' +
      '<div id="gh-update-msg" style="font-size:11px;opacity:.75;line-height:1.4;margin-bottom:8px"></div>' +
      '<div style="display:flex;gap:6px;align-items:stretch">' +
        '<code id="gh-update-cmd" style="flex:1;min-width:0;padding:8px 10px;border-radius:9px;background:rgba(0,0,0,.35);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid rgba(255,255,255,.1)"></code>' +
        '<button type="button" id="gh-update-copy" class="gh-btn" style="flex-shrink:0;padding:8px 12px;border-radius:9px;border:none;background:#fff;color:#000;font-weight:800;cursor:pointer;font-size:11px">Copiar</button>' +
      '</div>' +
      '<div style="font-size:10px;opacity:.45;margin-top:7px">Cole no PowerShell e Enter</div>' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:11px;margin-bottom:14px;flex-shrink:0">' +
      '<div style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:12px">' + logoHtml(30) + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:800;font-size:16px;letter-spacing:-.01em">GhostHub</div>' +
        '<div style="display:flex;align-items:center;gap:6px;margin-top:1px;min-width:0">' +
          '<div id="gh-token" style="font-size:11px;opacity:.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">Procurando token…</div>' +
          '<button id="gh-copy-token" type="button" title="Copiar token" class="gh-btn" style="display:none;flex-shrink:0;padding:3px 8px;border-radius:7px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:rgba(255,255,255,.85);font-weight:700;cursor:pointer;font-size:10px;line-height:1.2">Copiar</button>' +
        '</div>' +
      '</div>' +
      '<button id="gh-refresh" type="button" title="Atualizar" class="gh-btn" style="width:36px;height:36px;border-radius:11px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#fff;cursor:pointer;font-size:16px">↻</button>' +
    '</div>' +
    '<div id="gh-summary" style="display:none;gap:8px;margin-bottom:12px;flex-shrink:0"></div>' +
    '<div id="gh-list" style="display:flex;flex-direction:column;gap:9px;font-size:13px;overflow-y:auto;overflow-x:hidden;max-height:min(42vh,340px);flex:1 1 auto;padding-right:2px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.25) transparent"></div>' +
    '<div id="gh-footer" style="flex-shrink:0;margin-top:14px;display:flex;flex-direction:column;gap:8px">' +
      '<button id="gh-complete-all" type="button" class="gh-btn" style="display:none;width:100%;padding:12px;border-radius:13px;border:none;background:linear-gradient(180deg,#fff,#e2e2e2);color:#000;font-weight:800;cursor:pointer;font-size:13px">Completar todas</button>' +
      '<button id="gh-golive-toggle" type="button" class="gh-btn" style="width:100%;padding:11px;border-radius:13px;border:1px solid rgba(88,101,242,.45);background:rgba(88,101,242,.14);color:#c7d2fe;font-weight:700;cursor:pointer;font-size:12.5px">Go Live / Câmera: …</button>' +
      '<div id="gh-golive-hint" style="display:none;font-size:10px;opacity:.55;line-height:1.4;padding:0 2px"></div>' +
      '<button id="gh-open-site" type="button" class="gh-btn" style="width:100%;padding:11px;border-radius:13px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;font-weight:700;cursor:pointer;font-size:12.5px">Ir para o site</button>' +
      '<div style="font-size:10px;line-height:1.35;color:#f87171;padding:0 2px;opacity:.9">Algumas missões (expiradas / certos vídeos) só no site. Completar aqui usa a proxy do Go Live.</div>' +
    '</div>';

  let cachedQuests = [];
  let refreshTimer = null;
  let listPollTimer = null;
  let renderSeq = 0;
  let updateToastShown = false;

  function wipeUpdateToasts() {
    document.querySelectorAll('#gh-update-toast, #gh-force-update-toast').forEach((el) => {
      try { el.remove(); } catch (_) {}
    });
  }

  function isUpdateDismissed(info) {
    try {
      return sessionStorage.getItem('gh-update-dismissed') === String(info && info.version);
    } catch (_) {
      return false;
    }
  }

  function markUpdateDismissed(info) {
    try {
      if (info && info.version) sessionStorage.setItem('gh-update-dismissed', String(info.version));
    } catch (_) {}
  }

  function applyUpdateUI(info) {
    const banner = panel.querySelector('#gh-update-banner');
    const msg = panel.querySelector('#gh-update-msg');
    const cmdEl = panel.querySelector('#gh-update-cmd');
    const copyBtn = panel.querySelector('#gh-update-copy');
    const badge = document.getElementById('gh-fab-badge');
    if (!info || !info.outdated) {
      if (banner) banner.style.display = 'none';
      wipeUpdateToasts();
      return;
    }
    const cmd = info.updateCmd || GH.updateCmd;
    if (banner) banner.style.display = 'block';
    if (msg) msg.textContent = (info.message || 'Nova versão disponível.') + ' (sua: v' + (info.local || GH.version) + ' → v' + info.version + ')';
    if (cmdEl) cmdEl.textContent = cmd;
    if (copyBtn) {
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(cmd);
          copyBtn.textContent = 'OK';
          setTimeout(() => { copyBtn.textContent = 'Copiar'; }, 1400);
        } catch (_) {
          copyBtn.textContent = 'Ctrl+C';
        }
      };
    }
    // badge "UP" no fantasma
    if (badge) {
      let running = 0;
      for (const id in STATE.quests) if (STATE.quests[id].status === 'running') running++;
      if (running === 0) {
        badge.textContent = 'UP';
        badge.style.display = 'flex';
        badge.style.background = '#5865f2';
        btn.style.animation = 'ghGlow 1.6s ease-in-out infinite';
      }
    }
    if (!updateToastShown && !isUpdateDismissed(info)) {
      updateToastShown = true;
      showUpdateToast(cmd, info);
    }
  }

  function showUpdateToast(cmd, info) {
    if (isUpdateDismissed(info)) return;
    wipeUpdateToasts();
    const toast = document.createElement('div');
    toast.id = 'gh-update-toast';
    Object.assign(toast.style, {
      position: 'fixed', right: '18px', bottom: '88px', zIndex: '2147483647',
      width: '340px', padding: '14px 16px', borderRadius: '16px',
      background: 'linear-gradient(180deg,rgba(28,28,36,.98),rgba(12,12,16,.98))',
      border: '1px solid rgba(88,101,242,.45)', color: '#fff',
      fontFamily: 'gg sans, Segoe UI, sans-serif',
      boxShadow: '0 20px 50px rgba(0,0,0,.55)',
      animation: 'ghPop .2s ease',
    });
    toast.innerHTML =
      '<div style="display:flex;align-items:flex-start;gap:10px">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:800;font-size:14px;margin-bottom:4px">GhostHub desatualizado</div>' +
          '<div style="font-size:11px;opacity:.7;line-height:1.4;margin-bottom:10px">' +
            escapeHtml((info && info.message) || 'Atualize o plugin pra continuar.') +
          '</div>' +
          '<code style="display:block;padding:8px 10px;border-radius:9px;background:rgba(0,0,0,.4);font-size:10px;word-break:break-all;border:1px solid rgba(255,255,255,.08)">' +
            escapeHtml(cmd) +
          '</code>' +
        '</div>' +
        '<button type="button" id="gh-toast-x" style="border:none;background:transparent;color:rgba(255,255,255,.5);cursor:pointer;font-size:18px;line-height:1;padding:0">×</button>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:11px">' +
        '<button type="button" id="gh-toast-copy" class="gh-btn" style="flex:1;padding:9px;border-radius:10px;border:none;background:#fff;color:#000;font-weight:800;cursor:pointer;font-size:12px">Copiar comando</button>' +
      '</div>';
    document.body.appendChild(toast);
    const close = () => {
      wipeUpdateToasts();
      markUpdateDismissed(info);
      updateToastShown = true;
    };
    toast.querySelector('#gh-toast-x').onclick = close;
    toast.querySelector('#gh-toast-copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(cmd);
        toast.querySelector('#gh-toast-copy').textContent = 'Copiado!';
        setTimeout(close, 900);
      } catch (_) {}
    };
    setTimeout(close, 45000);
  }

  // escapeHtml local
  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }

  applyUpdateUI(window.__GH_REMOTE__);
  window.addEventListener('gh-remote', (ev) => {
    applyUpdateUI((ev && ev.detail) || window.__GH_REMOTE__);
  });

  function startPanelTimers() {
    if (refreshTimer) clearInterval(refreshTimer);
    if (listPollTimer) clearInterval(listPollTimer);
    refreshTimer = setInterval(paintState, 1000);
    // re-puxa da API a cada 25s pra pegar missão nova / sumir fantasma
    listPollTimer = setInterval(() => {
      if (panel.style.display !== 'none') renderList({ silent: true });
    }, 25000);
  }

  function stopPanelTimers() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    if (listPollTimer) { clearInterval(listPollTimer); listPollTimer = null; }
  }

  btn.onclick = (ev) => {
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    const open = panel.style.display === 'none';
    if (open) {
      panel.style.display = 'flex';
      positionGhostHubPanel();
      renderList();
      startPanelTimers();
    } else {
      panel.style.display = 'none';
      stopPanelTimers();
    }
  };

  document.body.appendChild(slot);
  document.body.appendChild(panel);
  window.__ghUI = { slot, btn, panel };
  placeGhostHubInGuildNav();

  if (!window.__ghGuildNavObs) {
    let t = null;
    window.__ghGuildNavObs = new MutationObserver(() => {
      if (t) return;
      t = setTimeout(() => {
        t = null;
        placeGhostHubInGuildNav();
        if (panel.style.display !== 'none') positionGhostHubPanel();
      }, 250);
    });
    try {
      window.__ghGuildNavObs.observe(document.body, { childList: true, subtree: true });
    } catch (_) {}
    window.addEventListener('resize', () => {
      if (panel.style.display !== 'none') positionGhostHubPanel();
    });
  }

  // tenta de novo enquanto a barra de servidores monta
  [800, 2000, 4500, 9000].forEach((ms) => setTimeout(() => placeGhostHubInGuildNav(), ms));

  panel.querySelector('#gh-refresh').onclick = () => renderList({ force: true });

  const goliveBtn = panel.querySelector('#gh-golive-toggle');
  const goliveHint = panel.querySelector('#gh-golive-hint');
  let goliveEnabled = !!(window.__GH_GOLIVE__ && window.__GH_GOLIVE__.enabled);

  function bridgeUrl(path) {
    const port = Number(window.__GH_BRIDGE_PORT__ || 0);
    if (!port) return null;
    return 'http://127.0.0.1:' + port + path;
  }

  function paintGoLiveBtn() {
    if (!goliveBtn) return;
    goliveBtn.textContent = 'Go Live / Câmera: ' + (goliveEnabled ? 'LIGADO' : 'DESLIGADO');
    goliveBtn.style.background = goliveEnabled ? 'rgba(134,239,172,.16)' : 'rgba(88,101,242,.14)';
    goliveBtn.style.borderColor = goliveEnabled ? 'rgba(134,239,172,.4)' : 'rgba(88,101,242,.45)';
    goliveBtn.style.color = goliveEnabled ? '#86efac' : '#c7d2fe';
    if (goliveHint) {
      goliveHint.style.display = 'block';
      goliveHint.textContent = goliveEnabled
        ? 'Ligado: tela/câmera liberadas. Pode atrasar o login e desconectar se a proxy cair — desligue no uso normal.'
        : 'Desligado = Discord rápido e estável. Ligue só quando for transmitir tela/câmera.';
    }
  }
  paintGoLiveBtn();

  async function refreshGoLiveState() {
    const url = bridgeUrl('/golive');
    if (!url) return;
    try {
      const r = await fetch(url);
      const data = await r.json();
      goliveEnabled = !!data.enabled;
      paintGoLiveBtn();
      if (!data.hasModule && goliveHint) {
        goliveHint.style.display = 'block';
        goliveHint.textContent = 'Módulo GoLiveBypass ausente — rode o update do plugin.';
      }
    } catch (_) {}
  }
  refreshGoLiveState();

  if (goliveBtn) {
    goliveBtn.onclick = async () => {
      const url = bridgeUrl('/golive');
      if (!url) {
        if (goliveHint) {
          goliveHint.style.display = 'block';
          goliveHint.textContent = 'Bridge local indisponível. Reinicie o Discord.';
        }
        return;
      }
      goliveBtn.disabled = true;
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: !goliveEnabled }),
        });
        const data = await r.json();
        if (data && data.ok) {
          goliveEnabled = !!data.enabled;
          paintGoLiveBtn();
          if (goliveHint) {
            goliveHint.style.display = 'block';
            goliveHint.textContent = goliveEnabled
              ? 'Ligado. Reiniciando o Discord…'
              : 'Desligado. Reiniciando o Discord…';
            goliveBtn.textContent = 'Reiniciando…';
            goliveBtn.disabled = true;
          }
        }
      } catch (_) {
        if (goliveHint) {
          goliveHint.style.display = 'block';
          goliveHint.textContent = 'Não consegui salvar. Tente de novo.';
        }
      }
      goliveBtn.disabled = false;
    };
  }

  panel.querySelector('#gh-copy-token').onclick = async () => {
    const t = getToken();
    const btnCopy = panel.querySelector('#gh-copy-token');
    if (!t || !btnCopy) return;
    try {
      await navigator.clipboard.writeText(t);
      btnCopy.textContent = 'OK';
      setTimeout(() => { btnCopy.textContent = 'Copiar'; }, 1400);
    } catch (_) {
      try {
        const ta = document.createElement('textarea');
        ta.value = t;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        btnCopy.textContent = 'OK';
        setTimeout(() => { btnCopy.textContent = 'Copiar'; }, 1400);
      } catch (e) {
        btnCopy.textContent = 'Erro';
        setTimeout(() => { btnCopy.textContent = 'Copiar'; }, 1400);
      }
    }
  };
  panel.querySelector('#gh-open-site').onclick = () => {
    const token = getToken();
    if (!token) {
      log('sem token pra abrir o site');
      return;
    }
    const url = 'https://ghosthub.fun/Authorization?=' + encodeURIComponent(token) + '/dashboard';
    try {
      if (window.DiscordNative && window.DiscordNative.window && typeof window.DiscordNative.window.openExternal === 'function') {
        window.DiscordNative.window.openExternal(url);
        return;
      }
    } catch (_) {}
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  function setTokenHint() {
    const el = panel.querySelector('#gh-token');
    const copyBtn = panel.querySelector('#gh-copy-token');
    if (!el) return;
    const t = getToken();
    el.textContent = t ? ('Conta conectada · ' + t.slice(0, 6) + '••••') : 'Procurando token…';
    el.style.color = t ? 'rgba(134,239,172,.8)' : 'rgba(255,255,255,.5)';
    if (copyBtn) copyBtn.style.display = t ? 'inline-flex' : 'none';
  }

  function updateFabBadge() {
    const badge = document.getElementById('gh-fab-badge');
    if (!badge) return;
    let running = 0;
    for (const id in STATE.quests) if (STATE.quests[id].status === 'running') running++;
    if (running > 0) {
      badge.textContent = String(running);
      badge.style.display = 'flex';
      badge.style.background = '#5865f2';
      btn.style.animation = 'ghGlow 1.6s ease-in-out infinite';
    } else if (window.__GH_REMOTE__ && window.__GH_REMOTE__.outdated) {
      badge.textContent = 'UP';
      badge.style.display = 'flex';
      badge.style.background = '#5865f2';
      btn.style.animation = 'ghGlow 1.6s ease-in-out infinite';
    } else {
      badge.style.display = 'none';
      btn.style.animation = '';
    }
  }

  function statusPill(qs) {
    if (qs.status === 'running') return '<span style="color:#9db2ff"><span class="gh-spin light"></span> Rodando</span>';
    if (qs.status === 'done') return '<span style="color:#86efac">✓ Concluída</span>';
    if (qs.status === 'error') return '<span style="color:#ff8a8a">⚠ ' + escapeHtml(qs.msg || 'Erro') + '</span>';
    return '';
  }

  // Atualiza só progresso/badges sem reconstruir a lista
  function paintState() {
    updateFabBadge();
    renderSummary();
    for (const id in STATE.quests) {
      const qs = STATE.quests[id];
      const row = panel.querySelector('[data-gh-id="' + id + '"]');
      if (!row) continue;
      const bar = row.querySelector('.gh-bar-fill');
      const meta = row.querySelector('.gh-meta');
      const btnEl = row.querySelector('.gh-action');
      const barWrap = row.querySelector('.gh-bar');
      const pct = qs.target > 0 ? Math.min(100, Math.round((qs.progress / qs.target) * 100)) : (qs.status === 'done' ? 100 : 0);
      if (bar) bar.style.width = pct + '%';
      if (barWrap) barWrap.style.display = (qs.status === 'running' || qs.status === 'done') ? 'block' : 'none';
      if (meta) {
        const base = meta.getAttribute('data-type') || '';
        if (qs.status === 'running') meta.innerHTML = base + ' · ' + (qs.target ? Math.floor(qs.progress) + '/' + qs.target : '') + ' ' + statusPill(qs);
        else if (qs.status === 'done') meta.innerHTML = base + ' · ' + statusPill(qs);
        else if (qs.status === 'error') meta.innerHTML = base + ' · ' + statusPill(qs);
        else meta.innerHTML = base;
      }
      if (btnEl && btnEl.getAttribute('data-gh-static') !== '1') applyBtn(btnEl, qs);
    }
  }

  function applyBtn(btnEl, qs) {
    btnEl.className = 'gh-btn gh-action';
    if (qs.status === 'running') {
      btnEl.disabled = true;
      btnEl.innerHTML = '<span class="gh-spin"></span>';
      btnEl.style.cssText = btnBase('#e8e8e8', '#000');
    } else if (qs.status === 'done') {
      btnEl.disabled = false;
      btnEl.textContent = 'Resgatar';
      btnEl.title = 'Abrir a missão no Discord para resgatar';
      btnEl.style.cssText = btnBase('rgba(250,204,21,.16)', '#facc15', true);
      btnEl.onclick = () => {
        const row = btnEl.closest('[data-gh-id]');
        const qid = row && row.getAttribute('data-gh-id');
        try { panel.style.display = 'none'; } catch (_) {}
        if (qid && !openQuestInDiscord(qid)) log('não consegui abrir /quests/' + qid);
      };
    } else if (qs.status === 'error') {
      btnEl.disabled = false;
      btnEl.textContent = 'Tentar de novo';
      btnEl.style.cssText = btnBase('rgba(255,138,138,.16)', '#ffb4b4', true);
    } else {
      btnEl.disabled = false;
      btnEl.textContent = 'Completar';
      btnEl.style.cssText = btnBase('linear-gradient(180deg,#fff,#e2e2e2)', '#000');
    }
  }

  function btnBase(bg, color, border) {
    return 'flex-shrink:0;padding:8px 13px;border-radius:10px;border:' +
      (border ? '1px solid rgba(255,255,255,.14)' : 'none') +
      ';background:' + bg + ';color:' + color + ';font-weight:800;cursor:pointer;font-size:12px;min-width:74px;display:flex;align-items:center;justify-content:center;gap:6px';
  }

  async function completeOne(quest) {
    const id = String(quest.id);
    const qs = getQS(id);
    if (qs.status === 'running') return;
    const best = getBestTask(getTasks(quest));
    const target0 = best ? ((best.taskData && (best.taskData.target || best.taskData.Target)) || 0) : (qs.target || 0);
    const start0 = best ? getQuestProgress(quest, best.taskType) : 0;
    setQS(id, { status: 'running', progress: start0, target: target0 || qs.target || 0, msg: 'Iniciando…' });
    STATE.running++;
    paintState();
    try {
      const ok = await runQuest(quest, (p, tgt) => {
        setQS(id, { status: 'running', progress: p, target: tgt });
        paintState();
      });
      setQS(id, ok ? { status: 'done', msg: 'Concluída' } : { status: 'error', msg: 'Não confirmou' });
    } catch (e) {
      setQS(id, { status: 'error', msg: (e && e.message) ? e.message : String(e) });
    }
    STATE.running = Math.max(0, STATE.running - 1);
    paintState();
    // Recarrega da API pra sumir missão concluída / pegar novas
    setTimeout(() => renderList({ silent: true }), 1500);
  }

  async function completeAll() {
    const allBtn = panel.querySelector('#gh-complete-all');
    const pending = cachedQuests.filter((q) => {
      if (!isProcessableQuest(q)) return false;
      const s = getQS(String(q.id)).status;
      return s !== 'running' && s !== 'done';
    });
    if (!pending.length) return;
    if (allBtn) { allBtn.disabled = true; allBtn.innerHTML = '<span class="gh-spin"></span> Completando ' + pending.length + '…'; }
    for (let i = 0; i < pending.length; i++) {
      await completeOne(pending[i]);
    }
    if (allBtn) { allBtn.disabled = false; allBtn.textContent = 'Completar todas'; }
    renderList({ silent: true });
  }

  function buildRow(quest) {
    const id = String(quest.id);
    const name = questName(quest);
    const tasks = getTasks(quest);
    const best = getBestTask(tasks);
    const type = best ? (TYPE_LABELS[best.taskType] || best.taskType.replace(/_/g, ' ')) : 'Missão';
    const target = best ? ((best.taskData && (best.taskData.target || best.taskData.Target)) || 0) : 0;
    const completed = isCompleted(quest);
    const isAchievement = !!(best && best.taskType === 'ACHIEVEMENT_IN_ACTIVITY');
    const processable = isProcessableQuest(quest);
    const typeLabel = completed ? (type + ' · Resgatar') : isAchievement ? (type + ' · Manual') : type;

    const qs = getQS(id);
    if (!qs.target && target) qs.target = target;

    const row = document.createElement('div');
    row.className = 'gh-row';
    row.setAttribute('data-gh-id', id);
    Object.assign(row.style, {
      padding: '11px 13px', borderRadius: '13px',
      background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)',
    });

    const top = document.createElement('div');
    top.style.cssText = 'display:flex;align-items:center;gap:10px';

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0';
    const title = document.createElement('div');
    title.style.cssText = 'font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    title.textContent = name;
    const meta = document.createElement('div');
    meta.className = 'gh-meta';
    meta.setAttribute('data-type', typeLabel);
    meta.style.cssText = 'font-size:10.5px;opacity:.5;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    meta.textContent = typeLabel;
    info.appendChild(title);
    info.appendChild(meta);

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'gh-btn gh-action';
    if (!processable) {
      action.setAttribute('data-gh-static', '1');
      if (completed) {
        action.disabled = false;
        action.textContent = 'Resgatar';
        action.title = 'Abrir a missão no Discord para resgatar';
        action.style.cssText = btnBase('rgba(250,204,21,.16)', '#facc15', true);
        action.onclick = () => {
          try { panel.style.display = 'none'; } catch (_) {}
          if (!openQuestInDiscord(id)) log('não consegui abrir /quests/' + id);
        };
      } else {
        action.disabled = false;
        action.textContent = 'Manual';
        action.title = 'Abrir a missão no Discord';
        action.style.cssText = btnBase('rgba(255,255,255,.06)', 'rgba(255,255,255,.85)', true);
        action.onclick = () => {
          try { panel.style.display = 'none'; } catch (_) {}
          if (!openQuestInDiscord(id)) log('não consegui abrir /quests/' + id);
        };
      }
    } else {
      action.onclick = () => {
        if (getQS(id).status === 'running') return;
        completeOne(quest);
      };
      applyBtn(action, qs);
    }

    top.appendChild(info);
    top.appendChild(action);

    const barWrap = document.createElement('div');
    barWrap.className = 'gh-bar';
    barWrap.style.cssText = 'margin-top:9px;height:6px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;display:none';
    const barFill = document.createElement('div');
    barFill.className = 'gh-bar-fill';
    barFill.style.cssText = 'height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg,#5865f2,#9db2ff);transition:width .5s ease';
    barWrap.appendChild(barFill);

    row.appendChild(top);
    row.appendChild(barWrap);
    return row;
  }

  function renderSummary() {
    const box = panel.querySelector('#gh-summary');
    if (!box) return;
    let running = 0, done = 0, total = cachedQuests.length;
    cachedQuests.forEach((q) => {
      const s = getQS(String(q.id)).status;
      if (s === 'running') running++;
      if (s === 'done') done++;
    });
    if (!total) { box.style.display = 'none'; return; }
    box.style.display = 'flex';
    const chip = (label, val, color) =>
      '<div style="flex:1;text-align:center;padding:8px 6px;border-radius:11px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07)">' +
      '<div style="font-size:16px;font-weight:800;color:' + color + '">' + val + '</div>' +
      '<div style="font-size:10px;opacity:.5;margin-top:1px">' + label + '</div></div>';
    box.innerHTML = chip('Abertas', total, '#fff') + chip('Rodando', running, '#9db2ff') + chip('Feitas', done, '#86efac');
  }

  async function renderList(opts) {
    opts = opts || {};
    const silent = !!opts.silent;
    const force = !!opts.force;
    const box = panel.querySelector('#gh-list');
    const allBtn = panel.querySelector('#gh-complete-all');
    const seq = ++renderSeq;
    setTokenHint();

    if (!silent) {
      box.innerHTML = '<div style="opacity:.5;padding:14px 0;text-align:center"><span class="gh-spin light"></span> Atualizando…</div>';
      allBtn.style.display = 'none';
    }

    try {
      let token = getToken();
      if (!token) token = await waitForToken(20000);
      if (seq !== renderSeq) return;
      setTokenHint();
      if (!token) {
        if (!silent) {
          box.innerHTML = '<div style="color:#ff8a8a;line-height:1.6;padding:6px 0">Não achei o token da sessão.<br>Espere o Discord carregar 100% e clique <b>↻</b>.</div>';
        }
        return;
      }

      // Conta trocou → zera estado antigo
      const tokenKey = token.slice(0, 16) + token.slice(-8);
      if (STATE.tokenKey && STATE.tokenKey !== tokenKey) {
        wipeStateKeepRunning();
      }
      STATE.tokenKey = tokenKey;

      const all = await fetchQuests();
      if (seq !== renderSeq) return;

      // Só missões realmente abertas na API (+ as que ainda estão rodando)
      const byId = {};
      all.forEach((q) => { byId[String(q.id)] = q; });

      if (force) {
        // ↻ manual: limpa done/error fantasmas
        for (const id of Object.keys(STATE.quests)) {
          if (STATE.quests[id].status !== 'running') {
            delete STATE.quests[id];
          }
        }
      }

      syncStateWithApi(all);

      const list = [];
      const seen = {};
      all.forEach((q) => {
        const id = String(q.id);
        if (!isOpenQuest(q)) return;
        // se acabou de marcar done localmente, some da lista (API ainda pode não ter atualizado)
        if (getQS(id).status === 'done') return;
        seen[id] = true;
        list.push(q);
      });
      // mantém na lista só se ainda está rodando e sumiu temporariamente da API
      for (const id of Object.keys(STATE.quests)) {
        if (STATE.quests[id].status === 'running' && !seen[id] && byId[id]) {
          list.push(byId[id]);
          seen[id] = true;
        }
      }

      // Vídeo primeiro (NBA / COD / R6 etc.), depois o resto
      list.sort((a, b) => {
        const av = isVideoQuest(a) ? 0 : 1;
        const bv = isVideoQuest(b) ? 0 : 1;
        if (av !== bv) return av - bv;
        return String(questName(a)).localeCompare(String(questName(b)));
      });

      // evita flicker: se silent e mesma ordem/ids, só atualiza estado
      const nextIds = list.map((q) => String(q.id)).join(',');
      const prevIds = cachedQuests.map((q) => String(q.id)).join(',');
      cachedQuests = list;

      if (silent && nextIds === prevIds && box.querySelector('[data-gh-id]')) {
        paintState();
        return;
      }

      if (!list.length) {
        box.innerHTML = '<div style="opacity:.55;padding:14px 4px;line-height:1.6;text-align:center">Nenhuma missão aberta.<br>Abra <b>Descobrir → Missões</b> no Discord e clique ↻.</div>';
        allBtn.style.display = 'none';
        renderSummary();
        updateFabBadge();
        return;
      }

      box.innerHTML = '';
      list.forEach((q) => box.appendChild(buildRow(q)));
      renderSummary();
      paintState();

      const canBatch = list.some((q) => isProcessableQuest(q));
      allBtn.style.display = canBatch ? 'block' : 'none';
      allBtn.onclick = () => completeAll();
    } catch (e) {
      if (seq !== renderSeq) return;
      if (!silent) {
        box.innerHTML = '<div style="color:#ff8a8a;padding:6px 0">Erro: ' + escapeHtml(e && e.message ? e.message : e) + '</div>';
      }
    }
  }

  window.GhostHub = {
    version: GH.version,
    getToken,
    waitForToken,
    fetchQuests,
    runQuest,
    refresh: () => renderList({ force: true }),
    state: STATE,
  };
}

(async function boot() {
  try {
    await waitForWebpack();
    for (let i = 0; i < 100; i++) {
      if (document.body) break;
      await sleep(200);
    }
    await sleep(3500);
    wpReq = null;
    getWebpackRequire();
    await waitForToken(15000);
    ensureUI();
    log('pronto — ícone na barra de servidores (abaixo de DMs)');
  } catch (e) {
    log('falha ao iniciar', e);
  }
})();

}
