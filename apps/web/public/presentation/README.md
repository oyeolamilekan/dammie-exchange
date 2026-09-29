# Dammie AI architecture presentation

This is a dependency-free HTML, CSS, and JavaScript slide deck.

From the repository root, run the web app:

```bash
bun run --filter @dammie/web dev
```

Then open <http://localhost:3000/presentation>.

The standalone deck is served from `apps/web/public/presentation/index.html` and
is embedded by the website route at `apps/web/app/presentation/page.tsx`.

Use the arrow keys, Page Up/Page Down, or the on-screen controls to navigate.
Press `F` to enter or exit fullscreen. When the standalone deck is open directly,
each slide also has a stable URL hash, such as `#4` for the approval flow.
