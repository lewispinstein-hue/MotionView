var sidebarTreeState = {};

function getSidebarItemLabel(item) {
  var labelElement = Array.prototype.find.call(item.children, function (child) {
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

function getSidebarItemKey(item) {
  var labels = [];
  var currentItem = item;

  while (currentItem && currentItem.matches && currentItem.matches('.sidebar-nav li')) {
    var label = getSidebarItemLabel(currentItem);

    if (label) {
      labels.unshift(label);
    }

    currentItem = currentItem.parentElement.closest('li');
  }

  return labels.join(' / ');
}

function captureSidebarTreeState() {
  document.querySelectorAll('.sidebar-tree-item').forEach(function (item) {
    var itemKey = item.dataset.sidebarTreeKey;

    if (itemKey) {
      sidebarTreeState[itemKey] = item.classList.contains('sidebar-tree-collapsed');
    }
  });
}

function enhanceSidebarTree() {
  var storageKey = 'motionview-docs-sidebar-tree';
  var storedState = sidebarTreeState;

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

  function setToggleState(item, toggle, isCollapsed) {
    item.classList.toggle('sidebar-tree-collapsed', isCollapsed);
    toggle.textContent = isCollapsed ? '▸' : '▾';
    toggle.setAttribute('aria-expanded', String(!isCollapsed));
    toggle.setAttribute(
      'aria-label',
      isCollapsed ? 'Expand section' : 'Collapse section'
    );
  }

  document.querySelectorAll('.sidebar-nav li').forEach(function (item) {
    var childList = Array.prototype.find.call(item.children, function (child) {
      return child.tagName === 'UL';
    });

    if (!childList || item.querySelector(':scope > .sidebar-tree-toggle')) {
      return;
    }

    item.classList.add('sidebar-tree-item');

    var toggle = document.createElement('button');
    toggle.className = 'sidebar-tree-toggle';
    toggle.type = 'button';
    var itemKey = getSidebarItemKey(item);
    var isCollapsed = storedState[itemKey] !== undefined
      ? storedState[itemKey]
      : true;

    item.dataset.sidebarTreeKey = itemKey;
    setToggleState(item, toggle, isCollapsed);

    toggle.addEventListener('click', function (event) {
      var nextCollapsedState = !item.classList.contains('sidebar-tree-collapsed');
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
  if (event.target.closest('.sidebar-nav a')) {
    captureSidebarTreeState();
  }
}, true);

window.$docsify = {
  name: 'MotionView Docs',
  repo: 'lewispinstein-hue/MotionView',
  loadSidebar: true,
  alias: {
    '/.*/_sidebar.md': '/_sidebar.md'
  },
  subMaxLevel: 3,
  auto2top: true,
  homepage: 'Home.md',
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
        requestAnimationFrame(enhanceSidebarTree);
      });
    }
  ]
};
