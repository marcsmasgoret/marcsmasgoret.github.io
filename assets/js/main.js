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

  function openViewer(overlay, trigger) {
    lastViewerTrigger = trigger || null;
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("viewer-open");
    const closeBtn = overlay.querySelector(".ppt-viewer-close");
    if (closeBtn) closeBtn.focus();
  }

  function closeViewer(overlay) {
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("viewer-open");
    if (lastViewerTrigger) lastViewerTrigger.focus();
  }

  document.querySelectorAll("[data-viewer-open]").forEach((trigger) => {
    trigger.addEventListener("click", () => {
      const overlay = document.getElementById(trigger.getAttribute("data-viewer-open"));
      if (overlay) openViewer(overlay, trigger);
    });
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
