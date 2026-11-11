// Behaviour for the frozen Savanna pages.
//
// The application's own JavaScript is not shipped: the markup in these pages is the DOM React
// left behind. What lives here is the small amount of behaviour needed to make the page usable
// offline — the sidebar toggle, the week strip, the "My activities" tabs — reimplemented against
// content that was pre-rendered at capture time and parked in <template> elements.
//
// It deliberately adds no ARIA and no keyboard handling the application does not already have:
// these pages are a reference for accessibility work, so they must show the application's real
// accessibility, defects included. The hamburger below is a plain <div> with a click handler in
// the live app, and stays one here.
//
// Everything else interactive is Bootstrap's own (dropdowns, modals, accordions, collapse,
// tooltips); the bundle beside this file handles those, and only its data-attribute widgets need
// an explicit init.

(() => {
  'use strict';

  // ---------------------------------------------------------------- sidebar

  // Mirrors SidebarToggle.tsx: the only thing the hamburger ever did was flip a body class,
  // remembered per browser.
  const SIDEBAR_KEY = 'sidebar-collapsed';

  function readCollapsed() {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === 'true';
    } catch {
      return false;
    }
  }

  function writeCollapsed(collapsed) {
    try {
      localStorage.setItem(SIDEBAR_KEY, String(collapsed));
    } catch {
      /* private window or blocked storage — the toggle still works for this page view */
    }
  }

  function setupSidebar() {
    const hamburger = document.querySelector('.hamburger');
    if (!hamburger) return;

    const sidebar = document.getElementById('sidebar') || document.querySelector('.sidebar');

    // Two things move together, as in the live app: the body class, which the application's own
    // stylesheet uses for the content offset, and `expanded` on the sidebar, which carries its
    // width. The labels are handled by static-page.css.
    const apply = (collapsed) => {
      document.body.classList.toggle('sidebar-collapsed', collapsed);
      if (sidebar) sidebar.classList.toggle('expanded', !collapsed);
    };
    apply(readCollapsed() || window.innerWidth < 768);

    hamburger.addEventListener('click', () => {
      const collapsed = !document.body.classList.contains('sidebar-collapsed');
      apply(collapsed);
      writeCollapsed(collapsed);
    });
  }

  // --------------------------------------------------------- curriculum bar

  // Mirrors CurrentCurriculumScrollBehavior.tsx: the bar is fixed under the header, so the
  // content below it is padded by exactly its height, and it slides away on scroll down.
  function setupCurriculumBar() {
    const bar = document.getElementById('student-current-curriculum');
    const layoutBars = document.getElementById('layout-bars');
    if (!bar || !layoutBars) return;

    const HIDDEN = 'current-curriculum-hidden';
    const THRESHOLD = 5;
    let barHeight = bar.offsetHeight;
    let lastScrollY = window.scrollY;

    const resize = () => {
      barHeight = bar.offsetHeight;
      layoutBars.style.paddingTop = `${barHeight}px`;
    };
    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(bar);

    window.addEventListener('scroll', () => {
      const scrollY = window.scrollY;
      const delta = scrollY - lastScrollY;

      if (scrollY <= 0) {
        bar.classList.remove(HIDDEN);
        lastScrollY = scrollY;
        return;
      }
      if (Math.abs(delta) < THRESHOLD) return;

      if (delta > 0 && scrollY > barHeight) bar.classList.add(HIDDEN);
      else if (delta < 0) bar.classList.remove(HIDDEN);

      lastScrollY = scrollY;
    }, { passive: true });
  }

  // ------------------------------------------------------- collapsible sections

  // The programme modal's courses and modules are React accordions. The capture opened each one
  // so its content exists in the markup and paired every toggle with the element it controls.
  function setupCollapsibles() {
    document.querySelectorAll('[data-static-collapse-toggle]').forEach((toggle) => {
      const body = document.querySelector(`[data-static-collapse-body="${toggle.dataset.staticCollapseToggle}"]`);
      if (!body) return;

      toggle.addEventListener('click', () => {
        const open = body.hidden;
        body.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        toggle.querySelectorAll('.fa-angle-up, .fa-angle-down').forEach((icon) => {
          icon.classList.toggle('fa-angle-up', open);
          icon.classList.toggle('fa-angle-down', !open);
        });
      });
    });
  }

  // --------------------------------------------------------------- week strip

  // Reimplements app/components/homepage/navigation/index.js: keep the selected week in view and
  // let the chevrons page through the strip.
  function setupScrollRegion(region) {
    const scroller = region.querySelector('nav');
    const items = [...region.querySelectorAll('.scroll-region__item')];
    const previous = region.querySelector('.scroll-region__previous');
    const next = region.querySelector('.scroll-region__next');
    if (!scroller || !items.length) return;

    const scrollTo = (item) => item && item.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });

    const refresh = () => {
      const padding = parseInt(getComputedStyle(scroller).paddingInlineStart, 10) || 0;
      const fits = scroller.clientWidth + 2 * padding > scroller.scrollWidth;
      if (previous) previous.style.visibility = fits || scroller.scrollLeft - padding <= 0 ? 'hidden' : 'visible';
      if (next) {
        const atEnd = scroller.scrollLeft + scroller.clientWidth > scroller.scrollWidth - padding;
        next.style.visibility = fits || atEnd ? 'hidden' : 'visible';
      }
    };

    const visibleIndexes = () => {
      const box = scroller.getBoundingClientRect();
      const left = box.left + 80;
      const right = box.right - 80;
      return items
        .map((item, index) => {
          const rect = item.getBoundingClientRect();
          const shown = (rect.left >= left && rect.right <= right)
            || (rect.left < left && rect.right > left)
            || (rect.left < right && rect.right > right);
          return shown ? index : null;
        })
        .filter((index) => index !== null);
    };

    if (next) {
      next.addEventListener('click', () => {
        const shown = visibleIndexes();
        scrollTo(items[Math.min(Math.max(...shown), items.length - 2) + 1]);
      });
    }
    if (previous) {
      previous.addEventListener('click', () => {
        const shown = visibleIndexes();
        scrollTo(items[Math.max(Math.min(...shown), 2) - 2]);
      });
    }
    scroller.addEventListener('scroll', refresh);
    window.addEventListener('resize', refresh);

    scrollTo(items.find((item) => item.classList.contains('active')) || items[0]);
    refresh();
  }

  // Each week was a server round trip in the live app; here every panel was rendered at capture
  // time and sits in #static-track-store.
  function setupTrackTabs() {
    const host = document.getElementById('static-track-host');
    const store = document.getElementById('static-track-store');
    if (!host || !store) return;

    // A week's score-details dialog lives at the end of <body>, not inside its panel, so it is
    // swapped in alongside — otherwise the trigger would point at a dialog from another week.
    const modalHost = document.getElementById('static-track-modals');
    const modalStore = document.getElementById('static-track-modal-store');

    const links = [...document.querySelectorAll('.homepage-nav .nav-link[data-track-id]')];

    links.forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const panel = store.querySelector(`template[data-track-panel="${link.dataset.trackId}"]`);
        if (!panel) return;

        host.replaceChildren(panel.content.cloneNode(true));
        if (modalHost && modalStore) {
          const dialogs = modalStore.querySelector(`template[data-track-modals="${link.dataset.trackId}"]`);
          modalHost.replaceChildren(dialogs ? dialogs.content.cloneNode(true) : '');
        }
        links.forEach((other) => {
          const selected = other === link;
          other.classList.toggle('active', selected);
          other.classList.toggle('fw-semibold', selected);
          if (selected) other.setAttribute('aria-current', 'page');
          else other.removeAttribute('aria-current');
        });
        link.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        initBootstrapWidgets(host);
      });
    });
  }

  // ------------------------------------------------------------ my activities

  // Mirrors HomepageSelfPacedActivities.tsx: picking a module swaps the panel beside the list.
  function setupActivitySections() {
    const host = document.querySelector('[data-section-host]');
    const store = document.getElementById('static-section-store');
    if (!host || !store) return;

    const buttons = [...document.querySelectorAll('button[data-section-index]')];
    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const panel = store.querySelector(`template[data-section-panel="${button.dataset.sectionIndex}"]`);
        if (!panel) return;

        host.replaceChildren(panel.content.cloneNode(true));
        buttons.forEach((other) => {
          const selected = other === button;
          other.classList.toggle('fw-medium', selected);
          other.classList.toggle('bg-light', selected);
          other.classList.toggle('fw-light', !selected);
        });
        initBootstrapWidgets(host);
      });
    });
  }

  // ------------------------------------------------------------------- boot

  // Dropdowns, modals, accordions and collapse are delegated at document level by Bootstrap, so
  // they survive a panel swap on their own; tooltips and popovers have to be constructed.
  function initBootstrapWidgets(root) {
    if (!window.bootstrap) return;
    root.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((el) => {
      if (!bootstrap.Tooltip.getInstance(el)) new bootstrap.Tooltip(el);
    });
    root.querySelectorAll('[data-bs-toggle="popover"]').forEach((el) => {
      if (!bootstrap.Popover.getInstance(el)) new bootstrap.Popover(el);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupSidebar();
    setupCurriculumBar();
    document.querySelectorAll('.scroll-region').forEach(setupScrollRegion);
    setupTrackTabs();
    setupActivitySections();
    setupCollapsibles();
    initBootstrapWidgets(document);
  });
})();
