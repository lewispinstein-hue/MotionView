let sidebarVersion = '2026-09-07-sidebar-tree-v4';
let sidebarTreeState = {};
let sidebarSearchContent = {};
let sidebarSearchRequest = 0;

function getSiteBasePath() {
  return window.location.hostname.endsWith('github.io') ? '/MotionView/' : '/';
}

try {
  if (localStorage.getItem('motionview-docs-sidebar-version') !== sidebarVersion) {
    localStorage.removeItem('motionview-docs-sidebar-tree');
    localStorage.setItem('motionview-docs-sidebar-version', sidebarVersion);
  }
} catch (error) {
  // Ignore storage failures so the docs still load in restricted contexts.
}

function getSidebarItemLabel(item) {
  let labelElement = Array.prototype.find.call(item.children, function (child) {
    return child.classList.contains('sidebar-tree-label') || ['A', 'P', 'STRONG'].indexOf(child.tagName) !== -1;
  });

  if (labelElement) {
    return labelElement.textContent.trim();
  }

  return Array.prototype.filter.call(item.childNodes, function (node) {
    return node.nodeType === Node.TEXT_NODE;
  }).map(function (node) {
    return node.textContent.trim();
  }).join(' ').trim();
}

function getDirectSidebarLink(item) {
  return item.querySelector(':scope > a, :scope > p > a');
}

function ensureSidebarTreeLabel(item) {
  if (item.querySelector(':scope > .sidebar-tree-label, :scope > p, :scope > strong')) {
    return;
  }

  let labelNodes = Array.prototype.filter.call(item.childNodes, function (node) {
    return node.nodeType === Node.TEXT_NODE && node.textContent.trim();
  });

  if (!labelNodes.length) {
    return;
  }

  let label = document.createElement('span');
  label.className = 'sidebar-tree-label';
  label.textContent = labelNodes.map(function (node) {
    return node.textContent.trim();
  }).join(' ');

  item.insertBefore(label, labelNodes[0]);

  labelNodes.forEach(function (node) {
    item.removeChild(node);
  });
}

function normalizeDocsPath(path) {
  return (path || '')
    .replace(/^#\/?/, '')
    .replace(/^\//, '')
    .replace(/\?.*$/, '')
    .replace(/\.md$/, '')
    .toLowerCase();
}

function normalizeDocsRoute(path) {
  return (path || '')
    .replace(/^#\/?/, '')
    .replace(new RegExp('^' + getSiteBasePath().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '')
    .replace(/^\//, '')
    .replace(/\.md(?=\?|$)/, '')
    .toLowerCase();
}

function isCurrentSidebarLink(link) {
  let currentRoute = window.location.hash
    ? window.location.hash
    : window.location.pathname + window.location.search;

  return normalizeDocsRoute(link.getAttribute('href')) === normalizeDocsRoute(currentRoute);
}

function getSidebarItemKey(item) {
  let labels = [];
  let currentItem = item;

  while (currentItem && currentItem.matches && currentItem.matches('.sidebar-nav li')) {
    let label = getSidebarItemLabel(currentItem);

    if (label) {
      labels.unshift(label);
    }

    currentItem = currentItem.parentElement.closest('li');
  }

  return labels.join(' / ');
}

function captureSidebarTreeState() {
  document.querySelectorAll('.sidebar-tree-item, .sidebar-file-item').forEach(function (item) {
    let itemKey = item.dataset.sidebarTreeKey;

    if (itemKey) {
      sidebarTreeState[itemKey] = item.classList.contains('sidebar-outline-collapsed');
    }
  });
}

function markCurrentSidebarLink() {
  document.querySelectorAll('.sidebar-nav a').forEach(function (link) {
    let item = link.closest('li');
    let isCurrent = isCurrentSidebarLink(link);

    link.classList.toggle('active', isCurrent);

    if (item) {
      item.classList.toggle('active', isCurrent);

      if (isCurrent) {
        let ancestor = item.parentElement.closest('li');

        while (ancestor) {
          let ancestorKey = ancestor.dataset.sidebarTreeKey;
          ancestor.classList.remove('sidebar-outline-collapsed');

          if (ancestorKey) {
            sidebarTreeState[ancestorKey] = false;
          }

          let ancestorToggle = ancestor.querySelector(':scope > .sidebar-tree-toggle');
          if (ancestorToggle) {
            ancestorToggle.textContent = '▾';
            ancestorToggle.setAttribute('aria-expanded', 'true');
            ancestorToggle.setAttribute('aria-label', 'Collapse section');
          }

          ancestor = ancestor.parentElement.closest('li');
        }
      }
    }
  });
}

function rewriteProjectPageLinks() {
  let basePath = getSiteBasePath();

  if (basePath === '/') {
    return;
  }

  document.querySelectorAll('.sidebar-nav a').forEach(function (link) {
    let href = link.getAttribute('href');

    if (!href || href.startsWith('http') || href.startsWith(basePath)) {
      return;
    }

    if (href.startsWith('/')) {
      link.setAttribute('href', basePath.replace(/\/$/, '') + href);
    }
  });
}

function getDocsRoute(path) {
  let basePath = getSiteBasePath();

  return basePath === '/'
    ? path
    : basePath.replace(/\/$/, '') + path;
}

function getMarkdownPath(link) {
  let href = link.getAttribute('href') || '';
  let basePath = getSiteBasePath();

  if (!href || /^(https?:)?\/\//.test(href)) {
    return null;
  }

  href = href.replace(/^#\/?/, '').replace(/[?#].*$/, '');

  if (basePath !== '/' && href.indexOf(basePath) === 0) {
    href = href.slice(basePath.length);
  }

  href = href.replace(/^\/+/, '').replace(/\.md$/, '');

  return getDocsRoute('/' + href + '.md');
}

function countReferences(content, query) {
  let normalizedContent = (content || '').toLowerCase();
  let normalizedQuery = query.toLowerCase();
  let startIndex = 0;
  let count = 0;
  let matchIndex;

  while ((matchIndex = normalizedContent.indexOf(normalizedQuery, startIndex)) !== -1) {
    count += 1;
    startIndex = matchIndex + normalizedQuery.length;
  }

  return count;
}

function clearDocumentSearchHighlights() {
  document.querySelectorAll('.sidebar-document-match').forEach(function (match) {
    let parent = match.parentNode;
    parent.replaceChild(document.createTextNode(match.textContent), match);
    parent.normalize();
  });
}

function highlightDocumentSearchResults(query) {
  clearDocumentSearchHighlights();

  if (!query) {
    return;
  }

  let article = document.querySelector('.markdown-section');

  if (!article) {
    return;
  }

  let matchingNodes = [];
  let walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
    acceptNode: function (node) {
      let parent = node.parentElement;

      if (!node.nodeValue.trim() || !parent || parent.closest('script, style, mark.sidebar-document-match')) {
        return NodeFilter.FILTER_REJECT;
      }

      return node.nodeValue.toLowerCase().indexOf(query.toLowerCase()) !== -1
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    }
  });

  while (walker.nextNode()) {
    matchingNodes.push(walker.currentNode);
  }

  matchingNodes.forEach(function (node) {
    let text = node.nodeValue;
    let lowerText = text.toLowerCase();
    let lowerQuery = query.toLowerCase();
    let fragment = document.createDocumentFragment();
    let startIndex = 0;
    let matchIndex;

    while ((matchIndex = lowerText.indexOf(lowerQuery, startIndex)) !== -1) {
      fragment.appendChild(document.createTextNode(text.slice(startIndex, matchIndex)));

      let mark = document.createElement('mark');
      mark.className = 'sidebar-document-match';
      mark.textContent = text.slice(matchIndex, matchIndex + query.length);
      fragment.appendChild(mark);
      startIndex = matchIndex + query.length;
    }

    fragment.appendChild(document.createTextNode(text.slice(startIndex)));
    node.parentNode.replaceChild(fragment, node);
  });
}

function clearSidebarSearchResults() {
  document.querySelectorAll('.sidebar-nav li').forEach(function (item) {
    item.classList.remove('sidebar-search-hidden', 'sidebar-search-expanded');
  });

  document.querySelectorAll('.sidebar-nav a[data-sidebar-search-label]').forEach(function (link) {
    link.textContent = link.dataset.sidebarSearchLabel;
    delete link.dataset.sidebarSearchLabel;
  });

  clearDocumentSearchHighlights();
}

function applySidebarSearchResults(query, results) {
  let resultItems = new Map();

  document.querySelectorAll('.sidebar-nav a').forEach(function (link) {
    let item = link.closest('li');
    let result = results.get(link);

    if (!item || !result) {
      return;
    }

    link.dataset.sidebarSearchLabel = result.label;
    link.textContent = result.count + ' ' + (result.count === 1 ? 'reference' : 'references') + ' found in ' + result.label;
    resultItems.set(item, result.count);
  });

  Array.prototype.slice.call(document.querySelectorAll('.sidebar-nav li')).reverse().forEach(function (item) {
    let childItems = Array.prototype.slice.call(item.querySelectorAll(':scope > ul > li'));
    let hasMatchingChild = childItems.some(function (child) {
      return !child.classList.contains('sidebar-search-hidden');
    });
    let hasResults = resultItems.has(item) || hasMatchingChild;

    item.classList.toggle('sidebar-search-hidden', !hasResults);
    item.classList.toggle('sidebar-search-expanded', hasMatchingChild);
  });

  highlightDocumentSearchResults(query);
}

function searchSidebar(query) {
  let normalizedQuery = query.trim();
  let requestId = ++sidebarSearchRequest;

  clearSidebarSearchResults();

  if (!normalizedQuery) {
    return;
  }

  let links = Array.prototype.slice.call(document.querySelectorAll('.sidebar-nav a'));

  Promise.all(links.map(function (link) {
    let label = link.textContent.trim();
    let markdownPath = getMarkdownPath(link);

    if (!markdownPath) {
      return Promise.resolve({ link: link, label: label, content: '' });
    }

    if (sidebarSearchContent[markdownPath]) {
      return Promise.resolve({ link: link, label: label, content: sidebarSearchContent[markdownPath] });
    }

    return fetch(markdownPath).then(function (response) {
      return response.ok ? response.text() : '';
    }).catch(function () {
      return '';
    }).then(function (content) {
      sidebarSearchContent[markdownPath] = content;
      return { link: link, label: label, content: content };
    });
  })).then(function (documents) {
    if (requestId !== sidebarSearchRequest) {
      return;
    }

    let results = new Map();
    let currentArticle = document.querySelector('.markdown-section');

    documents.forEach(function (documentInfo) {
      let content = documentInfo.content;

      if (isCurrentSidebarLink(documentInfo.link) && currentArticle) {
        content = currentArticle.innerText;
      }

      let count = countReferences(content, normalizedQuery);

      if (count) {
        results.set(documentInfo.link, {
          count: count,
          label: documentInfo.label
        });
      }
    });

    clearSidebarSearchResults();
    applySidebarSearchResults(normalizedQuery, results);
  });
}

function enhanceSidebarHeader() {
  let existingHeader = document.querySelector('.site-topbar');

  if (existingHeader) {
    return existingHeader;
  }

  let header = document.createElement('div');
  header.className = 'site-topbar';
  header.innerHTML = [
    '<div class="site-topbar-main">',
    '  <label class="sidebar-search-field">',
    '    <span class="sidebar-search-icon" aria-hidden="true"></span>',
    '    <input type="search" class="sidebar-search-input" placeholder="Search docs" aria-label="Search documentation">',
    '  </label>',
    '</div>',
    '<nav class="sidebar-quick-links" aria-label="Quick links">',
    '  <a href="https://github.com/lewispinstein-hue/MotionView/releases">Download <svg class="quick-link-export-icon" viewBox="0 0 90 90" aria-hidden="true"><path d="M85 35.661c-2.762 0-5-2.239-5-5V10H59.339c-2.762 0-5-2.239-5-5s2.238-5 5-5H85c2.762 0 5 2.239 5 5v25.661c0 2.761-2.238 5-5 5z"/><path d="M33.678 61.322c-1.28 0-2.559-.488-3.536-1.465-1.953-1.952-1.953-5.118 0-7.07L81.465 1.464c1.951-1.952 5.119-1.952 7.07 0 1.953 1.953 1.953 5.119 0 7.071L37.214 59.857c-.977.977-2.256 1.465-3.536 1.465z"/><path d="M74.394 90H15.606C7.001 90 0 82.999 0 74.394V15.606C0 7.001 7.001 0 15.606 0h18.072c2.761 0 5 2.239 5 5s-2.239 5-5 5H15.606C12.515 10 10 12.515 10 15.606v58.787C10 77.485 12.515 80 15.606 80h58.787C77.485 80 80 77.485 80 74.394V56.322c0-2.762 2.238-5 5-5s5 2.238 5 5v18.071C90 82.999 82.999 90 74.394 90z"/></svg></a>',
    '  <a href="https://github.com/lewispinstein-hue/MotionView/issues">Issues <svg class="quick-link-export-icon" viewBox="0 0 90 90" aria-hidden="true"><path d="M85 35.661c-2.762 0-5-2.239-5-5V10H59.339c-2.762 0-5-2.239-5-5s2.238-5 5-5H85c2.762 0 5 2.239 5 5v25.661c0 2.761-2.238 5-5 5z"/><path d="M33.678 61.322c-1.28 0-2.559-.488-3.536-1.465-1.953-1.952-1.953-5.118 0-7.07L81.465 1.464c1.951-1.952 5.119-1.952 7.07 0 1.953 1.953 1.953 5.119 0 7.071L37.214 59.857c-.977.977-2.256 1.465-3.536 1.465z"/><path d="M74.394 90H15.606C7.001 90 0 82.999 0 74.394V15.606C0 7.001 7.001 0 15.606 0h18.072c2.761 0 5 2.239 5 5s-2.239 5-5 5H15.606C12.515 10 10 12.515 10 15.606v58.787C10 77.485 12.515 80 15.606 80h58.787C77.485 80 80 77.485 80 74.394V56.322c0-2.762 2.238-5 5-5s5 2.238 5 5v18.071C90 82.999 82.999 90 74.394 90z"/></svg></a>',
    '</nav>',
    '<a class="sidebar-github-link" href="https://github.com/lewispinstein-hue/MotionView" aria-label="Open MotionView on GitHub" title="GitHub">',
    '  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.49 0-.24-.01-1.04-.01-1.89-2.78.62-3.37-1.2-3.37-1.2-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .07 1.53 1.05 1.53 1.05.9 1.57 2.35 1.12 2.92.85.09-.67.35-1.12.64-1.38-2.22-.26-4.56-1.15-4.56-5.11 0-1.13.39-2.05 1.04-2.77-.1-.26-.45-1.31.1-2.73 0 0 .85-.28 2.75 1.06A9.35 9.35 0 0 1 12 6.8c.85 0 1.7.12 2.5.34 1.9-1.34 2.75-1.06 2.75-1.06.55 1.42.2 2.47.1 2.73.65.72 1.04 1.64 1.04 2.77 0 3.97-2.35 4.84-4.58 5.1.36.32.68.93.68 1.88 0 1.36-.01 2.46-.01 2.8 0 .27.18.6.69.49A10.24 10.24 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z"/></svg>',
    '</a>'
  ].join('');

  document.body.insertBefore(header, document.body.firstChild);

  header.querySelector('.sidebar-search-input').addEventListener('input', function (event) {
    searchSidebar(event.target.value);
  });

  return header;
}

function enhanceSidebarTree() {
  let storageKey = 'motionview-docs-sidebar-tree';
  let storedState = sidebarTreeState;

  try {
    storedState = Object.assign(
      {},
      JSON.parse(localStorage.getItem(storageKey) || '{}'),
      sidebarTreeState
    );
    sidebarTreeState = storedState;
  } catch (error) {
    storedState = sidebarTreeState;
  }

  function saveState() {
    sidebarTreeState = storedState;

    try {
      localStorage.setItem(storageKey, JSON.stringify(storedState));
    } catch (error) {
      // Ignore storage failures so navigation still works in restricted contexts.
    }
  }

  function setOutlineState(item, isCollapsed) {
    item.classList.toggle('sidebar-outline-collapsed', isCollapsed);
  }

  function setToggleState(item, toggle, isCollapsed) {
    setOutlineState(item, isCollapsed);

    if (toggle) {
      toggle.textContent = isCollapsed ? '▸' : '▾';
      toggle.setAttribute('aria-expanded', String(!isCollapsed));
      toggle.setAttribute(
        'aria-label',
        isCollapsed ? 'Expand section' : 'Collapse section'
      );
    }
  }

  document.querySelectorAll('.sidebar-nav li').forEach(function (item) {
    let childList = Array.prototype.find.call(item.children, function (child) {
      return child.tagName === 'UL';
    });
    let directLink = getDirectSidebarLink(item);

    if (!childList) {
      return;
    }

    let itemKey = getSidebarItemKey(item);
    let isTopLevelItem = !item.parentElement.closest('li');
    let isCollapsed = storedState[itemKey] !== undefined
      ? storedState[itemKey]
      : !isTopLevelItem;

    item.dataset.sidebarTreeKey = itemKey;

    if (directLink) {
      item.classList.add('sidebar-file-item');
      setOutlineState(item, isCollapsed);

      directLink.addEventListener('click', function (event) {
        if (item.classList.contains('active') || directLink.classList.contains('active') || isCurrentSidebarLink(directLink)) {
          event.preventDefault();
          event.stopPropagation();
          let nextCollapsedState = !item.classList.contains('sidebar-outline-collapsed');
          storedState[itemKey] = nextCollapsedState;
          setOutlineState(item, nextCollapsedState);
          saveState();
        }
      });

      return;
    }

    if (item.querySelector(':scope > .sidebar-tree-toggle')) {
      return;
    }

    item.classList.add('sidebar-tree-item');
    ensureSidebarTreeLabel(item);

    if (isTopLevelItem) {
      item.classList.add('sidebar-product-section');
      item.classList.add(getSidebarItemLabel(item) === 'MVLib'
        ? 'sidebar-product-mvlib'
        : 'sidebar-product-motionview');
    }

    let toggle = document.createElement('button');
    toggle.className = 'sidebar-tree-toggle';
    toggle.type = 'button';
    setToggleState(item, toggle, isCollapsed);

    item.addEventListener('click', function (event) {
      if (event.target.closest('.sidebar-nav li') !== item) {
        return;
      }

      if (event.target.closest('.sidebar-tree-toggle') || event.target.closest('a')) {
        return;
      }

      let nextCollapsedState = !item.classList.contains('sidebar-outline-collapsed');
      storedState[itemKey] = nextCollapsedState;
      setToggleState(item, toggle, nextCollapsedState);
      saveState();
    });

    toggle.addEventListener('click', function (event) {
      let nextCollapsedState = !item.classList.contains('sidebar-outline-collapsed');
      storedState[itemKey] = nextCollapsedState;
      setToggleState(item, toggle, nextCollapsedState);
      saveState();
      event.preventDefault();
      event.stopPropagation();
    });

    item.insertBefore(toggle, item.firstChild);
  });
}

document.addEventListener('click', function (event) {
  let sidebarLink = event.target.closest('.sidebar-nav a');

  if (sidebarLink) {
    let sidebarItem = sidebarLink.closest('li');
    let directLink = sidebarItem ? getDirectSidebarLink(sidebarItem) : null;
    let childList = sidebarItem ? sidebarItem.querySelector(':scope > ul') : null;

    if (sidebarItem && childList && directLink === sidebarLink && isCurrentSidebarLink(sidebarLink)) {
      event.preventDefault();
      event.stopPropagation();
      let nextCollapsedState = !sidebarItem.classList.contains('sidebar-outline-collapsed');
      sidebarItem.classList.toggle('sidebar-outline-collapsed', nextCollapsedState);
      sidebarTreeState[getSidebarItemKey(sidebarItem)] = nextCollapsedState;
    }

    captureSidebarTreeState();
  }
}, true);

function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }

  let textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand('copy');
    return Promise.resolve();
  } catch (error) {
    return Promise.reject(error);
  } finally {
    document.body.removeChild(textarea);
  }
}

function enhanceCodeBlocks() {
  document.querySelectorAll('.markdown-section pre').forEach(function (block) {
    let code = block.querySelector('code');

    if (!code || block.querySelector(':scope > .code-copy-button')) {
      return;
    }

    let button = document.createElement('button');
    button.className = 'code-copy-button';
    button.type = 'button';
    button.setAttribute('aria-label', 'Copy code to clipboard');
    button.innerHTML = [
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">',
      '<rect x="7" y="5" width="10" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/>',
      '<rect x="4" y="8" width="10" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/>',
      '</svg>'
    ].join('');

    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();

      copyTextToClipboard(code.innerText).then(function () {
        button.classList.add('code-copy-button-copied');
        button.setAttribute('aria-label', 'Copied');
        button.textContent = '✓';

        window.setTimeout(function () {
          button.classList.remove('code-copy-button-copied');
          button.setAttribute('aria-label', 'Copy code to clipboard');
          button.innerHTML = [
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">',
            '<rect x="7" y="5" width="10" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/>',
            '<rect x="4" y="8" width="10" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/>',
            '</svg>'
          ].join('');
        }, 1200);
      }).catch(function () {
        button.setAttribute('aria-label', 'Copy failed');
      });
    });

    block.appendChild(button);
  });
}

window.$docsify = {
  name: 'MotionView Docs',
  repo: 'lewispinstein-hue/MotionView',
  routerMode: 'history',
  loadSidebar: '_sidebar.md?v=2026-09-07-sidebar-tree-v4',
  alias: {
    '/': '/Home.md',
    '/README': '/Home.md',
    '/README.md': '/Home.md',
    '/.*/README': '/Home.md',
    '/.*/README.md': '/Home.md',
    '/.*/_sidebar.md': '/_sidebar.md?v=2026-09-07-sidebar-tree-v4'
  },
  subMaxLevel: 0,
  auto2top: true,
  homepage: '/Home.md',
  plugins: [
    function (hook) {
      hook.beforeEach(function (content, next) {
        captureSidebarTreeState();
        next(content);
      });

      hook.doneEach(function () {
        requestAnimationFrame(function () {
          enhanceSidebarTree();
          rewriteProjectPageLinks();
          markCurrentSidebarLink();
          let sidebarHeader = enhanceSidebarHeader();

          if (sidebarHeader) {
            searchSidebar(sidebarHeader.querySelector('.sidebar-search-input').value);
          }
          enhanceCodeBlocks();
        });
      });
    }
  ]
};
