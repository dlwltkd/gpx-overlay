# Ribbon

Turn a GPX file into a clean speedometer overlay for video edits.

Load a ride, tune the gauge, and export transparent frames you can drop
into DaVinci Resolve or any other editor.

## Features

- GPX parsing with speed taken from embedded extensions when present,
  otherwise derived from coordinates and timestamps (with GPS spike filtering)
- Two gauge styles: horizontal bar and circular dial
- Editable: units (km/h or mph), label, accent color, segment count,
  auto or manual full scale, peak marker, glow, smoothing window, size
- Speed boost: scale readings by -50% to +50% for display
- Playback preview with a speed-profile scrubber
- Export:
  - PNG sequence (zip) with alpha, the reliable route for editors
  - WebM recorded on black, for Screen or Add blend modes
  - Single-frame PNG snapshot

## Run

```
npm install
npm run dev
```

## Using the export in DaVinci Resolve

1. Export a PNG sequence and unzip it.
2. In the media pool, enable "Frame display mode" > sequence import,
   or simply drag the folder in; Resolve picks it up as a clip.
3. Place it above your footage. Alpha is preserved.

The WebM export has no alpha channel (browsers do not record it), so
composite it with a Screen or Add blend instead.

## Notes

- Long rides at high frame rates produce large zips; the whole sequence
  is assembled in memory. Trim your ride first if the export is very long.
- The speed boost only changes what the overlay displays. The GPX data
  is never modified.
