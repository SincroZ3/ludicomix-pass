/**
 * routes/map3d-pubstyle.js
 * Mappa pubblica (/mappa-pubblica): stesso stile del resto del portale (header viola sfumato, tasti tondi bianchi con icone viola,
 * menu delle zone con testata viola, filtri e schede nei toni del viola).
 * Solo grafica: non cambia markup, script, dati ne funzioni della pagina. Il foglio di stile viene aggiunto alla pagina mentre
 * viene inviata (come per il portale espositore), sia con la mappa pubblica migrata sia con quella vecchia.
 * Per disattivare: togliere la riga che carica questo file in routes/map3d-portal.js.
 */
module.exports = function registerMap3dPubStyle(app) {
  // registra una rotta e la sposta davanti alla prima rotta con lo stesso percorso (le rotte esistenti rispondono per prime)
  function inFront(register, path) {
    const stack = app._router && app._router.stack;
    const before = stack ? stack.length : 0;
    register();
    if (!stack) return;
    const mine = stack.splice(before);
    const idx = stack.findIndex((l) => (l.route && l.route.path === path) ||
      (l.name === 'router' && l.handle && l.handle.stack && l.handle.stack.some((s) => s.route && s.route.path === path)));
    if (idx >= 0) stack.splice(idx, 0, ...mine); else stack.push(...mine);
  }

  const css = `<style id="pubmap-style">
body{background:#3b1f66}
body .map-header{padding:.7rem 1rem 1.6rem;background:linear-gradient(to bottom,rgba(59,31,102,.98) 0%,rgba(91,52,150,.93) 52%,rgba(107,63,160,0) 100%)}
body .header-logo img{filter:drop-shadow(0 3px 8px rgba(20,8,48,.5))}
body .btn-hamburger{width:46px;height:46px;border-radius:50%;background:rgba(255,255,255,.96);border:1.5px solid #d9cff0;box-shadow:0 4px 14px rgba(59,31,102,.22)}
body .btn-hamburger:active{background:#f1ecfa}
body .btn-hamburger svg{stroke:#4c2c78}
body .desktop-nav a{background:rgba(255,255,255,.16);border:1.5px solid rgba(255,255,255,.62);color:#fff;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
body .desktop-nav a:hover{background:rgba(255,255,255,.3)}
body .desktop-nav a.active-nav{background:#fff;color:#4c2c78;border-color:#fff}
body .fab-group{gap:10px}
body .fab{width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,.96);border:1.5px solid #d9cff0;color:#4c2c78;box-shadow:0 4px 14px rgba(59,31,102,.22)}
body .fab svg{stroke:#4c2c78}
body .fab:active{background:#f1ecfa}
body .fab.fab-nav{background:#6b3fa0;border-color:#6b3fa0}
body .fab.fab-nav svg{stroke:#fff}
body .fab.fab-nav:active{background:#5b2e8b}
body .zoom-group{gap:10px}
body .zoom-btn{width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.96);border:1.5px solid #d9cff0;color:#4c2c78;font-weight:400;box-shadow:0 4px 14px rgba(59,31,102,.22)}
body .zoom-btn:active{background:#f1ecfa}
body .drawer-overlay{background:rgba(30,10,60,.38)}
body .drawer{border-radius:22px 0 0 22px;box-shadow:-8px 0 34px rgba(30,10,60,.28)}
body .drawer-header{background:linear-gradient(135deg,#5b3496,#8b5cf6);padding:.95rem 1.1rem .8rem}
body .drawer-title{font-weight:900;letter-spacing:.04em}
body .drawer-close{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.18);border:1.5px solid rgba(255,255,255,.55)}
body .drawer-search{border-bottom:1px solid #ece6f7}
body .drawer-search input{border:1.5px solid #d9cff0;border-radius:999px;background-color:#f6f3fb;padding:.55rem 1rem .55rem 2.1rem;font-weight:600;color:#2b1d4d}
body .drawer-search input:focus{border-color:#8b5cf6;box-shadow:0 0 0 3px rgba(139,92,246,.18)}
body .filter-strip{border-bottom:1px solid #ece6f7}
body .ftab{border:1.5px solid #d9cff0;background:#f6f3fb;color:#4c2c78}
body .ftab.active{background:#6b3fa0;color:#fff;border-color:#6b3fa0}
body .zone-item{border-bottom:0;border-radius:12px;margin:.1rem .4rem}
body .zone-item:active,body .zone-item:hover{background:#f1ecfa}
body .zone-item.active{background:#f1ecfa;border-left:3px solid #6b3fa0}
body .zone-name,body .sheet-title,body .popup-title{color:#2b1d4d}
body .zone-tag,body .sheet-tag,body .popup-tag{background:#ece6f7;color:#4c2c78}
body .bottom-sheet,body .nav-sheet{box-shadow:0 -8px 34px rgba(30,10,60,.28)}
body .sheet-handle,body .nav-sheet-handle{background:#d9cff0}
body .nav-link{background:#f6f3fb;border-radius:14px;color:#2b1d4d}
body .nav-link:active{background:#ece6f7}
body .nav-link.active-nav{background:#6b3fa0;color:#fff}
body .btn-directions,body .btn-directions-sm{background:#6b3fa0;border-radius:999px;box-shadow:0 4px 12px rgba(107,63,160,.35)}
body .btn-directions:active,body .btn-directions-sm:hover{background:#5b2e8b}
body .leaflet-popup-content-wrapper{border-radius:18px}
</style>`;

  inFront(() => {
    app.get('/mappa-pubblica', (req, res, next) => {
      const render = res.render.bind(res);
      res.render = (view, opts, cb) => {
        if (typeof opts === 'function') { cb = opts; opts = undefined; }
        if (view !== 'agenda/public_map') return render(view, opts || {}, cb);
        return render(view, opts || {}, (err, html) => {
          if (err) { if (cb) return cb(err); return next(err); }
          let out = html;
          try { out = out.includes('</head>') ? out.replace('</head>', () => css + '</head>') : css + out; } catch (_) { out = html; }
          if (cb) return cb(null, out);
          res.send(out);
        });
      };
      next();
    });
  }, '/mappa-pubblica');
};
