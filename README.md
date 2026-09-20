# marcsmasgoret.github.io

Personal portfolio site — plain HTML/CSS/JS, no build tools, hosted on GitHub Pages.

## Structure

```
index.html                 home page (name, one-line intro, 3-across project grid)
projects/index.html        all projects, one page, full write-up per project stacked top to bottom
about/index.html           about page (sticky bio column, scrolling photo column)
assets/css/style.css       shared styles
assets/js/main.js          card outlines, gallery ticker, cursor caption, anchor pinning, project sidebar
assets/js/buddy.js         home page only: the stick figure that chases the pointer
assets/img/projects/       project images
assets/img/about/          about-page photos (placeholders for now)
```

Three HTML pages, each with the same header and footer. The project cards on the
home page link to the matching section on `projects/index.html` via an anchor
(e.g. `projects/index.html#baja-split-drive-shaft`).

## Design

Black background, white text, one typeface throughout (Switzer, loaded from
Fontshare — a freely licensed stand-in for PP Neue Montreal). Colours, spacing,
and the header height all come from the custom properties in the `:root` block
at the top of `style.css`; change them there rather than in individual rules.

Two interactions are worth knowing about before editing:

- **Project card hover outline.** Each card carries an empty
  `<svg class="work-card-outline"><path></svg>`. `main.js` measures the card,
  writes a rounded-rect path, and sets `--outline-len` to the path's true
  length. CSS animates `stroke-dashoffset` from that length to zero, so the
  border draws as one continuous clockwise stroke from the top-left corner,
  eased in and out by `--ease-draw`. A `ResizeObserver` re-measures on layout
  change.
- **Cursor buddy** (`buddy.js`, home page only). A stick figure on a fixed
  canvas that chases the pointer, starting perched on the monogram's top
  corner. Obstacles are each project card plus the hero heading and
  sentence — but the text is measured with a `Range`, one box per rendered
  line, not by its element box: a heading's box runs the full content width
  while its glyphs stop hundreds of pixels short, which would leave an
  invisible wall out to the right of the hero copy.

  It walks; drops to a crawl where a gap is too short to stand in, ducking
  so its body tucks under the ceiling (the gaps between card rows are only
  a few pixels taller than the crawl, so it would otherwise never fit);
  grabs a block's near edge and climbs or slides it when one is in the way;
  climbs with its back to us when it is going straight up or down in the
  open; and jetpacks when a scroll or a losing chase leaves it behind.

  It sits on arrival, but never part way up a block's side. When the
  pointer rests inside a block it aims for that block's nearest corner,
  skipping corners that are themselves inside something else. Clicking it
  while it sits startles it, and that click is swallowed so it does not
  also follow whatever link it is sitting on.

  The current state is mirrored onto the canvas as `data-mode`. It does not
  run under `prefers-reduced-motion`, or without a fine pointer to chase.
- **About gallery.** The photo column is its own scroll container. `main.js`
  clones the list once and wraps the scroll position at the halfway mark, so a
  slow idle "ticker" scroll loops seamlessly. Any scroll input pauses the
  ticker for 1.4 s. Hovering a photo shows its `data-caption` in a box that
  follows the pointer.

## Local preview

No build step — just open `index.html` in a browser, or serve the folder locally:

```
python -m http.server 8000
```

then visit `http://localhost:8000`.

## Deploying

Push to a GitHub repo named `marcsmasgoret.github.io`, then in
**Settings → Pages** set the source to the `main` branch, root folder.
The site will be live at `https://marcsmasgoret.github.io`.

## Adding a project

1. In `projects/index.html`, copy one existing project block (the `<section class="project-hero" id="...">`
   through the following `<nav class="project-nav">`) and update the id, title, meta row,
   body content, and gallery.
2. Add a matching `<a class="work-card">` block to the grid on `index.html`, keeping the
   empty outline `<svg>` — `main.js` fills it in.
3. Drop images in `assets/img/projects/`.

## Swapping the about-page photos

Originals live in `Files/About me/`, which is gitignored — only the web-sized copies in
`assets/img/about/` are published. To add or replace one: scale the long edge to 1400px,
apply the EXIF rotation (phone photos carry it as metadata, and browsers that ignore it
will show the picture on its side), and save as JPEG around quality 80.

Then update its `<figure class="about-shot">` in `about/index.html`: point `src` at the
new file, set `width`/`height` to the real pixel size (this keeps the scroll from jumping
as photos load), write the `alt`, and put the hover text in `data-caption`.

## Cache busting

`style.css` and `main.js` are linked with a `?v=` query in all three pages. Bump it
in every page whenever you change either file, or GitHub Pages will serve the old one.
