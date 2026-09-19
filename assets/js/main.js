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
  document.querySelectorAll(".site-nav > a, .site-nav > .nav-item > a").forEach((link) => {
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

  document.querySelectorAll('a[href*="#"]').forEach((link) => {
    link.addEventListener("click", (e) => {
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
