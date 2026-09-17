document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".site-nav");

  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      nav.classList.toggle("open");
    });
  }

  const here = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".site-nav > a, .site-nav > .nav-item > a").forEach((link) => {
    const target = link.getAttribute("href").split("/").pop().split("#")[0] || "index.html";
    if (target === here) link.classList.add("active");
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

  // Scroll so a project's title lands at the top of the viewport, not the
  // bottom. Native anchor jumps can land short/long here because late-loading
  // images and the 3D model viewer shift page height after the initial jump,
  // so we drive the scroll ourselves and re-correct once everything settles.
  function scrollHashTargetToTop(hash) {
    if (!hash) return;
    const id = hash.startsWith("#") ? hash.slice(1) : hash;
    if (!id) return;
    const target = document.getElementById(id);
    if (target) target.scrollIntoView({ behavior: "auto", block: "start" });
  }

  if (location.hash) {
    scrollHashTargetToTop(location.hash);
    window.addEventListener("load", () => {
      scrollHashTargetToTop(location.hash);
      setTimeout(() => scrollHashTargetToTop(location.hash), 300);
      setTimeout(() => scrollHashTargetToTop(location.hash), 900);
    });
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
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) return;

  document.querySelectorAll(".btn").forEach((btn) => {
    const strength = 0.28;

    btn.addEventListener("mousemove", (e) => {
      const rect = btn.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      btn.style.transform = `translate(${dx * strength}px, ${dy * strength}px) scale(1.04)`;
    });

    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "translate(0, 0) scale(1)";
    });
  });
});
