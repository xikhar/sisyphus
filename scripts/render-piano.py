"""Render the original Sisyphus piano loop. Requires Python, NumPy, and FFmpeg.

Only this authoring script downloads samples; the game uses the bundled MP3.
Sample credits and the pinned source are in art/music/README.md.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import urllib.request
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.local-archive/piano-samples'
OUTPUT = ROOT / 'public/assets/audio'
SOURCE = 'https://raw.githubusercontent.com/Tonejs/audio/efd8296360f9526e379bfbe5c1698ff54d6a1d34/salamander'
RATE, BPM = 44100, 56
BEAT = 60 / BPM
FRAMES = round(16 * 4 * BEAT * RATE)
RNG = np.random.default_rng(131)

# D minor, with open ninths and suspended endings. Each entry contains a bass,
# three inner voices, and a small melody (beat, MIDI pitch, held beats).
BARS = [
    (38, [57, 62, 65], [(0.2, 69, 1.5), (2, 67, .7), (3, 65, .9)]),
    (34, [53, 57, 62], [(0.3, 65, 1.4), (2.2, 64, .6), (3, 62, .9)]),
    (41, [57, 60, 64], [(0.2, 69, 1.6), (2.4, 72, .8)]),
    (36, [55, 60, 62], [(0.2, 67, 1.7), (2.7, 64, 1)]),
    (43, [58, 62, 65], [(0.3, 69, 1.2), (1.9, 67, 1.2)]),
    (41, [57, 62, 65], [(0.2, 65, 1.3), (2, 64, .7), (3, 62, .8)]),
    (34, [53, 57, 62], [(0.3, 65, 1.6), (2.6, 64, 1)]),
    (33, [52, 55, 61], [(0.2, 62, 1.2), (2, 61, 1.5)]),
    (38, [57, 62, 65], [(0.2, 69, 1.1), (1.7, 72, .7), (2.8, 74, 1)]),
    (34, [53, 57, 62], [(0.2, 72, 1.5), (2.2, 69, 1.3)]),
    (41, [57, 60, 64], [(0.3, 67, 1.5), (2.5, 69, 1)]),
    (36, [55, 60, 62], [(0.2, 67, 1.3), (2, 64, .7), (3, 62, .8)]),
    (43, [58, 62, 65], [(0.3, 65, 1.5), (2.6, 69, 1)]),
    (41, [57, 62, 65], [(0.2, 67, 1.1), (1.8, 65, .8), (3, 64, .8)]),
    (34, [53, 57, 62], [(0.3, 62, 2.2)]),
    (33, [52, 55, 61], [(0.2, 64, 1), (1.8, 61, 1.1)]),
]
SAMPLES = {33: 'A1', 36: 'C2', 39: 'Ds2', 42: 'Fs2', 45: 'A2',
           48: 'C3', 51: 'Ds3', 54: 'Fs3', 57: 'A3', 60: 'C4',
           63: 'Ds4', 66: 'Fs4', 69: 'A4', 72: 'C5', 75: 'Ds5'}


def sample(key):
    path = CACHE / f'{SAMPLES[key]}.mp3'
    if not path.exists():
        for attempt in range(3):
            try:
                with urllib.request.urlopen(f'{SOURCE}/{path.name}', timeout=20) as response:
                    data = response.read()
                path.write_bytes(data)
                break
            except (OSError, TimeoutError):
                if attempt == 2:
                    raise
    pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path),
                                  '-f', 'f32le', '-ac', '2', '-ar', str(RATE), '-'])
    return key, np.frombuffer(pcm, dtype='<f4').reshape(-1, 2)


def wrap_add(destination, source, offset):
    offset %= len(destination)
    count = min(len(source), len(destination) - offset)
    destination[offset:offset + count] += source[:count]
    if count < len(source):
        destination[:len(source) - count] += source[count:]


def render():
    CACHE.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    pitches = {note for bass, chord, melody in BARS for note in [bass, *chord, *(n for _, n, _ in melody)]}
    nearest = {pitch: min(SAMPLES, key=lambda key: abs(key - pitch)) for pitch in pitches}
    with ThreadPoolExecutor(max_workers=4) as pool:
        samples = dict(pool.map(sample, sorted(set(nearest.values()))))
    dry = np.zeros((FRAMES, 2), dtype=np.float32)

    def note(beat, pitch, held, velocity):
        key = nearest[pitch]
        source = samples[key]
        speed = 2 ** ((pitch - key) / 12)
        release = 1.7
        length = min(round((held * BEAT + release) * RATE), int((len(source) - 1) / speed))
        positions = np.arange(length) * speed
        voice = np.stack([np.interp(positions, np.arange(len(source)), source[:, channel])
                          for channel in range(2)], axis=1)
        t = np.arange(length) / RATE
        envelope = np.minimum(t / .008, 1) * np.exp(-np.maximum(t - held * BEAT, 0) * 4 / release)
        envelope[-min(length, 1200):] *= np.linspace(1, 0, min(length, 1200))
        voice *= envelope[:, None] * velocity * RNG.uniform(.9, 1.04)
        wrap_add(dry, voice, round((beat * BEAT + .12 + RNG.uniform(-.018, .018)) * RATE))

    for bar, (bass, chord, melody) in enumerate(BARS):
        start = bar * 4
        note(start, bass, 3.7, .53)
        for offset, pitch in zip([.65, 1.35, 2.25], chord):
            note(start + offset, pitch, 3.65 - offset, .29)
        for offset, pitch, held in melody:
            note(start + offset, pitch, held, .7)

    # Circular convolution carries the pedal/room decay over the loop boundary.
    # A gentle low-pass rounds the hammer attack without turning it into a pad.
    frequencies = np.fft.rfftfreq(FRAMES, 1 / RATE)
    warmth = 1 / np.sqrt(1 + (frequencies / 3100) ** 6)
    warmth *= frequencies / np.sqrt(frequencies ** 2 + 45 ** 2)
    room_length = round(3.5 * RATE)
    t = np.arange(room_length) / RATE
    for channel in range(2):
        impulse = RNG.normal(0, 1, room_length) * np.exp(-t * 2.7)
        impulse[:round(.028 * RATE)] = 0
        impulse /= np.sqrt(np.sum(impulse ** 2))
        impulse *= .2
        impulse[0] = 1
        dry[:, channel] = np.fft.irfft(np.fft.rfft(dry[:, channel]) * warmth
                                     * np.fft.rfft(impulse, n=FRAMES), n=FRAMES)
    # Quiet master, with ample headroom for wind and stone sounds in the game.
    dry *= min(.63 / np.max(np.abs(dry)), .075 / np.sqrt(np.mean(dry ** 2)))
    wav = CACHE / 'sisyphus-piano.wav'
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'f32le', '-ar', str(RATE),
                    '-ac', '2', '-i', '-', '-c:a', 'pcm_s24le', str(wav)],
                   input=dry.astype('<f4').tobytes(), check=True)
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(wav), '-c:a', 'libmp3lame',
                    '-b:a', '160k', '-metadata', 'title=Again — Sisyphus',
                    '-metadata', 'comment=Original composition; Salamander piano by Alexander Holm (CC BY 3.0)',
                    str(OUTPUT / 'sisyphus-piano.mp3')], check=True)
    print(f'Rendered {FRAMES / RATE:.3f}s, 16 bars at {BPM} BPM; peak {np.max(np.abs(dry)):.3f}.')


if __name__ == '__main__':
    render()
