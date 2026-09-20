/* ==========================================================================
   Cursor buddy — home page only.

   A stick figure that chases the pointer around the page. What it can and
   cannot walk through:

     - Project cards are solid panels, so their box is their shape.
     - Text is not. A heading's element box runs the full content width
       while its glyphs stop far short of it, so measuring the element
       would leave an invisible wall out to the right of the hero copy.
       Text obstacles are measured off the rendered text instead, one box
       per line.

   Movement: it walks side to side; drops to a crawl where a gap is too
   short to stand in (the gaps between card rows); climbs or slides a
   block's near edge when one is in the way; climbs with its back to us
   when it is going straight up or down in open air; and flies on a
   jetpack when a scroll or a losing chase leaves it behind.

   It is confined to the page between the header and the footer, so it
   never walks over the nav or the footer columns.

   It sits when it arrives. If the pointer is resting inside a block, where
   it can never stand, it settles on that block's nearest corner rather
   than anywhere along its sides. Clicking it while it sits startles it.
   ========================================================================== */
(() => {
  const canvas = document.getElementById("cursor-buddy");
  if (!canvas) return;

  // Pure decoration, and it needs a real pointer to chase.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

  const ctx = canvas.getContext("2d");

  /* ---------------------------------------------------------------- sizing */
  let vw = 0;
  let vh = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    vw = window.innerWidth;
    vh = window.innerHeight;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    canvas.style.width = `${vw}px`;
    canvas.style.height = `${vh}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  resize();
  window.addEventListener("resize", resize);

  /* -------------------------------------------------------------- geometry */
  const H = 38;                 // standing height, feet to top of head
  const CRAWL_H = 15;           // height flat on its front
  const HALF_W = 10;

  const HIP = -H * 0.46;
  const SHO = -H * 0.76;
  const HEAD_Y = -H * 0.88;
  const HEAD_R = H * 0.13;
  const LEG = -HIP;
  const ARM = H * 0.34;
  const TORSO = SHO - HIP;
  const HEAD_OFF = HEAD_Y - SHO;

  // The card grid's gaps are 22px, and the padding is split by axis so the
  // two can differ. Sideways, a gap has to come out narrower than the body
  // (18 < 20) so the figure cannot squeeze between two cards standing. A
  // row gap is left at its full 22, which gives a 15-high crawl seven
  // pixels of room instead of the three a uniform pad left it — enough
  // that it actually fits through rather than only just failing to.
  const PAD_X = 2;
  const PAD_Y = 0;

  const WALK_SPEED = 190;       // px/s
  const CRAWL_SPEED = 120;
  const RISE_SPEED = 85;        // vertical drift while walking open ground
  const SCALE_SPEED = 120;      // straight up or down in open air
  const CLIMB_SPEED = 135;
  const SLIDE_SPEED = 280;
  const JET_SPEED = 660;

  const CATCH_DIST = 30;        // close enough to sit
  const LEAVE_DIST = 54;        // and far enough to get back up
  const JET_DONE = 70;

  const FAST_SCROLL = 48;       // px of scroll in one frame
  const JET_GAP = 1300;         // hopeless even to start walking
  const JET_PATIENCE = 3.2;     // seconds of chasing without arriving
  const JET_CHASING = 260;      // ...while still this far away

  const PERCH_MS = 1100;
  const DROP_MS = 720;
  const STARTLE_MS = 620;

  /* ------------------------------------------------------------- obstacles */
  let sources = [];

  function collectBlocks() {
    sources = [];
    document.querySelectorAll(".work-card").forEach((el) => sources.push({ el }));

    // Ranges, not elements: see the note at the top of the file.
    document.querySelectorAll(".home-title, .home-sub").forEach((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      sources.push({ range });
    });
  }

  collectBlocks();
  window.addEventListener("load", collectBlocks);

  // Read fresh every frame: boxes move with every scroll, and reading them
  // back to back costs one layout pass because nothing writes in between.
  function rects() {
    const out = [];
    sources.forEach((src, si) => {
      const boxes = src.range
        ? src.range.getClientRects()
        : [src.el.getBoundingClientRect()];

      for (let bi = 0; bi < boxes.length; bi++) {
        const r = boxes[bi];
        if (r.width < 4 || r.height < 4) continue;
        if (r.bottom < -80 || r.top > vh + 80) continue;
        out.push({
          id: `${si}:${bi}`,
          left: r.left - PAD_X,
          right: r.right + PAD_X,
          top: r.top - PAD_Y,
          bottom: r.bottom + PAD_Y,
        });
      }
    });
    return out;
  }

  function hits(r, x, y, h) {
    return x + HALF_W > r.left && x - HALF_W < r.right &&
           y > r.top && y - h < r.bottom;
  }

  function blockAt(list, x, y, h) {
    for (const r of list) if (hits(r, x, y, h)) return r;
    return null;
  }

  /* ------------------------------------------------------------ the band
     The strip of page the figure is allowed into: below the header, above
     the footer. Both are measured fresh each frame, since the header is
     sticky and the footer only rises into view at the end of the page. */
  let band = { top: 0, bottom: 0 };

  function measureBand() {
    const header = document.querySelector(".site-header");
    const footer = document.querySelector(".site-footer");
    const top = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
    const bottom = footer ? Math.min(vh, footer.getBoundingClientRect().top) : vh;

    // Never inverted, however little page is left between the two.
    band = { top: top + 4, bottom: Math.max(top + 4 + H, bottom - 4) };
  }

  // Clamp a feet position into the band, given the height standing there.
  function clampY(y, h) {
    return Math.max(band.top + h, Math.min(band.bottom, y));
  }

  /* ----------------------------------------------------------------- state */
  const buddy = {
    mode: "perch",   // perch drop walk crawl scale climb slide jet sit startle
    x: vw / 2,
    y: 200,
    facing: 1,
    phase: 0,
    t0: performance.now(),
    dropFrom: null,
    dropTo: null,
    grip: null,      // { id, dx, dy, toDy } while climbing or sliding
    startleY: 0,
  };

  const target = { x: vw / 2, y: vh / 2 };

  window.addEventListener("mousemove", (e) => {
    target.x = e.clientX;
    target.y = e.clientY;
  }, { passive: true });

  let scrollY = window.scrollY;
  let scrollStep = 0;
  let chaseTime = 0;

  // Clicking it while it is sitting startles it. The canvas never takes
  // pointer events, so this hit-tests by hand on the way down and swallows
  // the click only when the figure itself was hit.
  document.addEventListener("click", (e) => {
    if (buddy.mode !== "sit" && buddy.mode !== "perch") return;

    const top = buddy.mode === "perch"
      ? buddy.y + TORSO + HEAD_OFF - HEAD_R
      : buddy.y - H;
    const bottom = buddy.mode === "perch" ? buddy.y + LEG : buddy.y;
    if (Math.abs(e.clientX - buddy.x) > HALF_W + 8) return;
    if (e.clientY < top - 8 || e.clientY > bottom + 8) return;

    e.preventDefault();
    e.stopPropagation();

    if (buddy.mode === "perch") buddy.y += LEG;   // seat-based -> feet-based
    buddy.mode = "startle";
    buddy.t0 = performance.now();
    buddy.startleY = buddy.y;
    chaseTime = 0;
  }, true);

  /* ------------------------------------------------------------- the poses */
  function line(ax, ay, bx, by) {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  // Angles run from straight down (0) toward the facing side, so π is up.
  function limb(ox, oy, a1, l1, a2, l2) {
    const jx = ox + Math.sin(a1) * l1;
    const jy = oy + Math.cos(a1) * l1;
    line(ox, oy, jx, jy);
    line(jx, jy, jx + Math.sin(a2) * l2, jy + Math.cos(a2) * l2);
  }

  function head(y, x = 0) {
    ctx.beginPath();
    ctx.arc(x, y, HEAD_R, 0, Math.PI * 2);
    ctx.stroke();
  }

  function poseWalk(p) {
    const sw = Math.sin(p) * 0.55;

    // Twice a cycle the legs swing past each other and the thigh angles
    // match exactly, which would draw one leg on top of the other and
    // leave a figure with no legs at all. cos() peaks at precisely those
    // moments, so it drives a knee bend that keeps them apart — which is
    // also what a real stride does as the trailing leg lifts.
    const pass = Math.cos(p);
    limb(0, HIP, sw, LEG * 0.52,
         sw * 0.45 - 0.12 - Math.max(0, pass) * 0.5, LEG * 0.48);
    limb(0, HIP, -sw, LEG * 0.52,
         -sw * 0.45 - 0.12 - Math.max(0, -pass) * 0.5, LEG * 0.48);

    const elbow = pass * 0.3;
    limb(0, SHO, -sw * 0.75, ARM * 0.5, -sw * 0.45 + 0.25 + elbow, ARM * 0.5);
    limb(0, SHO, sw * 0.75, ARM * 0.5, sw * 0.45 + 0.25 - elbow, ARM * 0.5);

    line(0, HIP, 0, SHO);
    head(HEAD_Y);
  }

  // Flat on its front, pulling itself along — the only way through a gap
  // shorter than it is. Everything is kept inside CRAWL_H.
  function poseCrawl(p) {
    const t = Math.sin(p);
    const hipX = -7, hipY = -5;
    const shoX = 5, shoY = -6.5;

    line(hipX, hipY, shoX, shoY);
    head(shoY - 1.5, shoX + 6.5);

    limb(shoX, shoY, 1.75 + t * 0.45, ARM * 0.45, 2.05 + t * 0.35, ARM * 0.45);
    limb(shoX, shoY, 1.75 - t * 0.45, ARM * 0.45, 2.05 - t * 0.35, ARM * 0.45);
    limb(hipX, hipY, -1.55 + t * 0.5, LEG * 0.45, -1.1 + t * 0.45, LEG * 0.45);
    limb(hipX, hipY, -1.95 - t * 0.5, LEG * 0.45, -1.7 - t * 0.45, LEG * 0.45);
  }

  // Going straight up or down with nothing to hold: seen from behind, both
  // arms reaching overhead, so it reads as climbing rather than levitating.
  function poseScale(p) {
    const t = Math.sin(p);
    limb(0, SHO, 2.0 + t * 0.2, ARM * 0.5, 2.5 + t * 0.25, ARM * 0.5);
    limb(0, SHO, -2.0 + t * 0.2, ARM * 0.5, -2.5 + t * 0.25, ARM * 0.5);
    limb(0, HIP, 0.3 + t * 0.3, LEG * 0.5, 0.08 + t * 0.2, LEG * 0.5);
    limb(0, HIP, -0.3 + t * 0.3, LEG * 0.5, -0.08 + t * 0.2, LEG * 0.5);
    line(0, HIP, 0, SHO);
    head(HEAD_Y);
  }

  function poseClimb(p) {
    const t = Math.sin(p);
    limb(0, SHO, 1.95 + t * 0.3, ARM * 0.5, 2.3 + t * 0.28, ARM * 0.5);
    limb(0, SHO, 1.95 - t * 0.3, ARM * 0.5, 2.3 - t * 0.28, ARM * 0.5);
    limb(0, HIP, 0.8 + t * 0.35, LEG * 0.5, 0.25 - t * 0.25, LEG * 0.5);
    limb(0, HIP, 0.8 - t * 0.35, LEG * 0.5, 0.25 + t * 0.25, LEG * 0.5);
    line(0, HIP, 0, SHO);
    head(HEAD_Y, -2);
  }

  // Deliberately not a climb: legs straight and braced together rather
  // than alternating, body leaning off the wall, friction marks streaming
  // up past it to sell the drop.
  function poseSlide(p) {
    const shake = Math.sin(p * 11) * 0.8;
    ctx.save();
    ctx.translate(shake, 0);
    ctx.rotate(-0.1);
    limb(0, SHO, 1.9, ARM * 0.5, 2.15, ARM * 0.5);
    limb(0, SHO, 1.68, ARM * 0.5, 1.95, ARM * 0.5);
    limb(0, HIP, 0.3, LEG * 0.52, 0.46, LEG * 0.48);
    limb(0, HIP, 0.12, LEG * 0.52, 0.26, LEG * 0.48);
    line(0, HIP, 0, SHO);
    head(HEAD_Y, -2.5);
    ctx.restore();

    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 4; i++) {
      const o = -4 - i * 11 - ((p * 34) % 11);
      line(10 + (i % 2) * 3, o, 10 + (i % 2) * 3, o - 6);
    }
    ctx.globalAlpha = 1;
  }

  function poseJet(p) {
    ctx.save();
    ctx.rotate(-0.38);
    ctx.beginPath();
    ctx.rect(-HALF_W, SHO - 1, 6, 12);
    ctx.stroke();

    const f = 7 + Math.sin(p * 22) * 3.5;
    ctx.globalAlpha = 0.9;
    line(-HALF_W + 3, SHO + 11, -HALF_W + 3, SHO + 11 + f);
    line(-HALF_W + 5, SHO + 11, -HALF_W + 5, SHO + 11 + f * 0.65);
    ctx.globalAlpha = 1;

    limb(0, HIP, -0.5, LEG * 0.52, -0.75, LEG * 0.48);
    limb(0, HIP, -0.8, LEG * 0.52, -1.05, LEG * 0.48);
    limb(0, SHO, 1.5, ARM * 0.5, 1.9, ARM * 0.5);
    limb(0, SHO, -2.1, ARM * 0.5, -2.4, ARM * 0.5);
    line(0, HIP, 0, SHO);
    head(HEAD_Y);
    ctx.restore();
  }

  function poseJump(t) {
    const tuck = Math.sin(Math.PI * t);
    limb(0, HIP, 0.7 + tuck * 0.5, LEG * 0.5, -0.3 - tuck * 0.7, LEG * 0.5);
    limb(0, HIP, 0.45 + tuck * 0.5, LEG * 0.5, -0.5 - tuck * 0.7, LEG * 0.5);
    limb(0, SHO, 2.3 + tuck * 0.5, ARM * 0.5, 2.6 + tuck * 0.4, ARM * 0.5);
    limb(0, SHO, -2.3 - tuck * 0.3, ARM * 0.5, -2.6 - tuck * 0.2, ARM * 0.5);
    line(0, HIP, 0, SHO);
    head(HEAD_Y);
  }

  function poseStartle(t) {
    const fling = Math.sin(Math.PI * Math.min(1, t * 1.5));
    limb(0, HIP, 0.45 + fling * 0.55, LEG * 0.52, 0.8 + fling * 0.5, LEG * 0.48);
    limb(0, HIP, -0.45 - fling * 0.55, LEG * 0.52, -0.8 - fling * 0.5, LEG * 0.48);
    limb(0, SHO, 2.05 + fling * 0.3, ARM * 0.5, 2.5 + fling * 0.35, ARM * 0.5);
    limb(0, SHO, -2.05 - fling * 0.3, ARM * 0.5, -2.5 - fling * 0.35, ARM * 0.5);
    line(0, HIP, 0, SHO);
    head(HEAD_Y);

    // shock marks, fading as it comes back down
    ctx.globalAlpha = Math.max(0, 0.85 * (1 - t));
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.42;
      const r1 = HEAD_R + 4, r2 = HEAD_R + 9;
      line(Math.cos(a) * r1, HEAD_Y + Math.sin(a) * r1,
           Math.cos(a) * r2, HEAD_Y + Math.sin(a) * r2);
    }
    ctx.globalAlpha = 1;
  }

  // Perched on the logo: origin is the seat rather than the feet, so the
  // legs hang down over the corner instead of stretching out in front.
  function posePerch(now) {
    const swing = Math.sin(now / 470) * 0.2;
    limb(0, 0, 0.2 + swing, LEG * 0.52, 0.06 + swing * 0.6, LEG * 0.48);
    limb(0, 0, 0.0 - swing, LEG * 0.52, -0.1 - swing * 0.6, LEG * 0.48);
    const sho = TORSO;
    line(0, 0, 0, sho);
    limb(0, sho, -0.25, ARM * 0.5, -0.55, ARM * 0.5);
    limb(0, sho, 0.3, ARM * 0.5, 0.62, ARM * 0.5);
    head(sho + HEAD_OFF);
  }

  function poseSit(now) {
    const breathe = Math.sin(now / 620) * 0.7;
    const hip = -H * 0.27 + breathe;
    const sho = hip + TORSO;
    limb(0, hip, 1.45, LEG * 0.52, 0.12, LEG * 0.48);
    limb(0, hip, 1.2, LEG * 0.52, 0.0, LEG * 0.48);
    line(0, hip, 0, sho);
    limb(0, sho, 0.5, ARM * 0.5, 1.0, ARM * 0.5);
    limb(0, sho, -0.45, ARM * 0.5, -0.05, ARM * 0.5);
    head(sho + HEAD_OFF);
  }

  /* ------------------------------------------------------------ the update */
  // The pointer often rests on top of a card, somewhere the figure can
  // never stand. Aim for that block's nearest corner — never a point along
  // one of its sides, which is not somewhere to sit.
  function reachable(list) {
    const r = blockAt(list, target.x, target.y, 1);
    if (!r) return { x: target.x, y: target.y };

    const onTop = r.top - 3;
    const below = r.bottom + H + 3;
    const corners = [
      { x: r.left + HALF_W, y: onTop },
      { x: r.right - HALF_W, y: onTop },
      { x: r.left + HALF_W, y: below },
      { x: r.right - HALF_W, y: below },
    ];

    // A card's lower corners land inside the row beneath it, which is
    // nowhere to stand, so those are dropped unless nothing is left.
    const open = corners.filter((c) => !blockAt(list, c.x, c.y, H));
    const usable = open.length ? open : corners;

    let best = usable[0];
    let bestD = Infinity;
    for (const c of usable) {
      const d = Math.hypot(c.x - buddy.x, c.y - buddy.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  // Grab a block's near edge and start working up or down it. Returns false
  // when the figure is already where that would end, which would otherwise
  // finish instantly and re-trigger on the very next frame.
  function grab(wall, goUp, now) {
    const rawTo = goUp ? -3 : (wall.bottom - wall.top) + H + 3;
    const toDy = Math.max(band.top + H + 6 - wall.top,
                          Math.min(band.bottom - 6 - wall.top, rawTo));
    const fromDy = buddy.y - wall.top;
    if (Math.abs(toDy - fromDy) < 5) return false;

    const fromLeft = buddy.x < (wall.left + wall.right) * 0.5;
    const edgeX = fromLeft ? wall.left - HALF_W - 2 : wall.right + HALF_W + 2;

    buddy.mode = goUp ? "climb" : "slide";
    buddy.facing = fromLeft ? 1 : -1;
    buddy.t0 = now;
    buddy.grip = { id: wall.id, dx: edgeX - wall.left, dy: fromDy, toDy };
    return true;
  }

  function step(dt, now) {
    measureBand();
    const list = rects();
    const goal = reachable(list);
    goal.y = clampY(goal.y, H);
    const dist = Math.hypot(goal.x - buddy.x, goal.y - buddy.y);

    // --- perched on the logo, waiting to jump off -------------------------
    if (buddy.mode === "perch") {
      // Measured on the mark itself, not the padded link, and seated on its
      // top corner so the letters stay readable underneath.
      const mark = document.querySelector(".site-monogram .monogram-mark");
      if (mark) {
        const r = mark.getBoundingClientRect();
        buddy.x = r.right - 3;
        buddy.y = r.top + 1;
      }
      if (now - buddy.t0 > PERCH_MS) {
        buddy.mode = "drop";
        buddy.t0 = now;
        buddy.y += LEG;              // seat-based -> feet-based
        buddy.dropFrom = { x: buddy.x, y: buddy.y };
        buddy.dropTo = {
          x: Math.min(vw - 30, buddy.x + 95),
          y: clampY(buddy.y + 185, H),
        };
        buddy.facing = 1;
      }
      return;
    }

    // --- the hop down off the logo ---------------------------------------
    if (buddy.mode === "drop") {
      const t = Math.min(1, (now - buddy.t0) / DROP_MS);
      buddy.x = buddy.dropFrom.x + (buddy.dropTo.x - buddy.dropFrom.x) * t;
      buddy.y = buddy.dropFrom.y + (buddy.dropTo.y - buddy.dropFrom.y) * t
              - Math.sin(Math.PI * t) * 42;
      if (t >= 1) { buddy.mode = "walk"; buddy.t0 = now; }
      return;
    }

    // --- startled off its seat -------------------------------------------
    if (buddy.mode === "startle") {
      const t = (now - buddy.t0) / STARTLE_MS;
      if (t >= 1) {
        buddy.y = buddy.startleY;
        buddy.mode = "walk";
        buddy.t0 = now;
        return;
      }
      buddy.y = clampY(buddy.startleY - Math.sin(Math.PI * t) * 34, H);
      return;
    }

    // --- caught up: sit, and stay sitting until the pointer moves off -----
    if (buddy.mode === "sit") {
      chaseTime = 0;
      if (dist > LEAVE_DIST) { buddy.mode = "walk"; buddy.t0 = now; }
      return;
    }

    // Only ever sit having finished a climb or slide, never part way up the
    // side of a block.
    if (dist < CATCH_DIST && buddy.mode !== "climb" && buddy.mode !== "slide") {
      buddy.mode = "sit";
      buddy.t0 = now;
      return;
    }

    // --- jetpack: left behind, fly straight to the pointer ----------------
    chaseTime = dist > JET_CHASING ? chaseTime + dt : 0;

    const leftBehind = dist > JET_GAP ||
                       chaseTime > JET_PATIENCE ||
                       (Math.abs(scrollStep) > FAST_SCROLL && dist > 130);

    if (buddy.mode === "jet" || leftBehind) {
      if (buddy.mode !== "jet") { buddy.mode = "jet"; buddy.t0 = now; }
      if (dist < JET_DONE) {
        buddy.mode = "walk";
        buddy.grip = null;
        buddy.t0 = now;
        chaseTime = 0;
        return;
      }
      const k = Math.min(1, (JET_SPEED * dt) / Math.max(dist, 1));
      buddy.x += (goal.x - buddy.x) * k;
      buddy.y = clampY(buddy.y + (goal.y - buddy.y) * k, H);
      if (Math.abs(goal.x - buddy.x) > 2) {
        buddy.facing = goal.x > buddy.x ? 1 : -1;
      }
      buddy.phase += dt * 10;
      return;
    }

    // --- climbing or sliding a block's edge -------------------------------
    if (buddy.mode === "climb" || buddy.mode === "slide") {
      const g = buddy.grip;
      const r = g && list.find((c) => c.id === g.id);
      if (!r) {
        buddy.mode = "walk";
        buddy.grip = null;
      } else {
        // Anchored to the block, so a scroll carries the figure along with
        // whatever it is holding on to while it works its way up or down.
        const speed = buddy.mode === "climb" ? CLIMB_SPEED : SLIDE_SPEED;
        const gap = g.toDy - g.dy;
        const sliding = buddy.mode === "slide";

        // Math.sign(0) is 0, which would leave it hanging on the edge
        // forever, so anything within one step of the target finishes.
        if (Math.abs(gap) <= speed * dt) {
          g.dy = g.toDy;
          buddy.mode = "walk";
          buddy.grip = null;
        } else {
          g.dy += Math.sign(gap) * speed * dt;
        }

        buddy.x = r.left + g.dx;
        buddy.y = clampY(r.top + g.dy, H);

        // Working past the mouth of a gap that is too short to stand in
        // but leads where the pointer is: let go and go in flat. Without
        // this a climb or slide only ever ends above or below a whole
        // card, and the lanes between the card rows never get used.
        const intoX = buddy.x + buddy.facing * (HALF_W + 4);
        const atGap = buddy.mode !== "walk" &&
                      Math.abs(goal.y - buddy.y) < H &&
                      blockAt(list, intoX, buddy.y, H) &&
                      !blockAt(list, intoX, buddy.y, CRAWL_H);

        if (!atGap) {
          buddy.phase += dt * (sliding ? 9 : 5.5);
          return;
        }

        buddy.mode = "crawl";
        buddy.grip = null;
      }
    }

    /* --- on foot ---------------------------------------------------------
       Anything not covered above is the figure making its own way there:
       walking, crawling under something too low to stand in, or going
       straight up and down in the open. */
    const dy = goal.y - buddy.y;
    const dxGoal = goal.x - buddy.x;

    // Back to walking unless something below decides otherwise. Without
    // this the figure keeps whichever pose it last had — it would carry on
    // playing the climb while moving sideways, all the way to the pointer.
    if (buddy.mode !== "crawl") buddy.mode = "walk";

    // Scroll direction wins while the page is moving, otherwise go the way
    // the pointer is: up and over the top, or down and past the bottom.
    const goUp = scrollStep < -1 ? true
               : scrollStep > 1 ? false
               : dy < 0;

    // Climbing is for going up and down, so it only runs while the way to
    // the pointer is steeper than 45 degrees and near enough straight
    // overhead; anything shallower is walked, height included.
    if (Math.abs(dxGoal) < 14 && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dxGoal)) {
      const stepY = Math.sign(dy) * Math.min(Math.abs(dy), SCALE_SPEED * dt);
      if (!blockAt(list, buddy.x, buddy.y + stepY, H)) {
        buddy.mode = "scale";
        buddy.y = clampY(buddy.y + stepY, H);
        buddy.phase += dt * 5;
        return;
      }
    }

    // A block directly above or below is as much in the way as one beside
    // it, but the figure cannot start climbing from the middle of a card's
    // face — it has to reach the near side first, so the walk aims there.
    let aimX = goal.x;
    let edgeWall = null;

    if (Math.abs(dy) > 3) {
      const probeY = buddy.y + Math.sign(dy) * Math.max(6, RISE_SPEED * dt);
      edgeWall = blockAt(list, buddy.x, probeY, H);
      if (edgeWall) {
        aimX = buddy.x < (edgeWall.left + edgeWall.right) * 0.5
             ? edgeWall.left - HALF_W - 2
             : edgeWall.right + HALF_W + 2;
      }
    }

    const crawling = buddy.mode === "crawl";
    const speed = crawling ? CRAWL_SPEED : WALK_SPEED;
    const dx = aimX - buddy.x;
    const stepX = Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
    const nextX = buddy.x + stepX;

    const standBlocked = blockAt(list, nextX, buddy.y, H);

    if (standBlocked) {
      // Too low to stand in. Try it flat where it is, and failing that
      // duck so the body tucks just under whatever the head is hitting —
      // the gaps between card rows are only a few pixels taller than the
      // crawl, so it will almost never already be at a height that fits.
      let crawlY = null;
      if (!blockAt(list, nextX, buddy.y, CRAWL_H)) {
        crawlY = buddy.y;
      } else {
        const duck = standBlocked.bottom + CRAWL_H;
        if (Math.abs(duck - buddy.y) <= 34 &&
            !blockAt(list, nextX, duck, CRAWL_H) &&
            !blockAt(list, buddy.x, duck, CRAWL_H)) {
          crawlY = duck;
        }
      }

      if (crawlY !== null) {
        buddy.mode = "crawl";
        buddy.y = crawlY;
      } else {
        // No way through at any height: take the edge.
        if (grab(standBlocked, goUp, now)) return;
        buddy.mode = crawling ? "crawl" : "walk";
      }
    } else if (crawling && !blockAt(list, buddy.x, buddy.y, H)) {
      // Clear overhead again: stand back up.
      buddy.mode = "walk";
    }

    const bodyH = buddy.mode === "crawl" ? CRAWL_H : H;

    if (!blockAt(list, nextX, buddy.y, bodyH)) {
      buddy.x = nextX;
      if (Math.abs(stepX) > 0.4) buddy.facing = stepX > 0 ? 1 : -1;
      buddy.phase += Math.abs(stepX) / (buddy.mode === "crawl" ? 5 : 7);
    }

    // Arrived alongside the block that was overhead or underfoot.
    if (edgeWall && Math.abs(buddy.x - aimX) < 4 && grab(edgeWall, goUp, now)) return;

    // Open air: drift toward the pointer's height.
    if (!edgeWall && Math.abs(dy) > 1) {
      const stepY = Math.sign(dy) * Math.min(Math.abs(dy), RISE_SPEED * dt);
      if (!blockAt(list, buddy.x, buddy.y + stepY, bodyH)) buddy.y += stepY;
    }

    // If it ends up overlapping anything anyway (a resize, a late image),
    // push it out the short way rather than leaving it stuck inside.
    const stuck = blockAt(list, buddy.x, buddy.y, bodyH);
    if (stuck) {
      const up = buddy.y - (stuck.top - 3);
      const down = (stuck.bottom + bodyH + 3) - buddy.y;
      buddy.y = up < down ? stuck.top - 3 : stuck.bottom + bodyH + 3;
    }

    buddy.x = Math.max(HALF_W + 4, Math.min(vw - HALF_W - 4, buddy.x));
    buddy.y = clampY(buddy.y, bodyH + 4);
  }

  /* ------------------------------------------------------------ the render */
  function draw(now) {
    ctx.clearRect(0, 0, vw, vh);
    ctx.save();
    ctx.translate(buddy.x, buddy.y);
    ctx.scale(buddy.facing, 1);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    switch (buddy.mode) {
      case "perch":   posePerch(now); break;
      case "drop":    poseJump(Math.min(1, (now - buddy.t0) / DROP_MS)); break;
      case "startle": poseStartle(Math.min(1, (now - buddy.t0) / STARTLE_MS)); break;
      case "crawl":   poseCrawl(buddy.phase); break;
      case "scale":   poseScale(buddy.phase); break;
      case "climb":   poseClimb(buddy.phase); break;
      case "slide":   poseSlide(buddy.phase); break;
      case "jet":     poseJet(buddy.phase); break;
      case "sit":     poseSit(now); break;
      default:        poseWalk(buddy.phase);
    }

    ctx.restore();
  }

  /* -------------------------------------------------------------- the loop */
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);   // cap after a tab switch
    last = now;

    const sy = window.scrollY;
    scrollStep = sy - scrollY;
    scrollY = sy;

    step(dt, now);
    draw(now);

    // Mirrored onto the element so the current state is inspectable from
    // outside; written only on a change, not every frame.
    if (canvas.dataset.mode !== buddy.mode) canvas.dataset.mode = buddy.mode;

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
