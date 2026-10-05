"""Makes web-sized copies of the studio photos.

Drop full-size photos into assets/slideshow/ as 1.webp, 2.webp, ... and run:

    python scripts/optimize-images.py

It writes, for each photo:
    assets/slideshow/web/N.webp    1600px wide, for the hero and the lightbox
    assets/slideshow/thumb/N.webp  720px wide, for the gallery grid
and assets/slideshow/manifest.json, which the home page reads so it never
has to probe for files or download the originals. Needs Pillow.
"""
import json
import pathlib

from PIL import Image, ImageOps

ROOT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "slideshow"
SIZES = {"web": (1600, 72), "thumb": (720, 70)}


def numbered():
    files = []
    for f in ROOT.glob("*.webp"):
        if f.stem.isdigit():
            files.append((int(f.stem), f))
    return [f for _, f in sorted(files)]


def main():
    for folder in SIZES:
        (ROOT / folder).mkdir(exist_ok=True)
    out = []
    for src in numbered():
        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im).convert("RGB")
            entry = {"n": int(src.stem)}
            for folder, (width, quality) in SIZES.items():
                copy = im.copy()
                if copy.width > width:
                    copy = copy.resize((width, round(copy.height * width / copy.width)), Image.LANCZOS)
                dest = ROOT / folder / src.name
                copy.save(dest, "WEBP", quality=quality, method=6)
                entry[folder] = f"assets/slideshow/{folder}/{src.name}"
                entry["w"], entry["h"] = copy.width, copy.height
            out.append(entry)
            print(f"{src.name}: {src.stat().st_size // 1024} KB -> {(ROOT / 'web' / src.name).stat().st_size // 1024} KB")
    (ROOT / "manifest.json").write_text(json.dumps(out, indent=1))
    print(f"{len(out)} photos, manifest written.")


if __name__ == "__main__":
    main()
