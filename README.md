# marcsmasgoret.github.io

Personal portfolio site — plain HTML/CSS/JS, no build tools, hosted on GitHub Pages.

## Structure

```
index.html                 home page (hero, stacked project list, about, contact)
projects/index.html        all projects, one page, full write-up per project stacked top to bottom
assets/css/style.css       shared styles
assets/js/main.js          mobile nav toggle, active link highlighting, hover interactions
assets/img/projects/       project images
```

Only two HTML pages. The project list on the home page links to the matching
section on `projects/index.html` via an anchor (e.g. `projects/index.html#baja-split-drive-shaft`),
and the "Projects" dropdown in the nav does the same. Clicking the "Projects"
label itself (not a dropdown item) goes to the top of that page.

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
   through the following `<nav class="project-nav">`) and update the id, eyebrow, title, meta row,
   body content, and gallery.
2. Add a matching `<a class="project-row">` block to the list on `index.html`.
3. Add a matching entry to the nav dropdown in **both** `index.html` and `projects/index.html`.
4. Drop images in `assets/img/projects/`.
