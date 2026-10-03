# Postcard Worlds

Type a scene and you get one postcard. Click a door, a path or a window and you
step into the next one, then the next, as far as you like. Every picture is
generated on the spot by [Pollinations](https://pollinations.ai), one view at a
time.

Submission for quest [#15728 — Explorable postcard worlds](https://github.com/pollinations/pollinations/issues/15728).

Live: https://xiaotian1171.github.io/postcard-worlds/

## Two ways to run

| | free preview | signed in (bring your own Pollen) |
|---|---|---|
| sign-in | none | Pollinations OAuth, or paste an `sk_` key |
| how far you get | three views, then it asks you to sign in | as far as you like |
| pictures | shared legacy image endpoint | `gen.pollinations.ai`, the picture model you pick |
| ways onwards | an anonymous text model suggests three exits | a vision model **reads the picture** and picks three spots that are really in it |
| billing | shared | your own Pollen, balance on screen |

The preview exists so a visitor can see the loop before connecting a wallet, and
it is capped at three views so it does not lean on shared capacity. The
signed-in path is the real one, and the app says which mode it is in, in the top
bar and above the fold.

## How a walk works

1. You describe a scene and pick a look (vintage postcard, watercolour, riso,
   35mm film, claymation, ink and wash). The look is a style phrase pinned to
   every prompt in that world, so the pictures stay related.
2. The picture is painted, then the spotter is asked for exactly three exits as
   JSON: a label to click, the next scene description, and a cell on a 3x3 grid
   over the picture.
3. **Cells, not pixels.** Asking a vision model for bounding boxes gives
   coordinates that land next to the door. Asking it which ninth of the picture
   the door is in is something it gets right, and the button lands in that ninth.
   Spot labels are clamped, duplicates are dropped, and fewer than two exits
   falls back to three generic ones so a walk can never dead-end.
4. Clicking an exit paints the next view from the previous one as a reference
   image, so the world keeps its look.
5. The filmstrip above the picture is the map of the walk. Clicking an earlier
   view returns to it; walking on from there starts a new branch.
6. **Copy walk link** packs the prompts, seeds, labels and cells into the URL
   fragment. Opening it replays the recorded walk — each picture is repainted
   from the recorded prompt and seed, and the only spot offered is the one the
   original walker clicked, until the recording runs out and live exits resume.

## Run it

Static files, no build step:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

Deployed with GitHub Pages from the repository root.

## Sign-in details

- PKCE authorization-code flow against `enter.pollinations.ai`, `redirect_uri`
  is the page's own URL, scope `profile usage`, `expiry=30`, `budget=25`. The
  budget field is prefilled on the consent screen and the visitor can clear it.
- The token is kept in `sessionStorage` for that tab only, never in
  `localStorage`, a URL, analytics or a log.
- An App Key (`pk_`) is optional. Without one the consent screen falls back to
  the redirect hostname, which is also what is sent as `client_id` — the token
  endpoint requires a `client_id` (checked: omitting it answers
  `invalid_request`). Paste a `pk_` in the sign-in box to attribute the traffic
  and to have the app named properly on the consent screen.
- "Create a key instead" takes a pasted `sk_` for anyone who would rather not
  run the redirect.
- The wallet chip reads `GET gen.pollinations.ai/account/balance`, which needs
  the `usage` scope. If the visitor unticked it, the chip simply stays hidden.

## Models

Both lists are read live, so nothing here goes stale:

- pictures: `GET gen.pollinations.ai/image/models` (server default unless you
  pick one)
- spotter: `GET gen.pollinations.ai/text/models`, filtered to models whose
  `input_modalities` include `image` and that are not community models

## Known limits

- Signing in needs a `client_id` at the token exchange, and a static page with
  no registered App Key can only offer the redirect hostname. If the server
  refuses that, the app says so and the pasted `sk_` key path still works — the
  free preview is unaffected.
- The reference image is passed as a URL, so it only works when the previous
  picture has a public one. In the free preview it always does (the legacy
  endpoint is a plain GET URL). Signed in, the previous picture is a blob, so
  the app first tries `POST /v1/images/generations` with it as a data URL and
  falls back to a plain generation; the style phrase and the seed still hold the
  look together.
- Pictures are not stored anywhere. Reloading the tab starts a new world; a walk
  link is the only way to keep one.
- Replay is faithful but not bit-identical across model versions: the same
  prompt and seed on a different model release can come back slightly different.
- Each click is two or three billable calls (picture, spotter, sometimes the
  reference image attempt), all on the visitor's own Pollen.

## Verified

- `image.pollinations.ai` free path, `gen.pollinations.ai` image/models/text
  endpoints, the chat endpoint and the OAuth token endpoint all send
  `access-control-allow-origin: *`, so a static page can call them from the
  browser (checked 2026-10-03).
- The free preview was walked end to end in a real browser: two views, spots
  found, filmstrip and walk link working.
- `GET /text/models` entries carry `input_modalities`, which is what the spotter
  list is filtered on; `GET /image/models` entries do not carry
  `max_reference_images`, which is why reference images are passed by URL rather
  than by capability check.
