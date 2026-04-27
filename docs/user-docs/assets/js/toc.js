(function () {
  var toc = document.querySelector('.toc');
  if (!toc) return;
  var article = document.querySelector('main article');
  if (!article) return;

  var nodes = article.querySelectorAll('h1, h2[id], h3[id]');
  // Ensure the page H1 has an id so it can be linked; if missing, synthesize one.
  var headings = [];
  nodes.forEach(function (h) {
    if (h.tagName === 'H1' && !h.id) h.id = 'top';
    if (h.id) headings.push(h);
  });
  if (headings.length < 2) {
    toc.style.display = 'none';
    return;
  }

  var label = document.createElement('p');
  label.className = 'toc-label';
  label.textContent = 'On this page';
  toc.appendChild(label);

  var ul = document.createElement('ul');
  var links = [];
  headings.forEach(function (h) {
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = '#' + h.id;
    a.textContent = h.textContent;
    a.className = 'toc-' + h.tagName.toLowerCase();
    li.appendChild(a);
    ul.appendChild(li);
    links.push({ link: a, heading: h });
  });
  toc.appendChild(ul);

  var byId = {};
  links.forEach(function (p) {
    byId[p.heading.id] = p.link;
  });

  function setActive(id) {
    links.forEach(function (p) {
      p.link.classList.toggle('active', p.heading.id === id);
    });
  }

  var observer = new IntersectionObserver(function (entries) {
    // Find the first heading above the viewport's top 30%
    var visible = entries
      .filter(function (e) { return e.isIntersecting; })
      .sort(function (a, b) { return a.target.offsetTop - b.target.offsetTop; });
    if (visible.length) {
      setActive(visible[0].target.id);
    }
  }, {
    rootMargin: '-72px 0px -70% 0px',
    threshold: 0
  });

  headings.forEach(function (h) { observer.observe(h); });

  // On load: activate the first heading (or the one matching the URL hash)
  if (location.hash && byId[location.hash.slice(1)]) {
    setActive(location.hash.slice(1));
  } else if (headings.length) {
    setActive(headings[0].id);
  }
})();
