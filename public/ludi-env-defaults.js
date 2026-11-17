/* ludi-env-defaults.js - valori iniziali dei pannelli "Ambiente 3D".
   Vanvere: tetti e muri partono al 50% di trasparenza (e un edificio, senza trasparenza non si vedrebbe nulla all'interno).
   Si applica una sola volta per pannello: poi il cursore resta nelle mani dell'utente. */
(function () {
  function fix() {
    [].forEach.call(document.querySelectorAll('input[data-k="tr"]'), function (r) {
      var p = r.closest('div');
      if (!p || p.__d50) return;
      if ((p.textContent || '').indexOf('Vialetto verso il Mariambini') < 0) return;
      p.__d50 = 1;
      r.value = '50';
      r.dispatchEvent(new Event('input'));
    });
  }
  try {
    new MutationObserver(fix).observe(document.body, { childList: true, subtree: true });
    fix();
  } catch (e) { /* nessun valore iniziale */ }
})();
