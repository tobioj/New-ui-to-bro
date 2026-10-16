# Workspace Controller — UI

A desktop application for running scripted browser sessions through isolated, persistent
profiles. Each profile keeps its own browsing state on disk, so a session behaves like a
returning visitor rather than a clean-room request. Built for QA of browser-facing features,
and usable as a tagged-traffic generator for sites you own.

Local HTML/CSS/JS, served from disk.

---

## What's here

```
index.html            Application shell and all views
css/                  Stylesheets and the design-system tokens
js/                   Application modules
  brand.js            Product name, storage keys, event names (single source)
  bridge-mock.js      
  app.js              Main application module
  ...                
README.md
```

---

## Running it

The app expects a desktop host that injects a `window.desktopBridge.api` object over the local
page. With no host present, it falls back to the mock automatically.

**Browser preview :**

```
python -m http.server 8000
# open http://localhost:8000/
```


