(function () {
  var overlay;
  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-hidden', 'true');
    var img = document.createElement('img');
    img.alt = '';
    overlay.appendChild(img);
    overlay.addEventListener('click', close);
    document.body.appendChild(overlay);
    return overlay;
  }
  function open(src, alt) {
    var ov = ensureOverlay();
    var img = ov.querySelector('img');
    img.src = src;
    img.alt = alt || '';
    ov.classList.add('open');
    ov.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function close() {
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  document.addEventListener('click', function (e) {
    var target = e.target;
    if (!target || !target.closest) return;
    var img = target.closest('.figure img');
    if (!img) return;
    e.preventDefault();
    open(img.currentSrc || img.src, img.alt);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });
})();
