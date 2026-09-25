# Again — Sisyphus piano

An original, quiet 16-bar piano composition in D minor, at 56 BPM (68.571 seconds).
Open voicings, a sparse descending melody, small timing/dynamic variations, and
soft room reverb accompany the repeated ascent. The final suspended harmony
returns to the opening; piano and room tails wrap across the loop boundary.

Render with `python scripts/render-piano.py` (Python 3, NumPy, and FFmpeg).
The script downloads the required source notes into ignored `.local-archive/`,
then produces `public/assets/audio/sisyphus-piano.mp3`. The game loads that local
file only, with no music service, runtime dependency, or external request.

Piano recordings: **Salamander Grand Piano**, by **Alexander Holm**, licensed
under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/).
The original instrument is a sampled Yamaha C5.

Sample source: [Tone.js audio / Salamander](https://github.com/Tonejs/audio/tree/efd8296360f9526e379bfbe5c1698ff54d6a1d34/salamander),
pinned at `efd8296360f9526e379bfbe5c1698ff54d6a1d34`.
The upstream README is preserved in `Salamander-README.txt`.
Modifications: selected notes are pitch-shifted, arranged into a new composition,
softened with EQ and envelopes, mixed with reverb, and encoded as a stereo MP3.
This use does not imply endorsement by the sample author.
