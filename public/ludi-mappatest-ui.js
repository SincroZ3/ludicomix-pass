/* ludi-mappatest-ui.js — adatta la barra comandi di /admin/mappatest alla zona attiva.
   - Edificio, Tetti sala, Tetti bassi e Trasparenza (comandi del modello del Palazzetto) si vedono solo nella zona Palazzetto.
   - Nella zona Mariambini i comandi "Ambiente 3D" prendono il loro posto dentro la barra. */
(function () {
  const OLD = ['bld', 'rf', 'rfl', 'trn'];
  const zone = () => { const b = document.querySelector('#zt .ztab.active'); return b && b.firstChild ? String(b.firstChild.textContent).trim().toLowerCase() : ''; };
  const lab = id => { const e = document.getElementById(id); return e ? e.closest('label') : null; };
  function sync() {
    const pal = zone() === 'palazzetto';
    OLD.forEach(id => { const l = lab(id); if (l) l.style.display = pal ? '' : 'none'; });
    const vw = document.getElementById('vw'); if (!vw) return;
    const p = Array.from(vw.children).find(d => d.firstChild && d.firstChild.textContent === 'Ambiente 3D');
    const ref = lab('bld');
    if (!p || !ref || p.dataset.moved) return;
    p.dataset.moved = '1'; p.style.cssText = 'display:contents';
    Array.from(p.children).forEach(c => {
      if (c.tagName === 'LABEL') { c.className = 'mt-chk'; c.style.cssText = ''; c.querySelectorAll('input[type=range]').forEach(i => { i.style.width = ''; }); }
      else c.style.display = 'none';
    });
    ref.parentNode.insertBefore(p, ref);
  }
  setInterval(sync, 250);
})();
