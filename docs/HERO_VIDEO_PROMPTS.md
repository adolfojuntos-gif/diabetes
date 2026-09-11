# Steady — hero video prompt pack (Higgsfield, 5 seconds each)

Four plates, one per main section. Files go in `public/hero/` as `<name>.mp4` and `<name>.jpg`.

| Plate | Screen | Treatment |
|---|---|---|
| `morning` | `/welcome` and `/` (Today) | Full hero, carries the greeting. **Installed** |
| `hands` | `/log` | Cover band, footage only. **Still to render** |
| `plate` | `/plan` | Cover band, centre crop. **Installed** |
| `walk` | `/move` | Cover band, bottom crop. **Installed** |

Wired via `src/app/<section>/layout.tsx` → `SectionHero`, which matches the hub path exactly, so
`/log` gets the band and `/log/glucose` does not. Nobody typing a glucose number does it over video.

## How these are built to work as backgrounds

A background loop is a different object from a shot in a film. Three constraints drive every prompt:

1. **The loop seam has to be invisible.** The move is slow and single-axis, so the last frame is
   close enough to the first that the browser's loop reads as continuous.
2. **Nothing is legible.** No meter readouts, no labels, no brand marks. Anything legible in a
   health app's background reads as a claim, and a wrong number behind a glucose app is worse than
   no footage at all.
3. **The top two thirds carry no detail.** Type sits there under a scrim, so subjects sit low in
   frame and the upper frame stays soft.

Every prompt names the camera's job, because a move without a job flattens the frame.

Render 1920x1080. Export H.264 MP4, CRF 26, no audio track, 5 s, plus a JPEG of frame 1 at the
same aspect. A 1080x1920 pass is worth it if you want the phone crop to hold, since `object-cover`
on a tall phone loses roughly 40% of the width.

---

## 1. `morning` — the entry screen

> Slow lateral drift left to right across a sunlit kitchen counter at 7am, camera at counter
> height, moving 20cm total so the loop closes. Foreground low-right: a glass of water, a small
> white ceramic bowl of blueberries, a folded linen cloth. Warm low-angle morning sun through a
> window off frame left throws long soft shadows across pale oak. Upper two thirds is out-of-focus
> warm wall and window bloom, no detail. Shallow depth of field, 50mm, natural light only, no
> practical lamps. Calm, domestic, unstyled. No people, no text, no labels, no logos, no screens,
> no medical devices. Cinematic, fine grain, no camera shake.

The camera's job: reveal that this is a real morning in a real kitchen, not a stock still.

## 2. `hands` — the Log section

> Static camera, extremely slow push in of 10cm, on a pair of adult hands resting on a wooden
> table, low-left of frame, fingers relaxed and open, palms up. Soft north-facing window light
> from frame left, one clear soft shadow. Skin texture visible, no jewellery, no watch, no
> devices, no objects in the hands. Upper two thirds is empty soft-focus table and warm shadow.
> 85mm, shallow depth of field, muted warm neutral grade, fine grain. No text, no labels, no
> logos. Stillness, quiet, no movement other than the push.

The camera's job: close the distance, because logging is an intimate act.

## 3. `plate` — the Plan section

> Slow overhead orbit of 15 degrees around a plated meal on a pale linen cloth, centred low in
> frame, camera directly above, rotating just enough that the loop closes. Grilled salmon,
> roasted broccoli, a small portion of brown rice, half a lemon. Natural daylight from frame
> right, soft shadows. Upper frame is empty warm linen with no detail. 50mm, shallow depth of
> field, food-natural grade with no saturation push. No hands, no cutlery in motion, no text, no
> packaging, no labels, no logos.

The camera's job: show the plate whole, since the point is proportion, not the hero food.

## 4. `walk` — the Move section

> Slow tracking shot following a person's legs and feet from behind at knee height as they walk a
> tree-lined suburban path in late afternoon, camera matching their pace so the subject stays in
> the same part of frame and the loop closes. Trainers, dark trousers, dappled golden sunlight
> moving across the ground. Upper frame is soft out-of-focus foliage and warm haze. No face, no
> upper body, no text on the shoes, no logos, no brand marks. 35mm, handheld-smooth stabilised,
> natural light, warm grade. No other people.

The camera's job: keep pace, so the movement feels like the viewer's own.

---

## Things deliberately not in this pack

- **No needles, no injection, no finger prick, no blood.** A person opening this app has done
  those things thousands of times and does not need to watch one.
- **No meters, pumps, sensors or pens.** They date instantly, they read as a brand endorsement,
  and a legible number on a screen behind a glucose app is a claim the app cannot stand behind.
- **No faces.** Partly so no generated person becomes the app's implied patient, partly because a
  face pulls the eye straight off the type.
- **No before-and-after bodies, no scales, no measuring tapes, no gym.** The app never frames
  diabetes as a weight-loss project.
- **No white coats, no stethoscopes, no clinicians.** The app states plainly that no clinician has
  reviewed anything in it. Footage implying otherwise would contradict that on the same screen.

## Behaviour before the files exist

Each screen shows its poster JPEG; with no JPEG it shows the app's own sunk background. Nothing
404s and nothing shifts layout. The player is muted, inline, looping, `preload="none"`, pauses
when scrolled off screen, and is replaced by the poster still under
`prefers-reduced-motion: reduce`.

## Installed, and what the first three taught us

`morning`, `plate` and `walk` are in `public/hero/` and running. `hands` is the only one still to
render.

Two things the first batch changed in the code:

1. **The crop is anchored, not centred.** The prompts put the subject low in frame on purpose, so a
   centre crop threw the subject away and left an empty wall. `HeroVideo` now takes
   `focus="bottom"` by default, and `plate` overrides it to `"center"` because the plate sits in the
   middle of its frame.
2. **There are two scrim strengths.** A hero that carries type needs a heavy scrim; a band with no
   type on it only needs its bottom edge feathered into the page, or the scrim buries the subject.
   `scrim="full"` and `scrim="edge"`.

## File weight

The three installed clips are 2.3 MB, 3.1 MB and 4.2 MB, which is heavy for a background loop. They
came out of Higgsfield at 854x480 and still weigh that much, so it is bitrate rather than
resolution. If you can re-export at a lower bitrate, aim for under 1.5 MB each. Not blocking:
`preload="none"` means nothing downloads until the band scrolls into view, and the flat poster
covers the gap.
