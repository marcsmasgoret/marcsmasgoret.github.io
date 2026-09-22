/* ==========================================================================
   Cursor buddy — home page only.

   A stick figure that chases the pointer around the page. What it can and
   cannot walk through:

     - Project cards are solid panels, so their box is their shape.
     - Text is not. A heading's element box runs the full content width
       while its glyphs stop far short of it, so measuring the element
       would leave an invisible wall out to the right of the hero copy.
       Text obstacles are measured off the rendered text instead, one box
       per line, and each box is that line's ink rather than the box the
       browser gives the line: that one runs the font's full ascent and
       descent, which over the display-size title is a band of empty air
       above the capitals two-thirds the figure's height.

   Movement: it walks side to side; drops to a crawl where a gap is too
   short to stand in (the gaps between card rows), on all fours along the
   top of whatever is underneath; climbs or slides a block's near edge
   when one is in the way; climbs with its back to us when it is going
   straight up or down in open air; and flies on a jetpack when a scroll
   or a losing chase leaves it behind.

   It is confined to the page between the header and the footer, so it
   never walks over the nav or the footer columns.

   It sits when it arrives, and stays sat where it is on the page, not on
   the screen: a scroll carries it off with the page, and it gets up once
   the pointer is elsewhere. If the pointer is resting on a project card, it
   hops up onto that card's top-left corner and sits with its legs over the
   edge, riding along as the page scrolls. On the hero text, where it can
   never stand, it settles on the nearest corner instead. Clicking it while
   it sits startles it, and the first time it sits it says so. Once it has
   been clicked, the first time it then sits still for a second it holds up
   a few signs with an opinion on the matter, and it makes the point again
   every fifth time after that it sits for a second.
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

  // Going up or down an edge, something further along that sticks out past
  // it by no more than this is cleared by stepping the path out, sideways
  // at SIDESTEP_SPEED; anything sticking out further is walked round (see
  // grab).
  const JUT = 12;
  const SIDESTEP_SPEED = 120;   // px/s

  const WALK_SPEED = 190;       // px/s
  const CRAWL_SPEED = 120;
  const RISE_SPEED = 85;        // vertical drift while walking open ground
  const SCALE_SPEED = 120;      // straight up or down in open air
  const SCALE_CYCLE = 36;       // px climbed per full cycle of both hands
  const SCALE_REACH = 0.3;      // share of each limb's cycle spent reaching
  const CLIMB_SPEED = 135;
  const SLIDE_SPEED = 280;
  const JET_SPEED = 660;

  const SETTLE_SPEED = 160;     // getting down onto the floor of a gap

  const CATCH_DIST = 14;        // close enough to sit
  // ...or, heading for the corner of something to sit on, this close. Sat
  // down CATCH_DIST short of it, coming down from above, it would sit in
  // the air over the letters of the title instead of on them.
  const SNUG_DIST = 3;
  const LEAVE_DIST = 40;        // and far enough to get back up
  const GETUP_MS = 400;         // ...for this long, so passing by doesn't count
  const JET_DONE = 70;

  // Sat on a card's corner, the seat is this far in from the left edge:
  // just on the flat of the top, clear of the 16px rounded corner, which
  // the thighs then follow down so the shins hang over it.
  const SEAT_IN = 15;
  const HOP_ARC = 10;

  const FAST_SCROLL = 1400;     // px/s of scroll
  const JET_GAP = 1300;         // hopeless even to start walking
  const JET_PATIENCE = 3.2;     // seconds of chasing without arriving
  const JET_CHASING = 260;      // ...while still this far away

  const PERCH_MS = 1600;
  const PERCH_IN = 5;           // seat's distance in from the logo's right edge
  const DROP_MS = 720;
  const STARTLE_MS = 620;

  const HINT_DELAY = 350;       // sat this long before "Click me!" shows
  const HINT_SHOW_MS = 5000;    // then it stays up this long, and goes for good
  const HINT_FADE_MS = 250;     // fading out over the last of that

  // Having been clicked once, sat this long without a break, it holds up
  // these one at a time, putting each away before the next. After that, a
  // sit this long counts toward the next time, which is every SIGN_EVERY-th.
  const SIGN_AFTER_MS = 1000;
  const SIGN_EVERY = 5;
  const SIGNS = [
    { text: "YOU SHOULD", hold: 2300 },
    { text: "PROBABLY", hold: 2100 },
    { text: "HIRE ME ;)", hold: 3400 },
  ];
  const SIGN_UP_MS = 240;
  const SIGN_DOWN_MS = 200;
  const SIGN_GAP_MS = 320;

  /* ------------------------------------------------------------- obstacles */
  let sources = [];
  let seats = [];

  function collectBlocks() {
    sources = [];
    document.querySelectorAll(".work-card").forEach((el) => sources.push({ el }));

    // Ranges, not elements: see the note at the top of the file.
    document.querySelectorAll(".home-title, .home-sub").forEach((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      sources.push({ range, ink: measureInk(el, range) });
    });

    // What it sits on the corner of: each project card.
    seats = [];
    document.querySelectorAll(".work-card").forEach((el) => seats.push({ el }));
  }

  // Where the glyphs of each line of `el` actually are, as offsets from the
  // left and bottom of the box the browser gives that line (which is the
  // font's content area: the baseline sits the font's descent above its
  // bottom). Each line is measured on a canvas in the element's own font,
  // with the words the layout put on it. Null for a line the canvas can't
  // measure, which then keeps its plain box.
  const inkCtx = document.createElement("canvas").getContext("2d");

  function measureInk(el, range) {
    const style = getComputedStyle(el);
    inkCtx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    inkCtx.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
    const lineH = parseFloat(style.lineHeight);

    const words = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const m of node.textContent.matchAll(/\S+/g)) {
        const wr = document.createRange();
        wr.setStart(node, m.index);
        wr.setEnd(node, m.index + m[0].length);
        const box = wr.getBoundingClientRect();
        words.push({ text: m[0], x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });
      }
    }

    const out = [];
    for (const f of range.getClientRects()) {
      if (f.width < 4 || f.height < 4) continue;
      const text = words
        .filter((w) => w.y > f.top && w.y < f.bottom && w.x > f.left && w.x < f.right)
        .map((w) => w.text)
        .join(" ");
      const m = inkCtx.measureText(text);
      const base = -m.fontBoundingBoxDescent;
      // Without canvas letter-spacing the width comes out wrong, and so
      // would the right-hand end: then the line keeps its own sides.
      const sides = Math.abs(m.width - f.width) < 3;
      out.push(text && Number.isFinite(base) ? {
        left: sides ? -m.actualBoundingBoxLeft : 0,
        right: sides ? m.actualBoundingBoxRight : f.width,
        top: base - m.actualBoundingBoxAscent,
        bottom: base + m.actualBoundingBoxDescent,
        lead: lineH > f.height ? (lineH - f.height) / 2 : 0,
      } : null);
    }
    return out;
  }

  collectBlocks();
  window.addEventListener("load", collectBlocks);
  // Lines rewrap on a resize, and the web font changes every measurement
  // when it lands.
  window.addEventListener("resize", collectBlocks);
  if (document.fonts) document.fonts.ready.then(collectBlocks);

  // Read fresh every frame: boxes move with every scroll, and reading them
  // back to back costs one layout pass because nothing writes in between.
  // A line of text also carries its `zone`, the whole of its line box, for
  // telling whether the pointer is on it.
  function rects() {
    const out = [];
    sources.forEach((src, si) => {
      const boxes = src.range
        ? src.range.getClientRects()
        : [src.el.getBoundingClientRect()];

      let line = 0;
      for (let bi = 0; bi < boxes.length; bi++) {
        const r = boxes[bi];
        if (r.width < 4 || r.height < 4) continue;
        const ink = src.ink && src.ink[line++];
        if (r.bottom < -80 || r.top > vh + 80) continue;
        const box = {
          id: `${si}:${bi}`,
          left: r.left - PAD_X,
          right: r.right + PAD_X,
          top: r.top - PAD_Y,
          bottom: r.bottom + PAD_Y,
        };
        if (ink) {
          box.zone = { ...box, top: r.top - ink.lead, bottom: r.bottom + ink.lead };
          box.left = r.left + ink.left - PAD_X;
          box.right = r.left + ink.right + PAD_X;
          box.top = r.bottom + ink.top - PAD_Y;
          box.bottom = r.bottom + ink.bottom + PAD_Y;
        }
        out.push(box);
      }
    });
    fillTextGaps(out);
    return out;
  }

  // The space between one line of text and the next is too short to stand
  // in, and a crawl would fit only between the title and the lede, where
  // the figure ducked in off either end and stuck fast. So wherever a line
  // sits over the next, the gap between them is filled in, and the text
  // reads as one stepped block. The two lines' zones meet halfway across
  // it, so a pointer resting in the gap is on one line or the other.
  function fillTextGaps(out) {
    const lines = out.filter((b) => b.zone);
    for (const a of lines) {
      for (const b of lines) {
        const gap = b.top - a.bottom;
        if (gap <= 0 || gap >= H) continue;
        const left = Math.max(a.left, b.left);
        const right = Math.min(a.right, b.right);
        if (right - left < 1) continue;
        // Only the next line down, not one further below it.
        if (lines.some((c) => c !== a && c !== b && c.top >= a.bottom && c.bottom <= b.top &&
                              c.left < right && c.right > left)) continue;
        out.push({ id: `${a.id}|${b.id}`, fill: true, left, right, top: a.bottom, bottom: b.top });
        if (a.zone.bottom < b.zone.top) a.zone.bottom = b.zone.top = (a.zone.bottom + b.zone.top) / 2;
      }
    }
  }

  function hits(r, x, y, h) {
    return x + HALF_W > r.left && x - HALF_W < r.right &&
           y > r.top && y - h < r.bottom;
  }

  function blockAt(list, x, y, h) {
    for (const r of list) if (hits(r, x, y, h)) return r;
    return null;
  }

  // The floor of a gap: the top of whatever is directly underneath, near
  // the height it is at now, with room above it to crawl.
  function floorUnder(list, x, y) {
    let best = null;
    for (const r of list) {
      if (x + HALF_W <= r.left || x - HALF_W >= r.right) continue;
      const fy = r.top - 1;
      if (Math.abs(fy - y) > 34 || blockAt(list, x, fy, CRAWL_H)) continue;
      if (best === null || Math.abs(fy - y) < Math.abs(best - y)) best = fy;
    }
    return best;
  }

  // Somewhere to stand at this height, at x or a step either side of it,
  // or null. Down the gap between two columns the figure overlaps the card
  // beside it by four pixels, so past the end of that card (a short last
  // row) open ground is only a step away.
  function standNear(list, x, y) {
    for (const d of [0, 4, -4]) if (!blockAt(list, x + d, y, H)) return x + d;
    return null;
  }

  /* ----------------------------------------------------------------- seats */
  // A seat's box, or null once it has scrolled out of view.
  function seatRect(seat) {
    const r = seat.el.getBoundingClientRect();
    if (r.width < 24 || r.bottom < 0 || r.top > vh) return null;
    return r;
  }

  // The card the pointer is on. Widened by half a gap each side, so the
  // pointer never falls between two cards. One whose top is up under the
  // header doesn't count: there's no room to sit there.
  function seatUnderPointer() {
    for (const seat of seats) {
      const r = seatRect(seat);
      if (!r || r.top - 24 < band.top) continue;
      if (target.x >= r.left - 11 && target.x <= r.right + 11 &&
          target.y >= r.top && target.y <= r.bottom) return { seat, r };
    }
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
    mode: "perch",   // perch drop walk crawl scale climb slide jet sit hop ledge startle
    x: vw / 2,
    y: 200,
    facing: 1,
    phase: 0,
    t0: performance.now(),
    dropFrom: null,
    dropTo: null,
    grip: null,      // { id, x, dx, dy, toDy } while climbing or sliding
    seat: null,      // the card it is hopping onto or sat on the corner of
    hopMs: 0,
    awaySince: 0,    // while sat: when the pointer went elsewhere
    startleY: 0,
  };

  // The "Click me!" bubble: up the first time it sits, for HINT_SHOW_MS,
  // then gone for good, even if it is still sitting. A click retires it
  // early. Getting up before the time is out takes the bubble with it, and
  // it starts over, in full, the next time it sits.
  let seatedAt = 0;
  let hintShown = 0;    // ms on screen during this sit
  let hintDone = false;
  let hintBox = null;   // where it was last drawn, so a click on it counts

  // The signs: first once it has been clicked, then again every
  // SIGN_EVERY long sits after each full run. Getting up before the last
  // one shows calls a run off, and it tries again the next long sit.
  let clickedOnce = false;
  let signOwed = false;   // a run is due the next time it sits long enough
  let longSits = 0;       // long sits since the last full run
  let sitCounted = false; // this sit has already been counted
  let signStart = 0;      // when the current run of signs began, 0 if none
  let signHand = null;  // where the pose put the hand on the pole, in pose space

  // Reaching for the bubble takes the pointer well away from the figure,
  // so while it is up, the pointer on it (or anywhere between it and the
  // seat) counts as being on the figure: otherwise it would get up and
  // walk off before the click landed.
  function pointerOnHint() {
    if (!hintBox) return false;
    const left = Math.min(hintBox.x, buddy.x - HALF_W) - 6;
    const right = Math.max(hintBox.x + hintBox.w, buddy.x + HALF_W) + 6;
    return target.x >= left && target.x <= right &&
           target.y >= hintBox.y - 6 && target.y <= buddy.y + 4;
  }

  // Sat down, it only gets up once the pointer has been away for a moment,
  // so a pointer on its way to the figure or its bubble doesn't send it off.
  function readyToGetUp(away, now) {
    if (!away) { buddy.awaySince = 0; return false; }
    if (!buddy.awaySince) buddy.awaySince = now;
    if (now - buddy.awaySince <= GETUP_MS) return false;
    buddy.awaySince = 0;   // cleared for the next time it sits
    return true;
  }

  const target = { x: vw / 2, y: vh / 2 };

  window.addEventListener("mousemove", (e) => {
    target.x = e.clientX;
    target.y = e.clientY;
  }, { passive: true });

  let scrollY = window.scrollY;
  let scrollStep = 0;
  let chaseTime = 0;

  // Resting (sat down, or waiting on all fours in a gap between rows), it
  // keeps its place on the page rather than on the screen. The pointer's
  // position is on the screen, so without this a scroll would leave the
  // two exactly as far apart as before, and it would ride along under the
  // pointer over whatever the page brought past.
  let resting = false;

  // Clicking it while it is sitting startles it. The canvas never takes
  // pointer events, so this hit-tests by hand on the way down and swallows
  // the click only when the figure itself was hit.
  document.addEventListener("click", (e) => {
    const m = buddy.mode;
    if (m !== "sit" && m !== "perch" && m !== "ledge") return;

    // The bubble asks to be clicked, so a click on it counts too.
    const onHint = hintBox &&
      e.clientX >= hintBox.x && e.clientX <= hintBox.x + hintBox.w &&
      e.clientY >= hintBox.y && e.clientY <= hintBox.y + hintBox.h;

    if (!onHint) {
      const top = m === "perch" ? buddy.y + TORSO + HEAD_OFF - HEAD_R
                : m === "ledge" ? buddy.y - 22
                : buddy.y - H;
      const bottom = m === "perch" ? buddy.y + LEG
                   : m === "ledge" ? buddy.y + 10
                   : buddy.y;
      if (Math.abs(e.clientX - buddy.x) > HALF_W + 8) return;
      if (e.clientY < top - 8 || e.clientY > bottom + 8) return;
    }

    e.preventDefault();
    e.stopPropagation();

    // A ledge seat is already on the card's top edge, which is where its
    // feet land; only the logo perch is measured from the seat.
    if (m === "perch") buddy.y += LEG;   // seat-based -> feet-based
    buddy.mode = "startle";
    buddy.seat = null;
    buddy.t0 = performance.now();
    buddy.startleY = buddy.y;
    chaseTime = 0;
    hintDone = true;
    if (!clickedOnce) signOwed = true;
    clickedOnce = true;
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

  // On all fours — the only way through a gap shorter than it is. The
  // origin is on the floor, and the hands and knees come down onto it, so
  // it crawls along the top of whatever is underneath. Opposite hand and
  // knee move together, and whichever pair is coming forward lifts; the
  // pair going back is planted and pushing. The body stays inside CRAWL_H.
  function poseCrawl(p) {
    const s = Math.sin(p);
    const c = Math.cos(p);
    const bob = Math.abs(c) * 0.6;
    const hipX = -6, hipY = -8.5 - bob;
    const shoX = 5, shoY = -9.5 - bob;

    line(hipX, hipY, shoX, shoY);
    head(shoY - 1.2, shoX + 5.8);

    const reach = 3.5;
    const liftA = Math.max(0, c);
    const liftB = Math.max(0, -c);

    line(shoX, shoY, shoX + 1 + s * reach, -liftA * 2.5);
    line(shoX, shoY, shoX + 1 - s * reach, -liftB * 2.5);

    // Knee on the floor, shin trailing back along it to a raised toe.
    const knee = (kx, lift) => {
      line(hipX, hipY, kx, -lift * 2);
      line(kx, -lift * 2, kx - 8, -1.5 - lift);
    };
    knee(hipX + 1 + s * reach, liftA);
    knee(hipX + 1 - s * reach, liftB);
  }

  // Going straight up or down in the open, seen from behind, like someone
  // on a climbing wall. Both hands stay up on holds above the shoulders;
  // each in turn reaches quickly for the next one, the opposite foot
  // stepping up just after it, then pulls down to shoulder height as the
  // body rises past it while that foot pushes its leg straight. Elbows
  // and knees splay out, as they do on a wall. `p` runs with the distance
  // climbed (see SCALE_CYCLE), and backwards on the way down, which plays
  // the climb in reverse.
  function poseScale(p) {
    const c = p / (Math.PI * 2);
    const sway = Math.sin(p) * 1.2;   // weight shifting from side to side

    for (const side of [1, -1]) {
      const hand = onHold(c + (side > 0 ? 0 : 0.5));
      const foot = onHold(c + (side > 0 ? 0.58 : 0.08), 0.45);
      bend(sway, HIP,
           side * (3 + foot.up * 3 + foot.arc * 2), -0.5 - foot.up * 8,
           LEG * 0.5, side, -0.2);
      bend(sway * 0.6, SHO,
           side * (7 - hand.up * 2 + hand.arc * 2), SHO - 2 - hand.up * 10,
           ARM * 0.5, side, 0.5);
    }

    line(sway, HIP, sway * 0.6, SHO);
    head(HEAD_Y, sway * 0.6);
  }

  // Where one limb is in its climbing cycle `c`: `up` from 0 (low) to 1
  // (high), and `arc`, how far out it swings on the way. A quick reach up
  // to the next hold, then on it, going down relative to the body as the
  // body goes up past it. A foot pushes its leg straight in the first
  // `push` of that and then stands on it, so the legs read as stepping
  // rather than squatting.
  function onHold(c, push = 1) {
    const k = c - Math.floor(c);
    if (k < SCALE_REACH) {
      const s = k / SCALE_REACH;
      return { up: s * s * (3 - 2 * s), arc: Math.sin(Math.PI * s) };
    }
    const t = (k - SCALE_REACH) / (1 - SCALE_REACH) / push;
    return { up: Math.max(0, 1 - t), arc: 0 };
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

  // Perched on the logo's top right corner. The origin is the seat, on the
  // top edge PERCH_IN from the corner: thighs run out along the top and
  // over the corner, and the shins hang down clear of the logo's side.
  // Hung straight down its face instead, white on the white mark, the legs
  // vanished and the figure looked to be standing behind it. A hand is
  // planted on the top behind, the other rests on a thigh.
  function posePerch(now) {
    const swing = Math.sin(now / 470) * 0.2;
    limb(0, 0, 1.52, LEG * 0.52, 0.1 + swing, LEG * 0.48);
    limb(0, 0, 1.62, LEG * 0.52, -0.05 - swing * 0.6, LEG * 0.48);

    const lean = 0.2;
    const sx = -Math.sin(lean) * TORSO;   // TORSO is negative: upward
    const sy = Math.cos(lean) * TORSO;
    const hx = sx - Math.sin(lean) * HEAD_OFF;
    const hy = sy + Math.cos(lean) * HEAD_OFF;
    line(0, 0, sx, sy);
    head(hy, hx);

    seatedArms(sx, sy, [[-0.55, -0.72], [0.1, 0.32]], hx, hy, 0);
  }

  // Sat on a card's top-left corner: thighs running down the curve of the
  // rounded corner, shins swinging over it, one hand planted behind and
  // one on a thigh, hunched forward to watch. The origin is the seat, on
  // the card's top edge. The hunch also keeps the head clear of the row
  // above when it sits in the gap between two rows.
  function poseLedge(now, up = 0) {
    const swing = Math.sin(now / 430) * 0.3;
    limb(0, 0, 1.2, LEG * 0.5, 0.15 + swing, LEG * 0.5);
    limb(0, 0, 1.1, LEG * 0.5, -0.05 - swing * 0.5, LEG * 0.5);

    const lean = 0.3;
    const sx = -Math.sin(lean) * TORSO;   // TORSO is negative: upward
    const sy = Math.cos(lean) * TORSO;
    const hx = sx - Math.sin(lean) * HEAD_OFF;
    const hy = sy + Math.cos(lean) * HEAD_OFF;
    line(0, 0, sx, sy);
    head(hy, hx);

    seatedArms(sx, sy, [[-0.55, -0.72], [0.1, 0.32]], hx, hy, up);
  }

  function poseSit(now, up = 0) {
    const breathe = Math.sin(now / 620) * 0.7;
    const hip = -H * 0.27 + breathe;
    const sho = hip + TORSO;
    limb(0, hip, 1.45, LEG * 0.52, 0.12, LEG * 0.48);
    limb(0, hip, 1.2, LEG * 0.52, 0.0, LEG * 0.48);
    line(0, hip, 0, sho);
    seatedArms(0, sho, [[0.5, 1.0], [-0.45, -0.05]], 0, sho + HEAD_OFF, up);
    head(sho + HEAD_OFF);
  }

  // A sitting pose's arms: as posed, or raised by `up` (0 to 1) toward a
  // pole held out in front of the face, one hand under the other. Far
  // enough forward that the arms and pole read clear of the head. Where
  // the upper hand ends up is left in signHand for the sign.
  function seatedArms(sx, sy, arms, headX, headY, up) {
    if (!up) {
      arms.forEach(([a1, a2]) => limb(sx, sy, a1, ARM * 0.5, a2, ARM * 0.5));
      return;
    }
    const gx = headX + 9;
    const gy = headY - 3;
    arms.forEach(([a1, a2], i) => {
      const rx = sx + (Math.sin(a1) + Math.sin(a2)) * ARM * 0.5;
      const ry = sy + (Math.cos(a1) + Math.cos(a2)) * ARM * 0.5;
      const x = rx + (gx - rx) * up;
      const y = ry + (gy + i * 3 - ry) * up;
      reach(sx, sy, x, y, ARM * 0.5);
      if (i === 0) signHand = { x, y };
    });
  }

  // A two-part limb from (ax, ay) to a given hand position, the elbow
  // falling out in front. Past full reach it just runs straight.
  function reach(ax, ay, bx, by, len) {
    const dx = bx - ax;
    const dy = by - ay;
    const d = Math.hypot(dx, dy) || 0.01;
    const half = Math.min(d, len * 2) / 2;
    const out = Math.sqrt(Math.max(0, len * len - half * half));
    const jx = ax + (dx / d) * half - (dy / d) * out;
    const jy = ay + (dy / d) * half + (dx / d) * out;
    line(ax, ay, jx, jy);
    line(jx, jy, bx, by);
  }

  // The same, with the joint bent toward (prefX, prefY): out to the side
  // for a figure seen from behind, where "in front" is into the page.
  function bend(ax, ay, bx, by, len, prefX, prefY) {
    const dx = bx - ax;
    const dy = by - ay;
    const d = Math.hypot(dx, dy) || 0.01;
    const half = Math.min(d, len * 2) / 2;
    const out = Math.sqrt(Math.max(0, len * len - half * half));
    const flip = (-dy * prefX + dx * prefY) < 0 ? -1 : 1;
    const jx = ax + (dx / d) * half - (dy / d) * out * flip;
    const jy = ay + (dy / d) * half + (dx / d) * out * flip;
    line(ax, ay, jx, jy);
    line(jx, jy, bx, by);
  }

  /* ------------------------------------------------------------ the update */
  // The pointer often rests on top of a card, somewhere the figure can
  // never stand. On a card it heads for the top-left corner to sit on. Anything else it can't stand in (the hero
  // text) it aims for that block's nearest corner — never a point along
  // one of its sides, which is not somewhere to sit.
  function reachable(list) {
    const on = seatUnderPointer();
    if (on) return { x: on.r.left + SEAT_IN, y: on.r.top - 1, seat: on.seat };

    // On text, anywhere in a line's box counts, not just on its ink, or the
    // pointer would fall through the space between two lines and above the
    // capitals, and send the figure after a point it can never stand in.
    const r = list.find((b) => !b.fill && hits(b.zone || b, target.x, target.y, 1));
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
    // A corner it can stand on is somewhere to sit right on, not just near
    // (see SNUG_DIST).
    return { ...best, snug: open.length > 0 };
  }

  // Grab a block's near edge and start working up or down it. Returns false
  // when the figure is already where that would end, which would otherwise
  // finish instantly and re-trigger on the very next frame.
  function grab(list, wall, goUp, now) {
    const fromLeft = buddy.x < (wall.left + wall.right) * 0.5;
    const column = (r) => fromLeft ? r.left - HALF_W - 2 : r.right + HALF_W + 2;
    let edgeX = column(wall);

    // Off the end of the wall, and on past anything else in line with it.
    // The gap between two columns of cards is too narrow to stand in, so
    // stopping just past this card would leave it in the next row's stretch
    // of the same gap: pushed back up out of it, it would grab this edge
    // again and slide straight back down, over and over. It keeps going
    // until it comes out somewhere it can stand, or turns off into a row
    // gap on the way (see the climb and slide step).
    //
    // That card across the gap only clips the far side of the figure.
    // Something reaching right across the path to the wall's side would be
    // gone straight through: the end of a long line of text above or below
    // a shorter one. One that sticks out only a little (the lede's first
    // letters, a few pixels left of the title's) moves the path out to
    // clear it; one that sticks out further is where the climb or slide
    // stops, just short of it, for the figure to walk out round it.
    //
    // Each pass takes everything the figure would touch on the whole way
    // from where it is, not just at the end: two lines of text can both be
    // in the way at once, and stopping short of only the one found first
    // can leave it inside the other.
    const home = edgeX;
    let endY = goUp ? wall.top - 3 : wall.bottom + H + 3;
    let short = false;
    for (let i = 0; i < 20; i++) {
      // Ahead of it only: not what it is standing on going up, or what is
      // over its head going down.
      const lo = goUp ? endY - H : buddy.y - H + 1;
      const hi = goUp ? buddy.y - 1 : endY;
      const inWay = list.filter((r) => r !== wall &&
        edgeX + HALF_W > r.left && edgeX - HALF_W < r.right && r.bottom > lo && r.top < hi);
      if (!inWay.length) break;

      const across = inWay.filter((r) => fromLeft ? r.right > edgeX + HALF_W : r.left < edgeX - HALF_W);
      const far = across.filter((r) => Math.abs(column(r) - home) > JUT);
      if (far.length) {
        endY = goUp ? Math.max(...far.map((r) => r.bottom)) + H + 3
                    : Math.min(...far.map((r) => r.top)) - 3;
        short = true;
        break;
      }
      if (across.length) {
        edgeX = fromLeft ? Math.min(...across.map(column)) : Math.max(...across.map(column));
        continue;
      }
      const past = goUp ? Math.min(endY, ...inWay.map((r) => r.top - 3))
                        : Math.max(endY, ...inWay.map((r) => r.bottom + H + 3));
      if (past === endY) break;
      endY = past;
    }

    const toDy = Math.max(band.top + H + 6, Math.min(band.bottom - 6, endY)) - wall.top;
    const fromDy = buddy.y - wall.top;
    if (Math.abs(toDy - fromDy) < 5) return false;
    // Stopping short of an overhang it is already level with or past.
    if (short && (goUp ? toDy > fromDy : toDy < fromDy)) return false;

    // Straight onto the wall's edge, as ever (which also frees a figure
    // that has blundered into the block); any step out from there to clear
    // something further along is taken on the way.
    buddy.mode = goUp ? "climb" : "slide";
    buddy.facing = fromLeft ? 1 : -1;
    buddy.t0 = now;
    buddy.grip = { id: wall.id, x: home - wall.left, dx: edgeX - wall.left, dy: fromDy, toDy };
    return true;
  }

  // Off a card's corner and back on its feet. If there is no headroom
  // there (a gap between rows), the on-foot step puts it on all fours.
  function getUp(now) {
    buddy.mode = "walk";
    buddy.seat = null;
    buddy.t0 = now;
  }

  function step(dt, now) {
    measureBand();
    if (resting) buddy.y -= scrollStep;
    resting = false;
    const list = rects();
    const goal = reachable(list);
    const clamped = clampY(goal.y, H);
    // A corner moved to keep it inside the band may be nowhere to stand.
    if (clamped !== goal.y) goal.snug = false;
    goal.y = clamped;
    const dist = Math.hypot(goal.x - buddy.x, goal.y - buddy.y);

    // --- perched on the logo, waiting to jump off -------------------------
    if (buddy.mode === "perch") {
      // Measured on the mark itself, not the padded link, and seated on its
      // top corner so the letters stay readable underneath. A pixel above
      // the top edge, so the thighs lie on it rather than across it.
      const mark = document.querySelector(".site-monogram .monogram-mark");
      if (mark) {
        const r = mark.getBoundingClientRect();
        buddy.x = r.right - PERCH_IN;
        buddy.y = r.top - 1;
        buddy.facing = 1;
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

    // --- hopping up onto a card's corner ----------------------------------
    if (buddy.mode === "hop") {
      const r = seatRect(buddy.seat);
      if (!r) { getUp(now); return; }
      // Aimed at where the corner is now, so a scroll mid-hop still lands
      // it there.
      const t = Math.min(1, (now - buddy.t0) / buddy.hopMs);
      const toX = r.left + SEAT_IN;
      const toY = r.top - 1;
      buddy.x = buddy.dropFrom.x + (toX - buddy.dropFrom.x) * t;
      buddy.y = buddy.dropFrom.y + (toY - buddy.dropFrom.y) * t
              - Math.sin(Math.PI * t) * HOP_ARC;
      if (t >= 1) { buddy.mode = "ledge"; buddy.facing = -1; buddy.t0 = now; }
      return;
    }

    // --- sat on a card's corner, riding along with it -----------------------
    if (buddy.mode === "ledge") {
      chaseTime = 0;
      const r = seatRect(buddy.seat);
      if (r) {
        buddy.x = r.left + SEAT_IN;
        buddy.y = r.top - 1;
      }
      // It stays while the pointer is on this card, or has come off it
      // onto the figure or its bubble (to click it).
      const stay = pointerOnHint() || (goal.seat
        ? goal.seat.el === buddy.seat.el
        : Math.hypot(goal.x - buddy.x, goal.y - buddy.y) < LEAVE_DIST);
      if (!r || readyToGetUp(!stay, now)) getUp(now);
      return;
    }

    // --- caught up: sit, and stay sitting until the pointer moves off -----
    if (buddy.mode === "sit") {
      chaseTime = 0;
      // Carried up under the header or down off the screen by a scroll: up
      // at once, and the on-foot step brings it back inside the band.
      const outside = buddy.y - H < band.top || buddy.y > band.bottom;
      if (outside) buddy.awaySince = 0;
      if (outside || readyToGetUp((dist > LEAVE_DIST || goal.seat) && !pointerOnHint(), now)) {
        buddy.mode = "walk";
        buddy.t0 = now;
        return;
      }
      resting = true;
      return;
    }

    // Only ever sit having finished a climb or slide, never part way up the
    // side of a block.
    const catchDist = goal.snug ? SNUG_DIST : CATCH_DIST;
    if (dist < catchDist && buddy.mode !== "climb" && buddy.mode !== "slide") {
      chaseTime = 0;

      // On a card: hop up onto its corner rather than sit where it is.
      if (goal.seat) {
        buddy.mode = "hop";
        buddy.seat = goal.seat;
        buddy.t0 = now;
        buddy.hopMs = 170 + dist * 4;
        buddy.dropFrom = { x: buddy.x, y: buddy.y };
        if (Math.abs(goal.x - buddy.x) > 2) buddy.facing = goal.x > buddy.x ? 1 : -1;
        return;
      }

      // Too low to sit up in (a gap between rows): wait there on all fours.
      resting = true;
      if (buddy.mode === "crawl" && blockAt(list, buddy.x, buddy.y, H)) return;

      buddy.mode = "sit";
      buddy.t0 = now;
      return;
    }

    // --- jetpack: left behind, fly straight to the pointer ----------------
    chaseTime = dist > JET_CHASING ? chaseTime + dt : 0;

    const leftBehind = dist > JET_GAP ||
                       chaseTime > JET_PATIENCE ||
                       (Math.abs(scrollStep) > FAST_SCROLL * dt && dist > 130);

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
        // The pointer has gone well past the other way, and the page is
        // still: turn round on the edge rather than carry on to the far end
        // first, which down the gap between two columns can be the height
        // of two cards.
        const wantUp = goal.y < buddy.y;
        if (Math.abs(scrollStep) <= 1 && Math.abs(goal.y - buddy.y) > H &&
            wantUp !== (buddy.mode === "climb") && grab(list, r, wantUp, now)) return;

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

        // Across onto the path grab() chose, where that steps out to clear
        // something further along.
        const side = g.dx - g.x;
        g.x += Math.sign(side) * Math.min(Math.abs(side), SIDESTEP_SPEED * dt);

        buddy.x = r.left + g.x;
        buddy.y = clampY(r.top + g.dy, H);

        // Working past the mouth of a gap that is too short to stand in
        // but leads where the pointer is: let go and go in flat. Without
        // this a climb or slide only ever ends above or below a whole
        // card, and the lanes between the card rows never get used.
        // The mouth is found by its floor, within a step either way, so a
        // slow frame's longer step can't carry it past: the window where
        // the head is under the row above and the body still clears the
        // row below is only seven pixels tall.
        const intoX = buddy.x + buddy.facing * (HALF_W + 4);
        const mouth = buddy.mode === "walk" ? null : floorUnder(list, intoX, buddy.y);
        const atGap = mouth !== null &&
                      Math.abs(mouth - buddy.y) <= Math.max(8, speed * dt) &&
                      Math.abs(goal.y - mouth) < H &&
                      blockAt(list, intoX, mouth, H) &&
                      !blockAt(list, buddy.x, mouth, CRAWL_H);

        // Level with the pointer, out in the open where it can stand: let
        // go and walk the rest, rather than carry on to the end of the edge
        // and have to come back.
        const level = !atGap && buddy.mode !== "walk" &&
                      Math.abs(g.toDy - g.dy) > 12 &&
                      Math.abs(goal.y - buddy.y) <= Math.max(4, speed * dt);
        const standX = level ? standNear(list, buddy.x, buddy.y) : null;

        if (atGap) {
          buddy.y = mouth;
          buddy.mode = "crawl";
          buddy.grip = null;
        } else if (standX !== null) {
          buddy.x = standX;
          buddy.mode = "walk";
          buddy.grip = null;
        } else {
          buddy.phase += dt * (sliding ? 9 : 5.5);
          return;
        }
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
        // By distance, not time, so what is on a hold stays on it.
        buddy.phase -= stepY * (Math.PI * 2) / SCALE_CYCLE;
        return;
      }
    }

    // Down on the floor of a gap the pointer is in too: there is nothing to
    // climb, it just crawls along to it. Without this the row above counts
    // as a block overhead, and it would head off to climb it.
    const floorHere = buddy.mode === "crawl" ? floorUnder(list, buddy.x, buddy.y) : null;
    const sameGap = floorHere !== null && Math.abs(goal.y - floorHere) < CRAWL_H + 10;

    // A block directly above or below is as much in the way as one beside
    // it, but the figure cannot start climbing from the middle of a card's
    // face — it has to reach the near side first, so the walk aims there.
    let aimX = goal.x;
    let edgeWall = null;

    if (Math.abs(dy) > 3 && !sameGap) {
      // What it would move into going that way: the strip under its feet
      // going down, over its head going up. Down in a row gap, a probe of
      // its whole standing height finds the row above first, and it would
      // slide down that only to land back in the same gap, forever.
      const reach = Math.max(6, RISE_SPEED * dt);
      edgeWall = dy > 0 ? blockAt(list, buddy.x, buddy.y + reach, reach)
                        : blockAt(list, buddy.x, buddy.y - H, reach);

      // Only worth going up or down its side if the pointer is past it. A
      // pointer level with some part of it (on the top of the card beside
      // it, say, in the row gap it opens onto) is reached going sideways,
      // and climbing to the far end would only overshoot it.
      if (edgeWall && (dy < 0 ? goal.y >= edgeWall.top : goal.y <= edgeWall.bottom)) {
        edgeWall = null;
      }
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
      // Too low to stand in: get down on all fours. Where the gap has a
      // floor — the top of the card below, between two rows — it gets down
      // onto that (the settle below), rather than hanging from the
      // underside of the row above. Failing that, flat where it is; and
      // failing that, duck so the body tucks just under whatever the head
      // is hitting.
      const floor = floorUnder(list, nextX, buddy.y);
      let crawlY = null;
      if ((floor !== null && !blockAt(list, buddy.x, floor, CRAWL_H)) ||
          !blockAt(list, nextX, buddy.y, CRAWL_H)) {
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
        if (grab(list, standBlocked, goUp, now)) return;
        buddy.mode = crawling ? "crawl" : "walk";
      }
    } else if (crawling && !blockAt(list, buddy.x, buddy.y, H)) {
      // Clear overhead again: stand back up.
      buddy.mode = "walk";
    }

    const bodyH = buddy.mode === "crawl" ? CRAWL_H : H;

    // On all fours, it keeps to the floor: it gets down onto the top of
    // whatever is underneath before going on, and follows it along. The
    // way ahead may only open up once it is down, so the step forward
    // below waits on this.
    let floorY = null;
    if (buddy.mode === "crawl") {
      floorY = floorUnder(list, nextX, buddy.y);
      if (floorY === null) floorY = floorUnder(list, buddy.x, buddy.y);
      if (floorY !== null) {
        const gap = floorY - buddy.y;
        const settle = Math.sign(gap) * Math.min(Math.abs(gap), SETTLE_SPEED * dt);
        if (!blockAt(list, buddy.x, buddy.y + settle, CRAWL_H)) buddy.y += settle;
      }
    }

    if (!blockAt(list, nextX, buddy.y, bodyH)) {
      buddy.x = nextX;
      if (Math.abs(stepX) > 0.4) buddy.facing = stepX > 0 ? 1 : -1;
      buddy.phase += Math.abs(stepX) / (buddy.mode === "crawl" ? 5 : 7);
    }

    // Arrived alongside the block that was overhead or underfoot.
    if (edgeWall && Math.abs(buddy.x - aimX) < 4 && grab(list, edgeWall, goUp, now)) return;

    // Open air: drift toward the pointer's height. Not while it is down on
    // a floor, which would only lift it back off it.
    if (!edgeWall && floorY === null && Math.abs(dy) > 1) {
      const stepY = Math.sign(dy) * Math.min(Math.abs(dy), RISE_SPEED * dt);
      if (!blockAt(list, buddy.x, buddy.y + stepY, bodyH)) buddy.y += stepY;
    }

    // If it ends up overlapping anything anyway (a resize, a late image),
    // push it out the short way rather than leaving it stuck inside —
    // unless there is room to crawl where it is (it has just got up off a
    // card's corner in a gap between rows, say), in which case it gets
    // down rather than jumping out of the gap.
    const stuck = blockAt(list, buddy.x, buddy.y, bodyH);
    if (stuck && bodyH === H && !blockAt(list, buddy.x, buddy.y, CRAWL_H)) {
      buddy.mode = "crawl";
    } else if (stuck) {
      const up = buddy.y - (stuck.top - 3);
      const down = (stuck.bottom + bodyH + 3) - buddy.y;
      buddy.y = up < down ? stuck.top - 3 : stuck.bottom + bodyH + 3;
    }

    buddy.x = Math.max(HALF_W + 4, Math.min(vw - HALF_W - 4, buddy.x));
    buddy.y = clampY(buddy.y, (buddy.mode === "crawl" ? CRAWL_H : H) + 4);
  }

  /* ----------------------------------------------------------- the signs */
  // Which sign is up `t` ms into the routine, and how far up (0 to 1).
  // Null between signs and once the routine is over.
  function signAt(t) {
    for (const sign of SIGNS) {
      const len = SIGN_UP_MS + sign.hold + SIGN_DOWN_MS;
      if (t < len) {
        const k = t < SIGN_UP_MS ? t / SIGN_UP_MS
                : t < SIGN_UP_MS + sign.hold ? 1
                : 1 - (t - SIGN_UP_MS - sign.hold) / SIGN_DOWN_MS;
        return { text: sign.text, up: k * k * (3 - 2 * k) };
      }
      t -= len + SIGN_GAP_MS;
      if (t < 0) return null;
    }
    return null;
  }

  const slotMs = (sign) => SIGN_UP_MS + sign.hold + SIGN_DOWN_MS + SIGN_GAP_MS;
  const SIGNS_MS = SIGNS.reduce((n, sign) => n + slotMs(sign), 0);
  const LAST_SIGN_AT = SIGNS_MS - slotMs(SIGNS[SIGNS.length - 1]);

  // A placard on a pole, from the hand the pose left in signHand. Drawn
  // unmirrored so it reads the right way round whichever way it faces,
  // and nudged sideways, pole and all, to stay on screen.
  function drawSign(sign) {
    if (!signHand) return;
    const hx = buddy.x + buddy.facing * signHand.x;
    const hy = buddy.y + signHand.y;

    ctx.save();
    ctx.font = "700 11px Switzer, 'Helvetica Neue', Helvetica, Arial, sans-serif";
    const w = Math.ceil(ctx.measureText(sign.text).width) + 14;
    const h = 19;
    const poleTop = hy - 12;
    const bx = Math.max(4, Math.min(vw - 4 - w, hx - w / 2));

    ctx.globalAlpha = Math.min(1, sign.up * 1.6);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    line(hx, hy + 5, hx, poleTop);

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, poleTop - h, w, h, 3);
    else ctx.rect(bx, poleTop - h, w, h);
    ctx.fill();

    ctx.fillStyle = "#050506";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(sign.text, bx + w / 2, poleTop - h / 2 + 0.5);
    ctx.restore();
  }

  /* ------------------------------------------------------------ the hint */
  // "Click me!" in a speech bubble over its head, popping in from the tail.
  // Drawn unmirrored, so the text reads the right way round either way it
  // faces, and to whichever side of the head has room.
  function drawHint(now) {
    hintBox = null;
    const seated = buddy.mode === "sit" || buddy.mode === "ledge";
    if (hintDone || !seated || !seatedAt) return;
    const age = now - seatedAt - HINT_DELAY;
    if (age < 0) return;

    const ledge = buddy.mode === "ledge";
    const headX = ledge ? buddy.x + buddy.facing * 4.7 : buddy.x;
    const headTop = ledge ? buddy.y - 21 : buddy.y - 32;

    const text = "Click me!";
    ctx.font = "600 13px Switzer, 'Helvetica Neue', Helvetica, Arial, sans-serif";
    const w = Math.ceil(ctx.measureText(text).width) + 20;
    const h = 26;

    const toRight = headX + 8 + w <= vw - 4;
    const x = toRight ? headX + 6 : headX - 6 - w;
    const y = Math.max(4, headTop - 10 - h + Math.sin(now / 480) * 1.5);
    const tipX = headX + (toRight ? 3 : -3);
    const tipY = headTop - 3;

    // Ease out with a little overshoot, and fade out at the end.
    const p = Math.min(1, age / 240) - 1;
    const k = 1 + 2.70158 * p * p * p + 1.70158 * p * p;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, (HINT_SHOW_MS - hintShown) / HINT_FADE_MS));
    ctx.translate(tipX, tipY);
    ctx.scale(k, k);
    ctx.translate(-tipX, -tipY);

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 8);
    else ctx.rect(x, y, w, h);
    ctx.fill();

    const baseX = toRight ? x + 12 : x + w - 12;
    ctx.beginPath();
    ctx.moveTo(baseX - 5, y + h - 1);
    ctx.lineTo(baseX + 5, y + h - 1);
    ctx.lineTo(tipX, tipY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#050506";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 10, y + h / 2 + 0.5);
    ctx.restore();

    hintBox = { x, y, w, h };
  }

  /* ------------------------------------------------------------ the render */
  function draw(now) {
    const sign = signStart ? signAt(now - signStart) : null;
    const up = sign ? sign.up : 0;

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
      case "sit":     poseSit(now, up); break;
      case "hop":     poseJump(Math.min(1, (now - buddy.t0) / buddy.hopMs)); break;
      case "ledge":   poseLedge(now, up); break;
      default:        poseWalk(buddy.phase);
    }

    ctx.restore();
    if (sign) drawSign(sign);
    drawHint(now);

    // Mirrored onto the element like the mode, below.
    const shown = sign ? sign.text : "";
    if (canvas.dataset.sign !== shown) canvas.dataset.sign = shown;
  }

  /* -------------------------------------------------------------- the loop */
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);   // cap after a tab switch
    last = now;

    // The page's smooth wheel scroll (main.js) takes its step first, so the
    // scroll read here is the one this frame is drawn at. Otherwise a figure
    // riding a card would trail it by a frame the whole way.
    if (window.smoothWheel) window.smoothWheel.tick(now);

    const sy = window.scrollY;
    scrollStep = sy - scrollY;
    scrollY = sy;

    step(dt, now);

    // The hint's clock: how long this sit has lasted, and how long the
    // bubble has been up during it. A full showing retires it.
    const seated = buddy.mode === "sit" || buddy.mode === "ledge";
    if (seated) {
      if (!seatedAt) seatedAt = now;
      if (!hintDone && now - seatedAt > HINT_DELAY) {
        hintShown += dt * 1000;
        if (hintShown >= HINT_SHOW_MS) hintDone = true;
      }
    } else if (seatedAt) {
      seatedAt = 0;
      hintShown = 0;
      sitCounted = false;
    }

    // Each sit that lasts SIGN_AFTER_MS counts once. The one that makes a
    // run due starts it, as does any long sit while one is still owed.
    if (seated && !sitCounted && now - seatedAt >= SIGN_AFTER_MS) {
      sitCounted = true;
      if (clickedOnce && !signOwed && ++longSits >= SIGN_EVERY) signOwed = true;
      if (signOwed) signStart = now;
    }

    // A run is over once the signs have all been up, or once it gets up
    // with the last one already shown, and the count starts again. Getting
    // up any earlier calls it off, still owed.
    if (signStart) {
      const t = now - signStart;
      if (t >= SIGNS_MS || (!seated && t >= LAST_SIGN_AT)) {
        signOwed = false;
        longSits = 0;
        signStart = 0;
      } else if (!seated) {
        signStart = 0;
      }
    }

    draw(now);

    // Mirrored onto the element so the current state is inspectable from
    // outside; written only on a change, not every frame.
    if (canvas.dataset.mode !== buddy.mode) canvas.dataset.mode = buddy.mode;

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
