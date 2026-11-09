/* ludi-group-2.js — passo 2: icone a linea nelle sezioni richiudibili. Solo estetica. */
(function(){
  var pane = document.getElementById('tab-pass');
  if(!pane || pane.getAttribute('data-lg2')) return;
  pane.setAttribute('data-lg2','1');
  var P = {
    pencil:'<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
    note:'<path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h8M8 17h4"/>',
    gauge:'<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/>',
    plus:'<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'
  };
  function ico(n){
    var s = document.createElement('span'); s.className = 'lg-ico'; s.style.marginRight = '.1rem';
    s.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">'+P[n]+'</svg>'; return s;
  }
  function pick(t){
    t = t.toLowerCase();
    if(t.indexOf('modifica dati') > -1) return 'pencil';
    if(t.indexOf('note ed email') > -1) return 'note';
    if(t.indexOf('limite') > -1) return 'gauge';
    if(t.indexOf('aggiungi') > -1) return 'plus';
    return null;
  }
  [].forEach.call(pane.querySelectorAll(':scope > details > summary'), function(s){
    var n = s.firstChild, key = pick(s.textContent);
    if(!key) return;
    if(n && n.nodeType === 3) n.nodeValue = n.nodeValue.replace(/^[^A-Za-zÀ-ÿ]+/, '');
    s.insertBefore(ico(key), s.firstChild);
  });
  var add = pane.querySelector('button[onclick^="avviaBulk"]');
  if(add && add.firstChild && add.firstChild.nodeType === 3){
    add.firstChild.nodeValue = add.firstChild.nodeValue.replace(/^[^A-Za-zÀ-ÿ]+/, '');
    add.insertBefore(ico('plus'), add.firstChild);
  }
})();
