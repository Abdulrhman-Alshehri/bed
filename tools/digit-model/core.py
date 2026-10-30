"""Glyph segmentation and features for Arabic-Indic digit strings.
Kept deliberately simple so it can be ported 1:1 to TypeScript."""
import numpy as np

CLASSES = list('٠١٢٣٤٥٦٧٨٩') + ['/', 'x']
GRID = 16
NORM_H = 48  # the crop is scaled so the reference line height is this many pixels


def otsu(gray):
    hist = np.bincount(gray.astype(np.uint8).ravel(), minlength=256).astype(np.float64)
    total = hist.sum(); sum_all = (np.arange(256) * hist).sum()
    w0 = 0.0; s0 = 0.0; best = 0.0; t = 127
    for i in range(256):
        w0 += hist[i]
        if w0 == 0: continue
        w1 = total - w0
        if w1 == 0: break
        s0 += i * hist[i]
        m0 = s0 / w0; m1 = (sum_all - s0) / w1
        between = w0 * w1 * (m0 - m1) ** 2
        if between > best: best = between; t = i
    return t


def binarize(gray):
    """Dark text → True."""
    return gray <= otsu(gray)


def components(mask):
    """8-connected components: list of (x0, y0, x1, y1, area, pixel coords)."""
    h, w = mask.shape
    labels = np.zeros((h, w), np.int32)
    out = []
    ys, xs = np.nonzero(mask)
    for sy, sx in zip(ys, xs):
        if labels[sy, sx]: continue
        n = len(out) + 1
        stack = [(sy, sx)]; labels[sy, sx] = n; pts = []
        while stack:
            y, x = stack.pop(); pts.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not labels[yy, xx]:
                        labels[yy, xx] = n; stack.append((yy, xx))
        p = np.array(pts)
        out.append(dict(x0=int(p[:, 1].min()), y0=int(p[:, 0].min()), x1=int(p[:, 1].max()) + 1, y1=int(p[:, 0].max()) + 1, area=len(pts), pts=p))
    return out


def glyphs(mask, min_area_frac=0.01):
    """Components merged into glyphs (stacked parts joined, touching digits split), sorted left to right."""
    h, w = mask.shape
    # drop components touching the top or bottom edge (pieces of neighbouring lines)
    comps = [c for c in components(mask) if c['area'] >= 3 and c['y0'] > 0 and c['y1'] < h]
    if not comps: return []
    # Noise threshold relative to the text height, so the small ٠ dot is kept.
    hs = [c['y1'] - c['y0'] for c in comps]
    tall = [x for x in hs if x >= 0.5 * max(hs)]
    Hd = float(np.median(tall))
    comps = [c for c in comps if c['area'] >= max(3, min_area_frac * Hd * Hd)]
    comps.sort(key=lambda c: c['x0'])
    merged = []
    for c in comps:
        if merged:
            m = merged[-1]
            overlap = min(m['x1'], c['x1']) - max(m['x0'], c['x0'])
            narrow = min(m['x1'] - m['x0'], c['x1'] - c['x0'])
            v_overlap = min(m['y1'], c['y1']) - max(m['y0'], c['y0'])
            short = min(m['y1'] - m['y0'], c['y1'] - c['y0'])
            # Stacked parts (colon, broken stroke) are joined; neighbours side by side are not.
            if overlap > 0.5 * narrow and v_overlap < 0.3 * short:
                m['x0'] = min(m['x0'], c['x0']); m['x1'] = max(m['x1'], c['x1'])
                m['y0'] = min(m['y0'], c['y0']); m['y1'] = max(m['y1'], c['y1'])
                m['area'] += c['area']; m['pts'] = np.vstack([m['pts'], c['pts']]); m['parts'] += 1
                continue
        merged.append(dict(c, parts=1))
    return split_wide(merged)


def _from_pts(pts, parts=1):
    return dict(x0=int(pts[:, 1].min()), y0=int(pts[:, 0].min()), x1=int(pts[:, 1].max()) + 1, y1=int(pts[:, 0].max()) + 1,
                area=len(pts), pts=pts, parts=parts)


def split_wide(gs, max_ratio=1.2):
    """Touching digits: a glyph much wider than the digit height is cut at its thinnest column."""
    if not gs: return gs
    hs = [g['y1'] - g['y0'] for g in gs]
    tall = [h for h in hs if h >= 0.6 * max(hs)]
    H = float(np.median(tall))
    out = []
    todo = list(gs)
    while todo:
        g = todo.pop(0)
        w = g['x1'] - g['x0']
        if w <= max_ratio * H or g['y1'] - g['y0'] < 0.6 * H:
            out.append(g); continue
        cols = np.bincount(g['pts'][:, 1] - g['x0'], minlength=w)
        lo, hi = int(0.3 * w), int(0.7 * w)
        cut = lo + int(np.argmin(cols[lo:hi + 1]))
        left = g['pts'][g['pts'][:, 1] - g['x0'] < cut]; right = g['pts'][g['pts'][:, 1] - g['x0'] >= cut]
        if len(left) == 0 or len(right) == 0:
            out.append(g); continue
        todo[0:0] = [_from_pts(left), _from_pts(right)]
    out.sort(key=lambda g: g['x0'])
    return out


def line_metrics(gs):
    """Digit height and vertical centre from the taller glyphs."""
    if not gs: return None
    hs = np.array([g['y1'] - g['y0'] for g in gs], float)
    tall = [g for g, hh in zip(gs, hs) if hh >= 0.6 * hs.max()]
    H = float(np.median([g['y1'] - g['y0'] for g in tall]))
    cy = float(np.median([(g['y0'] + g['y1']) / 2 for g in tall]))
    return H, cy


def area_resize(img, out_w, out_h):
    """Box-filter resize of a float image (exact pixel-coverage weights)."""
    h, w = img.shape
    def weights(n_in, n_out):
        W = np.zeros((n_out, n_in))
        scale = n_in / n_out
        for o in range(n_out):
            a, b = o * scale, (o + 1) * scale
            for i in range(int(np.floor(a)), min(n_in, int(np.ceil(b)))):
                W[o, i] = max(0.0, min(b, i + 1) - max(a, i))
            W[o] /= W[o].sum()
        return W
    return weights(h, out_h) @ img @ weights(w, out_w).T


def features(g, H, cy):
    """16×16 glyph bitmap (aspect kept, centred) + geometry relative to the line."""
    gw, gh = g['x1'] - g['x0'], g['y1'] - g['y0']
    side = max(gw, gh)
    box = np.zeros((side, side))
    ox, oy = (side - gw) // 2, (side - gh) // 2
    pts = g['pts']
    box[pts[:, 0] - g['y0'] + oy, pts[:, 1] - g['x0'] + ox] = 1.0
    small = area_resize(box, GRID, GRID).ravel()
    geo = np.array([gh / H, gw / H, ((g['y0'] + g['y1']) / 2 - cy) / H, gw / max(gh, 1)])
    return np.concatenate([small, np.clip(geo, -3, 3)])
