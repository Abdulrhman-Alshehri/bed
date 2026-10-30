# Arabic-Indic digit model

The app reads birth dates printed in Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) on Saudi IDs and Iqamas with
a small dedicated reader (`src/ocr/digitReader.ts`), because Tesseract's Arabic model misreads them.
These scripts train its classifier and write the weights the app uses (`src/ocr/digitModel.ts`).

No document images are used: every training image is rendered from open-licensed fonts.

## How it works

1. **Segmentation** (`core.py`, ported 1:1 to TypeScript): Otsu threshold, 8-connected components,
   stacked parts joined (colon, broken strokes), noise dropped relative to the text height (the
   small «٠» dot is kept), touching digits cut at their thinnest column.
2. **Features**: each glyph as a 16×16 bitmap (aspect kept) plus its size and position on the line.
3. **Classifier**: a one-hidden-layer network (260 → 192 → 12) for ٠–٩, «/» and "other"
   (letters, noise). Weights are stored as 8-bit integers (about 70 KB).
4. **Decoding** (`reader.py`, `digitReader.ts`): the most probable valid date, year/month/day or
   day/month/year, Gregorian (1900–today) or Hijri; noise glyphs may be skipped and unclear glyphs
   split. A reading is *confident* when its log-probability is ≥ −3 and it is ≥ 2 ahead of the
   next valid date.

## Training data

`gen.py` renders random dates, ID numbers and digit strings in 20 Arabic fonts, regular and bold
(four more fonts are held out for testing), with labels and colons beside them, on guilloche-like backgrounds, then degrades
them like phone photos: low resolution (digits 7–40 px tall), blur, noise, JPEG, glare gradients,
bolder or thinner strokes, touching glyphs.

## Results (held-out fonts, 250 dates per size)

| Digit height | Correct first reading | Confident and correct | Confident and wrong |
|---|---|---|---|
| 7–10 px | 76% | 59% | 1 |
| 10–14 px | 90% | 74% | 0 |
| 14–20 px | 93% | 74% | 0 |
| 20–40 px | 94% | 74% | 0 |

Uncertain readings are not filled in: the app offers them as a suggestion next to a picture of the
printed date. On four photos of a fictional Iqama specimen, the birth date was read correctly and
confidently in the three where the label was found (the fourth had the card too small in the frame).

## Reproducing

Requires Python 3 with `numpy`, `opencv-python` and `pillow` built with libraqm (Arabic shaping).

```bash
./fetch-fonts.sh           # fonts → ./fonts (npm @fontsource packages, OFL)
python3 train.py 16000     # renders ~300k glyphs, trains, writes model.json (about 15 minutes)
python3 export.py          # → src/ocr/digitModel.ts (8-bit) and model-quantized.json
python3 make_fixture.py    # → src/ocr/__fixtures__/digit-bands.json for the unit tests
python3 eval_synth.py      # accuracy on held-out fonts
```

After changing `core.py` or the decoder, change `src/ocr/digitReader.ts` the same way: the unit
tests compare it with the Python results on the fixture.
