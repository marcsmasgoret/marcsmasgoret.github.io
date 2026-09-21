# marcsmasgoret.github.io

Personal portfolio site — plain HTML/CSS/JS, no build tools, hosted on GitHub Pages.

## Structure

```
index.html                 home page (name, one-line intro, 3-across project grid)
projects/index.html        all projects, one page, full write-up per project stacked top to bottom,
                           ending with the Other Projects strip
about/index.html           about page (bio with round portrait, scrolling photo column)
assets/css/style.css       shared styles
assets/js/main.js          card outlines, gallery ticker, cursor caption, anchor pinning, project sidebar
assets/js/buddy.js         home page only: the stick figure that chases the pointer
assets/img/projects/       project images
assets/img/about/          about-page photos
assets/img/other/          Other Projects strip images (placeholder SVGs for now)
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

  It walks; drops to all fours where a gap is too short to stand in,
  crawling along the top of the card underneath (the gaps between card
  rows are only a few pixels taller than the crawl);
  grabs a block's near edge and climbs or slides it when one is in the way;
  climbs with its back to us when it is going straight up or down in the
  open; and jetpacks when a scroll or a losing chase leaves it behind.

  It sits on arrival, but never part way up a block's side. When the
  pointer rests on a project card, it hops onto that card's top-left
  corner and sits with its legs over the edge, riding along as the page
  scrolls. On the hero text it aims for the nearest corner instead. The first time it sits, a
  "Click me!" bubble pops up for 5 s, then fades out for good (sooner if
  it is clicked; if it gets up first, the bubble shows again next sit). Clicking it (or the bubble) while it sits startles it, and that
  click is swallowed so it does not also follow whatever link it is
  sitting on. Once it has been clicked, the first time it then stays sat
  for five seconds it holds up three signs in turn ("YOU SHOULD",
  "PROBABLY", "HIRE ME ;)"), once per page load. The wording and timings
  are the `SIGNS` list near the top of `buddy.js`.

  The current state is mirrored onto the canvas as `data-mode`. It does not
  run under `prefers-reduced-motion`, or without a fine pointer to chase.
- **Galleries.** The About photo column and the Other Projects strip at the
  end of the Projects page (`data-gallery="x"`, sideways) are each their own
  scroll container.
  `main.js` clones the list once and wraps the scroll position by one copy's
  length, so a slow idle "ticker" scroll loops seamlessly. Any scroll input
  pauses the ticker for 1.4 s. Hovering an image hides the pointer and shows
  the image's `data-caption` in a box that follows it.

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

## Swapping the Other Projects images

Each project is a `<figure class="other-shot">` at the end of `projects/index.html`. Put a photo in
`assets/img/other/`, point the `img` `src` at it, fix the `alt`, and edit
`data-caption`. Any shape works: the strip crops every image to 4:3. Keep at
least four shots, or the strip can end up narrower than its column and the
loop stops.

## Swapping the portrait

The round photo beside the About heading is `assets/img/about/portrait.jpg`, a
500px square cut from the original in `Files/About me/`. To replace it, crop a
new square with the face centred and the head, shoulders and chest inside the
circle that fits the square (the corners are cut off), and save it over
`portrait.jpg`.

## Cache busting

`style.css` and `main.js` are linked with a `?v=` query in all three pages. Bump it
in every page whenever you change either file, or GitHub Pages will serve the old one.
