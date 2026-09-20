document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".site-nav");

  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      nav.classList.toggle("open");
    });
  }

  // Every page is an index.html in its own folder, so compare full paths, not
  // just the file name.
  const pagePath = (path) => path.replace(/index\.html$/, "");
  const here = pagePath(location.pathname);
  document.querySelectorAll(".nav-main a").forEach((link) => {
    if (pagePath(new URL(link.href).pathname) === here) link.classList.add("active");
  });

  let lastViewerTrigger = null;

  // An inline reader (.doc-scroll) and the overlay it opens show the same pages
  // at different widths, so the reading position is carried across as a
  // fraction of scrollable distance rather than as a pixel offset. The page
  // images carry width/height attributes, so both scrollers know their full
  // height before the images have decoded and the fraction is correct on the
  // first frame.
  function carryScrollPosition(from, to) {
    if (!from || !to) return;
    const fromMax = from.scrollHeight - from.clientHeight;
    const toMax = to.scrollHeight - to.clientHeight;
    if (fromMax <= 0 || toMax <= 0) return;
    to.scrollTop = (from.scrollTop / fromMax) * toMax;
  }

  function openViewer(overlay, trigger) {
    lastViewerTrigger = trigger || null;
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("viewer-open");

    if (trigger && trigger.classList.contains("doc-scroll")) {
      carryScrollPosition(trigger, overlay.querySelector(".ppt-viewer-scroll"));
    }

    const closeBtn = overlay.querySelector(".ppt-viewer-close");
    if (closeBtn) closeBtn.focus({ preventScroll: true });
  }

  function closeViewer(overlay) {
    if (lastViewerTrigger && lastViewerTrigger.classList.contains("doc-scroll")) {
      carryScrollPosition(overlay.querySelector(".ppt-viewer-scroll"), lastViewerTrigger);
    }

    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("viewer-open");
    if (lastViewerTrigger) lastViewerTrigger.focus({ preventScroll: true });
  }

  document.querySelectorAll("[data-viewer-open]").forEach((trigger) => {
    const open = () => {
      const overlay = document.getElementById(trigger.getAttribute("data-viewer-open"));
      if (overlay) openViewer(overlay, trigger);
    };
    trigger.addEventListener("click", open);

    // Triggers that are not buttons (the inline manual reader) need Enter wired
    // up by hand. Space is left alone so it still scrolls the reader.
    if (trigger.tagName !== "BUTTON") {
      trigger.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        open();
      });
    }
  });

  document.querySelectorAll(".ppt-viewer-overlay").forEach((overlay) => {
    overlay.querySelectorAll("[data-viewer-close]").forEach((el) => {
      el.addEventListener("click", () => closeViewer(overlay));
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const openOverlay = document.querySelector(".ppt-viewer-overlay.is-open");
    if (openOverlay) closeViewer(openOverlay);
  });

  // Keep a project's title flush under the header after jumping to it. Images
  // and the 3D model viewer above the target keep loading after the jump and
  // push it down the page, so re-snap on every page-height change until the
  // visitor scrolls on their own (or things have had time to settle). The snap
  // is "instant" because html has scroll-behavior: smooth, and a smooth
  // correction gets cut short by the next layout shift.
  const userScrollEvents = ["wheel", "touchstart", "keydown", "mousedown"];
  let releasePin = null;

  function pinToTarget(target) {
    if (releasePin) releasePin();
    const snap = () => target.scrollIntoView({ behavior: "instant", block: "start" });
    snap();

    const observer = new ResizeObserver(snap);
    observer.observe(document.body);
    const timer = setTimeout(() => releasePin && releasePin(), 8000);

    releasePin = () => {
      observer.disconnect();
      clearTimeout(timer);
      userScrollEvents.forEach((ev) => window.removeEventListener(ev, releasePin));
      releasePin = null;
    };
    userScrollEvents.forEach((ev) => window.addEventListener(ev, releasePin, { passive: true }));
  }

  if (location.hash.length > 1) {
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) pinToTarget(target);
  }

  // Delegated on document, rather than bound per-link, so links added after
  // this runs — the project sidenav, built from the DOM a little further
  // down — get the same smooth-scroll-and-pin behaviour for free.
  document.addEventListener("click", (e) => {
    const link = e.target.closest('a[href*="#"]');
    if (!link) return;
    let url;
    try {
      url = new URL(link.getAttribute("href"), location.href);
    } catch (err) {
      return;
    }
    if (url.pathname !== location.pathname || !url.hash) return;
    const target = document.getElementById(url.hash.slice(1));
    if (!target) return;
    e.preventDefault();
    history.pushState(null, "", url.hash);
    if (releasePin) releasePin();
    target.scrollIntoView({ behavior: "smooth", block: "start" });

    // Content can shift during the smooth scroll, so lock on once it ends,
    // unless the visitor took over the scroll in the meantime.
    let interrupted = false;
    const interrupt = () => { interrupted = true; };
    userScrollEvents.forEach((ev) => window.addEventListener(ev, interrupt, { once: true, passive: true }));
    const lockOn = () => {
      userScrollEvents.forEach((ev) => window.removeEventListener(ev, interrupt));
      if (!interrupted) pinToTarget(target);
    };
    if ("onscrollend" in window) {
      window.addEventListener("scrollend", lockOn, { once: true });
    } else {
      setTimeout(lockOn, 1000);
    }
  });

  // The season plan marks the step the programme is on. Each step carries the
  // date it starts, so the marker walks down the list with the calendar rather
  // than going stale between edits. The markup ships with the first step
  // marked, which is what shows if scripting is off.
  document.querySelectorAll(".roadmap").forEach((list) => {
    const steps = Array.from(list.querySelectorAll("li[data-from]"));
    if (!steps.length) return;

    const now = Date.now();
    let current = null;
    steps.forEach((step) => {
      const from = Date.parse(step.dataset.from);
      if (!Number.isNaN(from) && from <= now) current = step;
    });
    if (!current) return;

    steps.forEach((step) => {
      step.classList.remove("is-current");
      const marker = step.querySelector(".roadmap-now");
      if (marker) marker.remove();
    });

    current.classList.add("is-current");
    const when = current.querySelector(".roadmap-when");
    if (when) {
      const marker = document.createElement("span");
      marker.className = "roadmap-now";
      marker.innerHTML = " &middot; We are here";
      when.appendChild(marker);
    }
  });

  // Auto-hiding scrollbar: show it while the page is scrolling, fade it back
  // out shortly after scrolling stops.
  let scrollHideTimer;
  window.addEventListener(
    "scroll",
    () => {
      document.documentElement.classList.add("is-scrolling");
      clearTimeout(scrollHideTimer);
      scrollHideTimer = setTimeout(() => {
        document.documentElement.classList.remove("is-scrolling");
      }, 900);
    },
    { passive: true }
  );

});

/* ==========================================================================
   Home / about chrome — card outlines, gallery ticker, cursor caption
   ========================================================================== */
document.addEventListener("DOMContentLoaded", () => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------
     Work cards: draw the hover border as one continuous clockwise
     stroke. The path is generated from the card's measured size so the
     dash length is the true perimeter, which is what lets a single
     ease-in-out curve run edge to edge at an even speed. CSS reads the
     length back through --outline-len.
     ------------------------------------------------------------------ */
  const RADIUS = 16;
  const INSET = 1;

  function roundedRectPath(w, h, r) {
    const x = INSET;
    const y = INSET;
    const W = w - INSET * 2;
    const H = h - INSET * 2;
    const rr = Math.max(0, Math.min(r, W / 2, H / 2));
    return [
      `M ${x + rr} ${y}`,
      `H ${x + W - rr}`,
      `A ${rr} ${rr} 0 0 1 ${x + W} ${y + rr}`,
      `V ${y + H - rr}`,
      `A ${rr} ${rr} 0 0 1 ${x + W - rr} ${y + H}`,
      `H ${x + rr}`,
      `A ${rr} ${rr} 0 0 1 ${x} ${y + H - rr}`,
      `V ${y + rr}`,
      `A ${rr} ${rr} 0 0 1 ${x + rr} ${y}`,
      "Z"
    ].join(" ");
  }

  function sizeOutline(card) {
    const svg = card.querySelector(".work-card-outline");
    const path = svg && svg.querySelector("path");
    if (!path) return;

    const w = Math.round(card.offsetWidth);
    const h = Math.round(card.offsetHeight);
    if (!w || !h) return;

    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    path.setAttribute("d", roundedRectPath(w, h, RADIUS));

    // The length feeds both stroke-dasharray and stroke-dashoffset, so
    // writing it while the transition is live would animate the border into
    // view on load or on resize. Drop the transition, commit the new value,
    // then put the transition back for hover.
    const len = Math.ceil(path.getTotalLength());
    if (card.dataset.outlineLen === String(len)) return;

    card.dataset.outlineLen = String(len);
    card.classList.remove("is-outline-ready");
    card.style.setProperty("--outline-len", len);
    getComputedStyle(path).strokeDashoffset; // flush the value with no transition
    card.classList.add("is-outline-ready");
  }

  const cards = document.querySelectorAll(".work-card");
  if (cards.length) {
    cards.forEach(sizeOutline);

    if ("ResizeObserver" in window) {
      const ro = new ResizeObserver((entries) => {
        entries.forEach((entry) => sizeOutline(entry.target));
      });
      cards.forEach((card) => ro.observe(card));
    } else {
      window.addEventListener("resize", () => cards.forEach(sizeOutline));
    }

    // Web fonts land after first paint and change the card height.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => cards.forEach(sizeOutline));
    }
  }

  /* ------------------------------------------------------------------
     About gallery: scrolls on its own, and creeps along like a ticker
     whenever nobody is scrolling it, so it reads as scrollable at a
     glance. The list is duplicated once and the scroll position wraps at
     the halfway mark, which makes the loop seamless.
     ------------------------------------------------------------------ */
  const gallery = document.querySelector("[data-gallery]");
  const track = gallery && gallery.querySelector("[data-gallery-track]");

  if (gallery && track && !reduceMotion) {
    Array.from(track.children).forEach((node) => {
      const copy = node.cloneNode(true);
      copy.setAttribute("aria-hidden", "true");
      track.appendChild(copy);
    });

    const SPEED = 0.35;      // px per frame at 60fps
    const IDLE_DELAY = 1400; // ms of quiet before the ticker picks back up
    let paused = false;
    let resumeTimer;

    const pause = () => {
      paused = true;
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => { paused = false; }, IDLE_DELAY);
    };

    ["wheel", "touchstart", "touchmove", "pointerdown", "keydown"].forEach((ev) => {
      gallery.addEventListener(ev, pause, { passive: true });
    });

    const step = () => {
      const half = track.scrollHeight / 2;
      if (half > 0) {
        if (!paused) gallery.scrollTop += SPEED;
        // Wrap in both directions so scrolling up stays seamless too.
        if (gallery.scrollTop >= half) gallery.scrollTop -= half;
        else if (gallery.scrollTop < 0.5) gallery.scrollTop += half;
      }
      requestAnimationFrame(step);
    };

    // Start just inside the first copy so an upward scroll has somewhere to go.
    requestAnimationFrame(() => {
      gallery.scrollTop = 1;
      requestAnimationFrame(step);
    });
  }

  /* ------------------------------------------------------------------
     Caption that follows the pointer across the gallery images.
     ------------------------------------------------------------------ */
  const captioned = document.querySelectorAll("[data-caption]");

  if (captioned.length && window.matchMedia("(hover: hover)").matches) {
    const bubble = document.createElement("div");
    bubble.className = "cursor-caption";
    bubble.setAttribute("aria-hidden", "true");
    document.body.appendChild(bubble);

    const OFFSET_X = 16;
    const OFFSET_Y = 18;
    let raf = null;
    let pending = null;

    const place = () => {
      raf = null;
      if (!pending) return;
      const { x, y } = pending;
      const w = bubble.offsetWidth;
      const h = bubble.offsetHeight;
      // Flip to the other side of the cursor near the viewport edges.
      const left = x + OFFSET_X + w > window.innerWidth ? x - OFFSET_X - w : x + OFFSET_X;
      const top = y + OFFSET_Y + h > window.innerHeight ? y - OFFSET_Y - h : y + OFFSET_Y;
      bubble.style.transform = `translate(${Math.max(4, left)}px, ${Math.max(4, top)}px)`;
    };

    const move = (e) => {
      pending = { x: e.clientX, y: e.clientY };
      if (raf === null) raf = requestAnimationFrame(place);
    };

    captioned.forEach((el) => {
      el.addEventListener("pointerenter", (e) => {
        if (e.pointerType !== "mouse") return;
        bubble.textContent = el.getAttribute("data-caption") || "";
        move(e);
        bubble.classList.add("is-visible");
      });

      el.addEventListener("pointermove", move);

      el.addEventListener("pointerleave", () => {
        bubble.classList.remove("is-visible");
      });
    });
  }
});

/* ==========================================================================
   Project sidebar — table of contents built from the page's own headings,
   with a scrollspy that expands the current project and tracks position
   within it. Only present on projects/index.html.
   ========================================================================== */
document.addEventListener("DOMContentLoaded", () => {
  const sidenav = document.getElementById("project-sidenav");
  const heroes = Array.from(document.querySelectorAll(".project-hero[id]"));
  if (!sidenav || !heroes.length) return;

  const slugify = (text) =>
    text
      .toLowerCase()
      .replace(/["'()]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  // Each project runs from its .project-hero up to (but not including) the
  // next one; its h3s in between are the sub-nav. Reading the structure back
  // out of the DOM like this — rather than hand-listing titles in the sidebar
  // markup — means the nav can't drift out of sync with the write-ups.
  const projects = heroes.map((hero, i) => {
    const h2 = hero.querySelector("h2");
    const next = heroes[i + 1];
    const headings = [];

    let node = hero.nextElementSibling;
    while (node && node !== next) {
      node.querySelectorAll("h3").forEach((h) => {
        if (!h.id) h.id = `${hero.id}--${slugify(h.textContent)}`;
        headings.push(h);
      });
      node = node.nextElementSibling;
    }

    return { id: hero.id, title: h2 ? h2.textContent.trim() : hero.id, hero, headings };
  });

  const list = document.createElement("ol");
  list.className = "sidenav-list";

  const items = projects.map((project) => {
    const li = document.createElement("li");
    li.className = "sidenav-item";

    const titleLink = document.createElement("a");
    titleLink.className = "sidenav-title";
    titleLink.href = `#${project.id}`;
    titleLink.textContent = project.title;
    li.appendChild(titleLink);

    const subWrap = document.createElement("div");
    subWrap.className = "sidenav-sub";
    const subList = document.createElement("ol");

    const subLinks = project.headings.map((heading) => {
      const subLi = document.createElement("li");
      const subLink = document.createElement("a");
      subLink.href = `#${heading.id}`;
      subLink.textContent = heading.textContent.trim();
      subLi.appendChild(subLink);
      subList.appendChild(subLi);
      return { heading, link: subLink };
    });

    subWrap.appendChild(subList);
    li.appendChild(subWrap);
    list.appendChild(li);

    return { hero: project.hero, li, titleLink, subLinks };
  });

  sidenav.appendChild(list);

  // Start the sidebar level with the first project's title. The heading is
  // clamped to the viewport so its height moves with the window, which is
  // why this is measured rather than a fixed offset. The sidebar is sticky,
  // and a stuck element's box says nothing about where it starts, so the
  // measurement is taken with it briefly laid out in flow.
  function alignToFirstProject() {
    const heading = items[0] && items[0].hero.querySelector("h2");
    const link = items[0] && items[0].titleLink;
    if (!heading || !link) return;

    sidenav.style.paddingTop = "0px";
    if (!sidenav.offsetParent) return;            // hidden on narrow screens

    const pos = sidenav.style.position;
    sidenav.style.position = "static";
    const gap = heading.getBoundingClientRect().top - link.getBoundingClientRect().top;
    sidenav.style.position = pos;

    if (gap > 0) sidenav.style.paddingTop = `${Math.round(gap)}px`;
  }

  alignToFirstProject();
  window.addEventListener("resize", alignToFirstProject);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(alignToFirstProject);
  }

  // Scrollspy: an "active line" sits just under the sticky header, and
  // whichever project (then, within it, whichever heading) has most recently
  // scrolled past that line is the current one — the same "last thing that
  // happened" pattern the roadmap marker above uses for its own position.
  let ticking = false;

  function activeLine() {
    const headerH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 72;
    return headerH + 40;
  }

  function update() {
    ticking = false;
    const line = activeLine();

    let current = null;
    items.forEach((item) => {
      if (item.hero.getBoundingClientRect().top <= line) current = item;
    });

    items.forEach((item) => {
      const isActive = item === current;
      item.li.classList.toggle("is-active", isActive);

      if (!isActive) {
        item.subLinks.forEach((s) => s.link.classList.remove("is-current"));
        return;
      }

      // Default to the first heading so something is always highlighted the
      // moment its project becomes active — otherwise the hero/lede/gallery
      // run before that first heading would read as "nowhere".
      let currentSub = item.subLinks[0] || null;
      item.subLinks.forEach((s) => {
        if (s.heading.getBoundingClientRect().top <= line) currentSub = s;
      });
      item.subLinks.forEach((s) => s.link.classList.toggle("is-current", s === currentSub));
    });
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  update();
});
