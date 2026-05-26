let sidebarVersion = '2026-05-26-filetree-v2';
let sidebarTreeState = {};

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
    return ['A', 'P', 'STRONG'].indexOf(child.tagName) !== -1;
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

  document.querySelectorAll('.sidebar-nav a, .search a').forEach(function (link) {
    let href = link.getAttribute('href');

    if (!href || href.startsWith('http') || href.startsWith(basePath)) {
      return;
    }

    if (href.startsWith('/')) {
      link.setAttribute('href', basePath.replace(/\/$/, '') + href);
    }
  });
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
    let isCollapsed = storedState[itemKey] !== undefined
      ? storedState[itemKey]
      : true;

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

    let toggle = document.createElement('button');
    toggle.className = 'sidebar-tree-toggle';
    toggle.type = 'button';
    setToggleState(item, toggle, isCollapsed);

    item.addEventListener('click', function (event) {
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
  loadSidebar: '_sidebar.md?v=2026-05-26-filetree-v2',
  alias: {
    '/': '/Home.md',
    '/README': '/Home.md',
    '/README.md': '/Home.md',
    '/.*/README': '/Home.md',
    '/.*/README.md': '/Home.md',
    '/.*/_sidebar.md': '/_sidebar.md?v=2026-05-26-filetree-v2'
  },
  subMaxLevel: 0,
  auto2top: true,
  homepage: '/Home.md',
  search: {
    maxAge: 86400000,
    paths: 'auto',
    placeholder: 'Search docs',
    noData: 'No results'
  },
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
          enhanceCodeBlocks();
        });
      });
    }
  ]
};
