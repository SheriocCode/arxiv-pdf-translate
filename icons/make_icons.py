"""Generate square extension icons from icons/logo.png.

The logo is tall aspect ratio; we fit it (preserving aspect) into a square
transparent canvas, centered, then export the PNG sizes and a multi-size .ico.

Run: python icons/make_icons.py
"""
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
LOGO = os.path.join(HERE, "logo.png")
FILL = 0.92  # fraction of the square the logo occupies


def fit_square(logo, size):
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    width, height = logo.size
    scale = min(size * FILL / width, size * FILL / height)
    new_size = (max(1, round(width * scale)), max(1, round(height * scale)))
    resized = logo.resize(new_size, Image.LANCZOS)
    offset = ((size - new_size[0]) // 2, (size - new_size[1]) // 2)
    canvas.paste(resized, offset, resized)
    return canvas


def main():
    logo = Image.open(LOGO).convert("RGBA")

    for size in (16, 32, 48, 128):
        fit_square(logo, size).save(os.path.join(HERE, "icon%d.png" % size))
        print("wrote icon%d.png" % size)

    ico_sizes = (16, 24, 32, 48, 64, 128, 256)
    fit_square(logo, 256).save(
        os.path.join(HERE, "icon.ico"),
        format="ICO",
        sizes=[(s, s) for s in ico_sizes],
    )
    print("wrote icon.ico")


if __name__ == "__main__":
    main()
