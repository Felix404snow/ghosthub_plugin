/**
 * GhostHub — Discord desktop inject (main process)
 * Seguro: não tenta injetar em janela/splash já destruída.
 * Checa versão no site (Node https — sem CSP do renderer).
 */
'use strict';

if (global.__ghosthubMain) {
  module.exports = {};
} else {
  global.__ghosthubMain = true;

  const fs = require('fs');
  const path = require('path');
  const https = require('https');
  const http = require('http');

  const rendererPath = path.join(__dirname, 'renderer.js');
  const logoPath = path.join(__dirname, 'logo.png');
  const settingsPath = path.join(__dirname, 'settings.json');
  const golivePath = path.join(__dirname, 'golivebypass.js');
  const VERSION_URL = process.env.GH_VERSION_URL || 'https://ghosthub.fun/plugin/version.json';

  let RENDERER = '';
  let LOGO_DATA = '';
  let LOCAL_VERSION = '0.0.0';
  let BRIDGE_PORT = 0;
  /** @type {null|{version:string,message?:string,updateCmd?:string,outdated:boolean}} */
  let REMOTE = null;

  function readSettings() {
    try {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (_) {
      return { enabled: false, routeMode: 'auto', excludedCountries: 'BR' };
    }
  }

  function writeSettings(patch) {
    const cur = Object.assign({}, readSettings(), patch || {});
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(cur, null, 4));
    } catch (e) {
      console.error('[GhostHub] settings', e && e.message ? e.message : e);
    }
    return cur;
  }

  function loadGoLiveModule() {
    try {
      if (!fs.existsSync(golivePath)) return null;
      return require(golivePath);
    } catch (e) {
      console.warn('[GhostHub] golivebypass load', e && e.message ? e.message : e);
      return null;
    }
  }

  function readJsonBody(req, limit) {
    limit = limit || 200000;
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > limit) {
          try { req.destroy(); } catch (_) {}
          reject(new Error('body too large'));
        }
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(body || '{}'));
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  }

  function startBridge() {
    try {
      const server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }
        const url = String(req.url || '').split('?')[0];
        if (url === '/golive' && req.method === 'GET') {
          const s = readSettings();
          let exit = null;
          try {
            const gl = loadGoLiveModule();
            if (gl && typeof gl.getApiExit === 'function') exit = gl.getApiExit();
            else if (gl && typeof gl.poolStatus === 'function') {
              const st = gl.poolStatus();
              exit = st && st.active ? st.active : null;
            }
          } catch (_) {}
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            enabled: s.enabled === true,
            routeMode: s.routeMode || 'auto',
            hasModule: fs.existsSync(golivePath),
            apiExit: exit ? String(exit).replace(/\/\/.*@/, '//***@') : null,
          }));
          return;
        }
        if (url === '/golive' && req.method === 'POST') {
          readJsonBody(req, 2000).then((data) => {
            const next = writeSettings({ enabled: !!data.enabled });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: true,
              enabled: next.enabled === true,
              needsRestart: true,
              restarting: true,
            }));
            restartDiscordSoon();
          }).catch((e) => {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
          });
          return;
        }
        // Missões: Discord API saindo pela mesma proxy do Go Live
        if (url === '/quest-api' && req.method === 'POST') {
          readJsonBody(req, 200000).then(async (data) => {
            const gl = loadGoLiveModule();
            if (!gl || typeof gl.discordApiViaProxy !== 'function') {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, status: 0, error: 'GoLiveBypass ausente', text: 'módulo ausente' }));
              return;
            }
            const path = String(data.path || '');
            if (!path || path.length > 300 || !path.includes('/quests/')) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, status: 0, error: 'path inválido', text: 'só /quests/*' }));
              return;
            }
            const result = await gl.discordApiViaProxy({
              method: data.method || 'POST',
              path,
              token: data.token,
              body: data.body,
              headers: data.headers,
              timeoutMs: 20000,
            });
            console.log('[GhostHub] quest-api', path, '→', result.status, result.via ? ('via ' + result.via) : 'sem saida');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          }).catch((e) => {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, status: 0, error: String(e && e.message ? e.message : e) }));
          });
          return;
        }
        if (url === '/quest-proxy-status' && req.method === 'GET') {
          try {
            const gl = loadGoLiveModule();
            const exit = gl && typeof gl.getApiExit === 'function' ? gl.getApiExit() : null;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: true,
              ready: !!exit,
              via: exit ? String(exit).replace(/\/\/.*@/, '//***@') : null,
            }));
          } catch (e) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, ready: false, error: String(e && e.message ? e.message : e) }));
          }
          return;
        }
        res.writeHead(404);
        res.end();
      });
      server.listen(0, '127.0.0.1', () => {
        try {
          BRIDGE_PORT = server.address().port;
          console.log('[GhostHub] bridge local :' + BRIDGE_PORT);
        } catch (_) {}
      });
    } catch (e) {
      console.warn('[GhostHub] bridge falhou', e && e.message ? e.message : e);
    }
  }

  function restartDiscordSoon() {
    if (global.__ghRestarting) return;
    global.__ghRestarting = true;
    console.log('[GhostHub] reiniciando Discord em 1.2s…');
    setTimeout(() => {
      try {
        const { app } = require('electron');
        app.relaunch();
        app.exit(0);
      } catch (e) {
        console.error('[GhostHub] falha ao reiniciar', e && e.message ? e.message : e);
        global.__ghRestarting = false;
      }
    }, 1200);
  }

  function startGoLiveIfEnabled() {
    try {
      const s = readSettings();
      if (s.enabled !== true) {
        console.log('[GhostHub] GoLiveBypass desligado');
        return;
      }
      if (!fs.existsSync(golivePath)) {
        console.warn('[GhostHub] golivebypass.js ausente');
        return;
      }
      console.log('[GhostHub] iniciando GoLiveBypass…');
      require(golivePath);
    } catch (e) {
      console.error('[GhostHub] GoLiveBypass falhou', e && e.message ? e.message : e);
    }
  }

  try {
    RENDERER = fs.readFileSync(rendererPath, 'utf8');
    const m = RENDERER.match(/version:\s*['"]([\d.]+)['"]/);
    if (m) LOCAL_VERSION = m[1];
  } catch (e) {
    console.error('[GhostHub] renderer.js ausente', e.message);
  }
  try {
    if (fs.existsSync(logoPath)) {
      LOGO_DATA = 'data:image/png;base64,' + fs.readFileSync(logoPath).toString('base64');
    }
  } catch (_) {}

  function cmpVer(a, b) {
    const pa = String(a || '0').split(/[^\d]+/).map((n) => parseInt(n, 10) || 0);
    const pb = String(b || '0').split(/[^\d]+/).map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  }

  function alive(win) {
    try {
      return !!(win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed());
    } catch (_) {
      return false;
    }
  }

  function isSplash(win) {
    try {
      const t = String(win.getTitle() || '').toLowerCase();
      const url = win.webContents.getURL() || '';
      if (!url || url === 'about:blank') return true;
      if (url.includes('splash') || url.includes('updating')) return true;
      if (t === 'discord' && !url.includes('discord.com')) return true;
      return false;
    } catch (_) {
      return true;
    }
  }

  function buildCode() {
    const remoteJson = JSON.stringify(REMOTE);
    const settings = readSettings();
    return (
      'window.__GH_LOGO__=' + JSON.stringify(LOGO_DATA) + ';' +
      'window.__GH_LOCAL_VERSION__=' + JSON.stringify(LOCAL_VERSION) + ';' +
      'window.__GH_REMOTE__=' + remoteJson + ';' +
      'window.__GH_BRIDGE_PORT__=' + JSON.stringify(BRIDGE_PORT) + ';' +
      'window.__GH_GOLIVE__=' + JSON.stringify({
        enabled: settings.enabled === true,
        hasModule: fs.existsSync(golivePath),
      }) + ';' +
      'try{(0,eval)(' + JSON.stringify(RENDERER) + ');}catch(e){console.error("[GhostHub]",e);}' +
      (REMOTE && REMOTE.outdated
        ? ';try{window.dispatchEvent(new CustomEvent("gh-remote",{detail:window.__GH_REMOTE__}));}catch(_e){}'
        : '')
    );
  }

  function pushRemoteToWindows() {
    if (!REMOTE || !REMOTE.outdated) return;
    try {
      const { BrowserWindow } = require('electron');
      const payload = JSON.stringify(REMOTE);
      // Um único toast (#gh-update-toast). Se o renderer já carregou, só dispara o evento.
      const js = `(function(){
        window.__GH_REMOTE__=${payload};
        try{window.dispatchEvent(new CustomEvent("gh-remote",{detail:window.__GH_REMOTE__}));}catch(e){}
        try{
          var info=window.__GH_REMOTE__;
          if(!info||!info.outdated)return;
          function wipe(){
            document.querySelectorAll("#gh-update-toast,#gh-force-update-toast").forEach(function(el){try{el.remove();}catch(_){}});
          }
          // Renderer novo cuida do toast — evita sobreposição
          if(window.__ghosthubUI)return;
          var dismissed=false;
          try{dismissed=sessionStorage.getItem("gh-update-dismissed")===String(info.version);}catch(_){}
          if(dismissed)return;
          if(document.getElementById("gh-update-toast"))return;
          wipe();
          var cmd=info.updateCmd||'irm "https://ghosthub.fun/update-plugin.ps1" | iex';
          var toast=document.createElement("div");
          toast.id="gh-update-toast";
          toast.style.cssText="position:fixed;right:18px;bottom:88px;z-index:2147483647;width:340px;padding:14px 16px;border-radius:16px;background:linear-gradient(180deg,rgba(28,28,36,.98),rgba(12,12,16,.98));border:1px solid rgba(88,101,242,.45);color:#fff;font-family:gg sans,Segoe UI,sans-serif;box-shadow:0 20px 50px rgba(0,0,0,.55)";
          toast.innerHTML='<div style="display:flex;align-items:flex-start;gap:10px">'
            +'<div style="flex:1;min-width:0">'
            +'<div style="font-weight:800;font-size:14px;margin-bottom:6px">GhostHub desatualizado</div>'
            +'<div id="gh-toast-msg" style="font-size:11px;opacity:.75;line-height:1.4;margin-bottom:10px"></div>'
            +'<code style="display:block;padding:8px 10px;border-radius:9px;background:rgba(0,0,0,.4);font-size:10px;word-break:break-all;border:1px solid rgba(255,255,255,.08)"></code>'
            +'</div>'
            +'<button type="button" id="gh-toast-x" style="border:none;background:transparent;color:rgba(255,255,255,.5);cursor:pointer;font-size:18px;line-height:1;padding:0">×</button>'
            +'</div>'
            +'<button type="button" id="gh-force-copy" style="margin-top:11px;width:100%;padding:9px;border-radius:10px;border:none;background:#fff;color:#000;font-weight:800;cursor:pointer;font-size:12px">Copiar comando de update</button>';
          toast.querySelector("#gh-toast-msg").textContent=(info.message||"Atualize o plugin.")+" (v"+(info.local||"?")+" → v"+info.version+")";
          toast.querySelector("code").textContent=cmd;
          function close(){
            wipe();
            try{sessionStorage.setItem("gh-update-dismissed",String(info.version));}catch(_){}
          }
          document.body.appendChild(toast);
          toast.querySelector("#gh-toast-x").onclick=close;
          toast.querySelector("#gh-force-copy").onclick=function(){
            if(navigator.clipboard&&navigator.clipboard.writeText){
              navigator.clipboard.writeText(cmd).then(function(){
                toast.querySelector("#gh-force-copy").textContent="Copiado!";
                setTimeout(close,900);
              });
            }
          };
        }catch(e){console.error("[GhostHub] toast update",e);}
      })();`;
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!alive(win) || isSplash(win)) return;
        try {
          win.webContents.executeJavaScript(js).catch(() => {});
        } catch (_) {}
      });
    } catch (_) {}
  }

  function fetchJson(url) {
    return new Promise((resolve, reject) => {
      const lib = url.startsWith('https') ? https : http;
      const full = url + (url.includes('?') ? '&' : '?') + '_=' + Date.now();
      const req = lib.get(full, {
        timeout: 15000,
        headers: {
          'User-Agent': 'GhostHub-Plugin/1.0',
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
        },
      }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchJson(res.headers.location).then(resolve, reject);
          res.resume();
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error('HTTP ' + res.statusCode));
          res.resume();
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        try { req.destroy(); } catch (_) {}
        reject(new Error('timeout'));
      });
    });
  }

  async function checkVersion() {
    try {
      const data = await fetchJson(VERSION_URL);
      const remoteVer = String((data && data.version) || '');
      if (!remoteVer) return;
      const outdated = cmpVer(LOCAL_VERSION, remoteVer) < 0;
      REMOTE = {
        version: remoteVer,
        local: LOCAL_VERSION,
        outdated,
        message: (data && data.message) || 'Nova versão do GhostHub disponível.',
        updateCmd: (data && data.updateCmd) || 'irm "https://ghosthub.fun/update-plugin.ps1" | iex',
      };
      console.log('[GhostHub] versao local=' + LOCAL_VERSION + ' remota=' + remoteVer + (outdated ? ' (DESATUALIZADO)' : ' (ok)'));
      if (outdated) {
        pushRemoteToWindows();
        // tenta de novo depois do Discord carregar a UI
        setTimeout(() => pushRemoteToWindows(), 8000);
        setTimeout(() => pushRemoteToWindows(), 20000);
      }
    } catch (e) {
      console.warn('[GhostHub] check versao falhou:', e && e.message ? e.message : e);
    }
  }

  function runInject(win) {
    if (!RENDERER || !alive(win)) return;
    if (isSplash(win)) return;
    try {
      const code = buildCode();
      win.webContents.executeJavaScript(code).catch(() => {});
    } catch (_) {}
  }

  function inject(win) {
    if (!alive(win) || !RENDERER) return;

    const timers = [];
    const schedule = (ms) => {
      const id = setTimeout(() => {
        if (!alive(win)) return;
        runInject(win);
      }, ms);
      timers.push(id);
    };

    const onReady = () => {
      if (!alive(win)) return;
      schedule(1500);
      schedule(4000);
      schedule(9000);
    };

    try {
      win.webContents.on('dom-ready', () => {
        if (!alive(win) || isSplash(win)) return;
        schedule(800);
        schedule(2500);
      });
      win.webContents.on('did-finish-load', () => {
        if (!alive(win) || isSplash(win)) return;
        schedule(500);
        schedule(3000);
      });
      win.on('closed', () => {
        timers.forEach((t) => clearTimeout(t));
      });
      if (!isSplash(win)) onReady();
    } catch (_) {}
  }

  try {
    const electron = require('electron');
    const { app, BrowserWindow } = electron;

    const boot = () => {
      try {
        startBridge();
        startGoLiveIfEnabled();
      } catch (_) {}
      try {
        BrowserWindow.getAllWindows().forEach(inject);
      } catch (_) {}
      app.on('browser-window-created', (_e, win) => {
        setTimeout(() => {
          try { inject(win); } catch (_) {}
        }, 500);
      });
      // checa na abertura (cedo + de novo) e a cada 20 min
      setTimeout(() => { checkVersion(); }, 2500);
      setTimeout(() => { checkVersion(); }, 15000);
      setInterval(() => { checkVersion(); }, 20 * 60 * 1000);
      console.log('[GhostHub] main hook ativo · v' + LOCAL_VERSION);
    };

    if (app.isReady()) boot();
    else app.whenReady().then(boot);
  } catch (e) {
    console.error('[GhostHub] falha no main hook', e);
  }

  module.exports = {};
}
