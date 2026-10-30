# Common Free Time

A small static page that overlays friends' timetables and highlights the time slots where everyone is free, to help organize meetups.

- Week view with one color per person; classes of different people sit side by side.
- A list under the grid shows the common free slots (gaps under 30 min between 08:00 and 21:00 are ignored).
- Plain HTML/CSS/JS, no build step.

## Run locally

ES modules and `fetch` need HTTP, so don't open `index.html` by double-click:

```
python -m http.server 8000
```

Then open <http://localhost:8000>. Unit tests for the free-slot logic: <http://localhost:8000/tests/freetime.test.html>.

## Deploy on GitHub Pages

Push this folder to a GitHub repository, then Settings → Pages → Deploy from branch → `main` / root. All paths are relative, so it works under `https://<user>.github.io/<repo>/`.

## Layout

| Path | Purpose |
|---|---|
| `index.html`, `css/`, `js/` | the page (`js/freetime.js` holds the free-slot logic) |
| `data/people.json` | list of people (name, color, data file) |
| `data/people/<id>.json` | one timetable per person |
| `sources/<id>/` | original screenshots the data was extracted from |
| `docs/ADDING_A_PERSON.md` | how to add a friend |
| `tests/` | browser-run tests |
