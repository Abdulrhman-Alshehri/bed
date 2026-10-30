"""Synthetic training lines: Arabic-Indic digit strings in many fonts, degraded like phone photos of cards."""
import glob, io, os, random
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import core

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = os.path.join(HERE, 'fonts')
HOLDOUT = ('amiri', 'mada', 'readex-pro', 'harmattan')
ALL_FONTS = [f for f in sorted(glob.glob(os.path.join(FONT_DIR, '*.woff'))) if 'zain' not in f]
TRAIN_FONTS = [f for f in ALL_FONTS if not any(h in f for h in HOLDOUT)]
TEST_FONTS = [f for f in ALL_FONTS if any(h in f for h in HOLDOUT)]
SLASH_FONTS = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
               '/usr/share/fonts/truetype/freefont/FreeSerif.ttf', '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
               '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf', '/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf']
SLASH_FONTS = [f for f in SLASH_FONTS if os.path.exists(f)]
AR = '٠١٢٣٤٥٦٧٨٩'
WORDS = ['تاريخ الميلاد', 'تاريخ الانتهاء', 'رقم الهوية', 'مكان الميلاد', 'الجنسية', 'الديانة', 'المهنة', 'العربية السعودية', 'هـ', 'م']


def to_ar(s):
    return ''.join(AR[int(c)] if c.isdigit() else c for c in s)


def random_string(rng):
    r = rng.random()
    if r < 0.45:
        y = rng.randint(1925, 2030); m = rng.randint(1, 12); d = rng.randint(1, 28)
        return to_ar(f'{y}/{m:02d}/{d:02d}' if rng.random() < 0.7 else f'{d:02d}/{m:02d}/{y}')
    if r < 0.6:
        y = rng.randint(1340, 1452); m = rng.randint(1, 12); d = rng.randint(1, 30)
        return to_ar(f'{y}/{m:02d}/{d:02d}' if rng.random() < 0.7 else f'{d:02d}/{m:02d}/{y}')
    if r < 0.8:
        return to_ar(str(rng.choice([1, 2])) + ''.join(str(rng.randint(0, 9)) for _ in range(9)))
    n = rng.randint(3, 10)
    return ''.join(rng.choice(AR + AR + '/') for _ in range(n))


def background(rng, w, h):
    base = rng.uniform(215, 255)
    img = np.full((h, w), base, np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    for _ in range(rng.randint(0, 6)):  # guilloche-like curves
        f = rng.uniform(0.01, 0.08); ph = rng.uniform(0, 6.3); amp = rng.uniform(2, h / 3); y0 = rng.uniform(0, h)
        dist = np.abs(yy - (y0 + amp * np.sin(xx * f + ph)))
        img -= rng.uniform(10, 45) * np.exp(-(dist ** 2) / (2 * rng.uniform(0.4, 1.5) ** 2))
    if rng.random() < 0.4:  # watermark blob
        cx, cy, rr = rng.uniform(0, w), rng.uniform(0, h), rng.uniform(h, 3 * h)
        img -= rng.uniform(5, 25) * np.exp(-(((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * rr ** 2)))
    if rng.random() < 0.3:  # glare / gradient
        img += np.linspace(0, rng.uniform(-40, 40), w)[None, :]
    return img


def render_line(rng, fonts):
    """Returns (gray float image at camera resolution, list of (char, bbox) for digits/slashes, digit height)."""
    font_path = rng.choice(fonts)
    size = 64
    font = ImageFont.truetype(font_path, size, layout_engine=ImageFont.Layout.BASIC)
    slash_font = ImageFont.truetype(rng.choice(SLASH_FONTS), int(size * rng.uniform(0.8, 1.05)), layout_engine=ImageFont.Layout.BASIC)
    word_font = ImageFont.truetype(rng.choice(fonts), int(size * rng.uniform(0.8, 1.1)), layout_engine=ImageFont.Layout.RAQM)
    s = random_string(rng)
    W, H = 64 * (len(s) + 12), 220
    canvas = Image.new('L', (W, H), 0)  # ink mask (widened once the left text is placed)
    d = ImageDraw.Draw(canvas)
    x = rng.randint(20, 60)
    base_y = 70
    items = []
    if rng.random() < 0.4:  # Arabic text on the left (next column)
        word = rng.choice(WORDS)
        d.text((x, base_y), word, font=word_font, fill=255, direction='rtl')
        x += word_font.getlength(word, direction='rtl') + rng.uniform(1.5, 5) * size
    W = int(x + 64 * (len(s) + 10)); canvas2 = Image.new('L', (W, H), 0); canvas2.paste(canvas.crop((0, 0, min(canvas.width, W), H)), (0, 0)); canvas = canvas2; d = ImageDraw.Draw(canvas)
    one = d.textbbox((0, base_y), '١', font=font)  # digit line, used to place the slash
    track = (rng.uniform(-0.1, 0.0) if rng.random() < 0.25 else rng.uniform(-0.02, 0.12)) * size  # some touching digits
    for ch in s:
        dy = rng.uniform(-1, 1) * 0.02 * size
        if ch == '/':
            sb = d.textbbox((0, 0), '/', font=slash_font)
            target_h = (one[3] - one[1]) * rng.uniform(0.95, 1.25)
            sf = ImageFont.truetype(slash_font.path, max(8, int(slash_font.size * target_h / max(1, sb[3] - sb[1]))), layout_engine=ImageFont.Layout.BASIC)
            sb = d.textbbox((0, 0), '/', font=sf)
            sy = (one[1] + one[3]) / 2 - (sb[1] + sb[3]) / 2 + dy
            bb = d.textbbox((x, sy), '/', font=sf)
            d.text((x, sy), '/', font=sf, fill=255)
            items.append((ch, bb))
            x += sf.getlength('/') + track
            continue
        bb = d.textbbox((x, base_y + dy), ch, font=font)
        d.text((x, base_y + dy), ch, font=font, fill=255)
        items.append((ch, bb))
        x += font.getlength(ch) + track
    if rng.random() < 0.8:  # label (and colon) on the right
        x += rng.uniform(0.6, 2.5) * size
        if rng.random() < 0.6:
            d.text((x, base_y), ':', font=slash_font, fill=255); x += slash_font.getlength(':') + 6
        d.text((x, base_y - 4), rng.choice(WORDS), font=word_font, fill=255, direction='rtl')
    ink = np.array(canvas, np.float32) / 255
    # stroke weight variation
    k = rng.choice([0, 0, 0, 1, -1])
    if k:
        ker = np.ones((3, 3), np.uint8)
        ink = cv2.dilate(ink, ker) if k > 0 else cv2.erode(ink, ker)
    digit_boxes = [bb for ch, bb in items if ch in AR and ch != '٠']
    dh = float(np.median([b[3] - b[1] for b in digit_boxes])) if digit_boxes else size * 0.6
    bg = background(rng, W, H)
    color = rng.uniform(0, 90)
    img = bg * (1 - ink) + color * ink
    # camera resolution: digit height between 7 and 40 px
    target = rng.uniform(7, 40)
    f = target / dh
    small = cv2.resize(img, (max(8, int(W * f)), max(8, int(H * f))), interpolation=cv2.INTER_AREA)
    sig = rng.uniform(0, 1.1)
    if sig > 0.2: small = cv2.GaussianBlur(small, (0, 0), sig)
    small += np.random.normal(0, rng.uniform(0, 9), small.shape)
    small = np.clip(small, 0, 255).astype(np.uint8)
    if rng.random() < 0.7:
        ok, enc = cv2.imencode('.jpg', small, [cv2.IMWRITE_JPEG_QUALITY, rng.randint(35, 95)])
        small = cv2.imdecode(enc, cv2.IMREAD_GRAYSCALE)
    items_small = [(ch, tuple(v * f for v in bb)) for ch, bb in items]
    return small.astype(np.float32), items_small, dh * f


def normalize_band(rng, small, items, dh):
    """Mimic the app: scale so a label-height proxy becomes NORM_H, crop a band around the line."""
    proxy = dh * rng.uniform(1.35, 1.95)
    scale = core.NORM_H / proxy
    big = cv2.resize(small, (int(small.shape[1] * scale), int(small.shape[0] * scale)), interpolation=cv2.INTER_CUBIC)
    ys = [b[1] for _, b in items] + [b[3] for _, b in items]
    cy = (np.median([b[1] for _, b in items]) + np.median([b[3] for _, b in items])) / 2 * scale
    half = core.NORM_H * rng.uniform(0.75, 1.05)
    y0, y1 = int(max(0, cy - half)), int(min(big.shape[0], cy + half))
    band = big[y0:y1]
    items_big = [(ch, (b[0] * scale, b[1] * scale - y0, b[2] * scale, b[3] * scale - y0)) for ch, b in items]
    return np.clip(band, 0, 255), items_big


def components_fast(mask):
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    out = []
    for i in range(1, n):
        x, y, w, h, a = stats[i]
        ys, xs = np.nonzero(labels[y:y + h, x:x + w] == i)
        out.append(dict(x0=int(x), y0=int(y), x1=int(x + w), y1=int(y + h), area=int(a), pts=np.stack([ys + y, xs + x], 1)))
    return out


core.components = components_fast  # identical result, much faster for training


def labelled_glyphs(band, items):
    mask = core.binarize(band)
    gs = core.glyphs(mask)
    lm = core.line_metrics(gs)
    if lm is None: return [], None
    H, cy = lm
    out = []
    for g in gs:
        hits = [ch for ch, b in items if g['x0'] - 1 <= (b[0] + b[2]) / 2 <= g['x1'] + 1 and min(g['y1'], b[3]) - max(g['y0'], b[1]) > 0]
        label = hits[0] if len(hits) == 1 else 'x'
        out.append((core.features(g, H, cy), core.CLASSES.index(label)))
    return out, (H, cy)


def dataset(n_lines, fonts, seed):
    rng = random.Random(seed); np.random.seed(seed)
    X, Y = [], []
    for _ in range(n_lines):
        small, items, dh = render_line(rng, fonts)
        band, items_big = normalize_band(rng, small, items, dh)
        for feat, lab in labelled_glyphs(band, items_big)[0]:
            X.append(feat); Y.append(lab)
    return np.array(X, np.float32), np.array(Y, np.int64)


if __name__ == '__main__':
    import sys, time
    t = time.time()
    rng = random.Random(1); np.random.seed(1)
    os.makedirs(os.path.join(HERE, 'samples'), exist_ok=True)
    for i in range(6):
        small, items, dh = render_line(rng, TRAIN_FONTS)
        band, _ = normalize_band(rng, small, items, dh)
        Image.fromarray(band.astype(np.uint8)).save(os.path.join(HERE, 'samples', f's{i}.png'))
    X, Y = dataset(200, TRAIN_FONTS, 2)
    print(X.shape, np.bincount(Y, minlength=12), f'{time.time() - t:.1f}s')
