#!/usr/bin/env python3
"""Render the first page of a PDF to a PNG using PyMuPDF.

Used by ``server.py`` as a fallback when the bridge process itself cannot
import ``fitz`` (e.g. it runs on the system Python while the bundled engine
runtime holds the dependencies).

Usage: make_thumb.py <site_packages> <pdf> <out_png> [width]
"""
import os
import sys


def main():
    if len(sys.argv) < 4:
        return 2
    site, pdf, out = sys.argv[1], sys.argv[2], sys.argv[3]
    width = int(sys.argv[4]) if len(sys.argv) > 4 else 240
    if site and os.path.isdir(site):
        sys.path.insert(0, site)

    import fitz

    doc = fitz.open(pdf)
    page = doc.load_page(0)
    zoom = max(0.2, float(width) / max(1.0, page.rect.width))
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
    pix.save(out)
    doc.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
