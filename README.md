# marcsmasgoret.github.io

Personal portfolio site — plain HTML/CSS/JS, no build tools, hosted on GitHub Pages.

## Structure

```
index.html                 home page (hero, project grid, about, contact)
projects/                  one HTML page per project
assets/css/style.css       shared styles
assets/js/main.js          mobile nav toggle + active link highlighting
assets/img/projects/       project images
```

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

1. Copy `projects/baja-split-drive-shaft.html` as a starting point.
2. Update the title, meta, eyebrow, meta row, body sections, and gallery.
3. Add a card for it in `index.html` under `#projects`.
4. Drop images in `assets/img/projects/`.
