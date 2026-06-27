# Vybridge Draft Site

This project is a static draft website built with plain HTML, CSS, and JavaScript.

## Language Rule

- Keep all public-facing content in **English** by default.

## Pages

- `index.html` — main landing page (English)
- `how-it-works.html` — How It Works page (English)
- `uk/index.html` — Ukrainian landing page
- `uk/how-it-works.html` — Ukrainian How It Works page

**Note:** Pages in `uk/` use `../` paths for shared CSS, JS, and assets.

## Language Switcher

Use the EN / UA toggle in the header to switch between English and Ukrainian versions.

You can open files directly in a browser, or run a local static server:

```bash
python -m http.server 8080
```

Then open:

- `http://localhost:8080/index.html`
- `http://localhost:8080/how-it-works.html`

## Domain Deployment (when ready)

Because all links use relative paths, you can deploy this draft to most static hosts without code changes:

- Vercel
- Netlify
- Cloudflare Pages
- GitHub Pages

### Minimal deployment checklist

1. Upload project files to a Git repository.
2. Connect repository to your hosting provider.
3. Set `index.html` as the entry page (default on static hosts).
4. Point your domain DNS to the hosting provider.
5. Enable HTTPS in hosting settings.

## Notes

- This is currently a draft. Replace placeholder `#` links with real URLs before production launch.
- Add analytics, legal pages, and form backend integrations before going live.
