#!/usr/bin/env python3
"""Gera os ícones da extensão a partir de apps/web/public/voxen-512.png.

Reenquadramento (não é redesenho da arte): recorta o padding transparente da
fonte, escala com LANCZOS preservando a proporção e centraliza no canvas
quadrado. A arte é retrato (314x505, ~0.62), então a altura é o limite: ela
ocupa 100% da altura do canvas e o que sobra vira padding lateral simétrico.

Fica fora de `icons/` de propósito: o `package.sh` copia a pasta inteira para
o ZIP e um script Python não tem o que fazer dentro da extensão publicada.

Uso: python3 apps/extension/tools/generate-icons.py
Requer Pillow.
"""

from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "apps/web/public/voxen-512.png"
OUT_DIR = ROOT / "apps/extension/icons"
SIZES = (16, 48, 128)

# Só o 16px leva nitidez: reduzir 505px para 16px (32x) borra a arte a ponto
# de perder a silhueta, e um unsharp leve devolve a definição das bordas sem
# alterar o desenho. Em 48 e 128 o LANCZOS puro já é fiel — sharpen ali só
# criaria halo.
SHARPEN = {16: (0.5, 60)}


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    art = source.crop(source.split()[3].getbbox())

    for size in SIZES:
        width = round(art.width * size / art.height)
        scaled = art.resize((width, size), Image.LANCZOS)

        params = SHARPEN.get(size)
        if params:
            radius, percent = params
            scaled = scaled.filter(
                ImageFilter.UnsharpMask(radius=radius, percent=percent, threshold=0)
            )

        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        canvas.paste(scaled, ((size - width) // 2, 0), scaled)

        target = OUT_DIR / f"icon-{size}.png"
        canvas.save(target, optimize=True)
        left, top, right, bottom = canvas.split()[3].getbbox()
        print(
            f"{target.name}: arte {right - left}x{bottom - top} "
            f"padding L{left} R{size - right} T{top} B{size - bottom}"
        )


if __name__ == "__main__":
    main()
