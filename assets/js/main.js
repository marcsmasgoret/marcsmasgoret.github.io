/* ==========================================================================
   Smooth wheel scrolling. The page glides to wherever the wheel sends it,
   at a capped speed. Left native, a fast spin of the wheel stacks notch on
   notch and the page takes off; here one wheel event moves it at most STEP,
   and the target never runs more than LEAD ahead of the page, which caps
   the speed at RATE * LEAD however hard the wheel is flicked. Anything that
   scrolls on its own (the sidebar, the manual reader, a 3D viewer's zoom)
   keeps the wheel while it has room to move.

   Exposed as window.smoothWheel so the cursor buddy can take this frame's
   step before it reads the scroll position, and so the galleries can glide
   with the same feel (RATE, LEAD, wheelPx).
   ========================================================================== */
window.smoothWheel = (() => {
  const RATE = 14;    // 1/s: how quickly the page closes on its target
  const STEP = 120;   // px: the most one wheel event can add
  const LEAD = 200;   // px: the most the target can be ahead of the page
  const LINE = 33;    // px per line, for wheels that report lines (3 lines ≈ one notch)

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // One wheel event's delta (deltaY or deltaX) in px, capped at STEP. A
  // wheel that reports pages moves `page` px per page.
  const wheelPx = (e, delta, page) => {
    const unit = e.deltaMode === 1 ? LINE : e.deltaMode === 2 ? page : 1;
    return clamp(delta * unit, -STEP, STEP);
  };

  const idle = { tick() {}, RATE, LEAD, wheelPx };
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return idle;

  let pos = 0;        // kept as a float: the browser may round what it reports
  let target = 0;
  let running = false;
  let lastTick = -1;
  let lastTime = 0;

  const maxScroll = () => document.documentElement.scrollHeight - window.innerHeight;

  // The visitor can't scroll the page itself: a viewer overlay is open, or
  // the About page fits on one screen.
  function pageLocked() {
    const html = getComputedStyle(document.documentElement).overflowY;
    const body = getComputedStyle(document.body).overflowY;
    return /hidden|clip/.test(html) || (html === "visible" && /hidden|clip/.test(body));
  }

  // Whether something between the pointer and the page scrolls on its own
  // in this direction, and so should have the wheel instead.
  function nestedTakes(el, dy) {
    for (let node = el; node && node !== document.body && node !== document.documentElement;
         node = node.parentElement) {
      if (node.scrollHeight <= node.clientHeight + 1) continue;
      const style = getComputedStyle(node);
      if (!/auto|scroll|overlay/.test(style.overflowY)) continue;
      if (style.overscrollBehaviorY !== "auto") return true;
      const room = dy > 0
        ? node.scrollHeight - node.clientHeight - node.scrollTop
        : node.scrollTop;
      if (room > 1) return true;
    }
    return false;
  }

  function stop() {
    running = false;
  }

  function tick(now) {
    if (!running || now === lastTick) return;
    const dt = lastTime ? clamp((now - lastTime) / 1000, 0, 0.05) : 1 / 60;
    lastTick = now;
    lastTime = now;

    // Something else moved the page (a link's own smooth scroll, the
    // scrollbar, the keyboard): let it have the page.
    if (Math.abs(window.scrollY - pos) > 3) { stop(); return; }

    target = clamp(target, 0, Math.max(0, maxScroll()));
    const gap = target - pos;
    if (Math.abs(gap) < 0.5) {
      pos = target;
      stop();
    } else {
      pos += gap * (1 - Math.exp(-RATE * dt));
    }
    window.scrollTo({ top: pos, behavior: "instant" });
  }

  function loop(now) {
    tick(now);
    if (running) requestAnimationFrame(loop);
  }

  window.addEventListener("wheel", (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.shiftKey) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

    const dy = wheelPx(e, e.deltaY, window.innerHeight);
    const over = e.target instanceof Element ? e.target : null;
    if (!dy || maxScroll() <= 0 || pageLocked() || nestedTakes(over, dy)) return;

    e.preventDefault();
    if (!running) {
      pos = target = window.scrollY;
      running = true;
      lastTime = 0;
      requestAnimationFrame(loop);
    }
    target = clamp(target + dy, pos - LEAD, pos + LEAD);
  }, { passive: false });

  // Anything else that takes the page (a click on a link, a drag on the
  // scrollbar, a key) stops the glide before it can fight it.
  ["mousedown", "keydown", "touchstart"].forEach((ev) => {
    window.addEventListener(ev, stop, { passive: true });
  });

  return { tick, RATE, LEAD, wheelPx };
})();

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
     Galleries (the About photo column, and the Other strip at the foot
     of the projects page, which runs sideways — data-gallery="x"): each
     scrolls on its own, and creeps along like a ticker whenever nobody
     is scrolling it and it is on screen, so it reads as scrollable at a
     glance. It waits until it is in view to start, so a strip far down
     the page still opens on its first photo. The list is duplicated once
     and the scroll position wraps by exactly one copy's length, which
     makes the loop seamless. The wheel glides a gallery the way
     smoothWheel glides the page, with the same rate and speed cap.
     ------------------------------------------------------------------ */
  document.querySelectorAll("[data-gallery]").forEach((gallery) => {
    const track = gallery.querySelector("[data-gallery-track]");
    if (!track || reduceMotion) return;

    const sideways = gallery.dataset.gallery === "x";
    const axis = sideways ? "scrollLeft" : "scrollTop";

    const originals = Array.from(track.children);
    const copies = originals.map((node) => {
      const copy = node.cloneNode(true);
      copy.setAttribute("aria-hidden", "true");
      track.appendChild(copy);
      return copy;
    });

    // One copy's length, gap included: where the first duplicate starts
    // relative to the first original. Half the track would come up one
    // gap short and jump by half a gap at every wrap.
    const period = () => sideways
      ? copies[0].offsetLeft - originals[0].offsetLeft
      : copies[0].offsetTop - originals[0].offsetTop;

    const SPEED = 0.35;      // px per frame at 60fps
    const IDLE_DELAY = 1400; // ms of quiet before the ticker picks back up
    let paused = false;
    let resumeTimer;

    const pause = () => {
      paused = true;
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => { paused = false; }, IDLE_DELAY);
    };

    ["touchstart", "touchmove", "pointerdown", "keydown"].forEach((ev) => {
      gallery.addEventListener(ev, pause, { passive: true });
    });

    // Where the wheel is sending the gallery, or null when it isn't. Each
    // wheel event moves it and the ticker's step closes on it, as
    // smoothWheel does for the page.
    const { RATE, LEAD, wheelPx } = window.smoothWheel;
    let glideTo = null;
    let lastTime = 0;

    // A plain vertical wheel over the sideways strip scrolls the page, not
    // the strip, so only a sideways one (or shift + wheel) moves the strip.
    gallery.addEventListener("wheel", (e) => {
      if (e.ctrlKey) return;
      const across = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      const delta = sideways
        ? (across ? e.deltaX : e.shiftKey ? e.deltaY : 0)
        : (across ? 0 : e.deltaY);
      if (!delta) return;

      e.preventDefault();
      pause();
      const px = wheelPx(e, delta, sideways ? gallery.clientWidth : gallery.clientHeight);
      const from = glideTo === null ? at : glideTo;
      glideTo = Math.max(at - LEAD, Math.min(at + LEAD, from + px));
    }, { passive: false });

    // On screen: a good part of it in view, not just an edge.
    let inView = !("IntersectionObserver" in window);
    if (!inView) {
      new IntersectionObserver(([entry]) => {
        inView = entry.intersectionRatio >= 0.35;
      }, { threshold: [0, 0.35] }).observe(gallery);
    }

    // The position is kept here as a float and written out whole. Some
    // browsers round a scroll offset to the device pixel, and 0.35 px
    // steps would round away to nothing on a 1x screen.
    let at = 1;

    const step = (now) => {
      const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 1 / 60;
      lastTime = now;
      const len = period();
      if (len > 0) {
        if (Math.abs(gallery[axis] - at) > 2) { // scrolled by hand
          at = gallery[axis];
          glideTo = null;
        }
        if (glideTo !== null) {
          const gap = glideTo - at;
          if (Math.abs(gap) < 0.5) {
            at = glideTo;
            glideTo = null;
          } else {
            at += gap * (1 - Math.exp(-RATE * dt));
          }
        } else if (!paused && inView) {
          at += SPEED;
        }
        // Wrap in both directions so scrolling back stays seamless too. The
        // glide's target wraps with it, so a glide carries across the seam.
        const wrap = at >= len ? -len : at < 0.5 ? len : 0;
        at += wrap;
        if (glideTo !== null) glideTo += wrap;
        gallery[axis] = at;
      }
      requestAnimationFrame(step);
    };

    // Start just inside the first copy so a backward scroll has somewhere to go.
    requestAnimationFrame(() => {
      gallery[axis] = at;
      requestAnimationFrame(step);
    });
  });

  /* ------------------------------------------------------------------
     Caption that follows the pointer across the gallery images.
     ------------------------------------------------------------------ */
  const captioned = document.querySelectorAll("[data-caption]");

  if (captioned.length && window.matchMedia("(hover: hover)").matches) {
    const bubble = document.createElement("div");
    bubble.className = "cursor-caption";
    bubble.setAttribute("aria-hidden", "true");
    document.body.appendChild(bubble);

    // The caption takes the pointer's place over a gallery; CSS hides the
    // pointer there only once this is set.
    document.documentElement.classList.add("has-cursor-caption");

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
