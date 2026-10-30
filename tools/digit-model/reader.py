"""Date reader prototype: locate the value next to a label, segment, classify, decode with date constraints."""
import json, os, datetime, itertools
import numpy as np, cv2
import core

HERE = os.path.dirname(os.path.abspath(__file__))
M = json.load(open(os.path.join(HERE, os.environ.get('MODEL', 'model-quantized.json'))))
W1, b1, W2, b2 = (np.array(M[k], np.float32) for k in ('W1', 'b1', 'W2', 'b2'))
DIGITS = '0123456789'
SLASH, JUNK = 10, 11


def classify(F):
    h = np.maximum(0, F @ W1 + b1); z = h @ W2 + b2
    z -= z.max(1, keepdims=True); p = np.exp(z); return p / p.sum(1, keepdims=True)


def band_for_label(gray, bbox, widths=11.0):
    lh = bbox['y1'] - bbox['y0']
    cy = (bbox['y0'] + bbox['y1']) / 2
    x0 = int(max(0, bbox['x0'] - widths * lh)); x1 = int(min(gray.shape[1], bbox['x0'] + 0.15 * lh))
    y0 = int(max(0, cy - 0.95 * lh)); y1 = int(min(gray.shape[0], cy + 0.95 * lh))
    crop = gray[y0:y1, x0:x1].astype(np.float32)
    s = core.NORM_H / lh
    return cv2.resize(crop, (max(1, int(crop.shape[1] * s)), max(1, int(crop.shape[0] * s))), interpolation=cv2.INTER_CUBIC), (x0, y0, s)


def groups(gs, gap):
    out = []
    for g in gs:
        if out and g['x0'] - out[-1][-1]['x1'] <= gap: out[-1].append(g)
        else: out.append([g])
    return out


def is_valid(y, m, d, today):
    if 1318 <= y <= 1460:
        return 1 <= m <= 12 and 1 <= d <= 30
    if not (1900 <= y <= today.year): return False
    try: return datetime.date(y, m, d) <= today
    except ValueError: return False


PATTERNS = [(4, 2, 2), (4, 1, 2), (4, 2, 1), (4, 1, 1), (2, 2, 4), (1, 2, 4), (2, 1, 4), (1, 1, 4)]


def classify_group(grp):
    H, cy = core.line_metrics(grp)
    return classify(np.array([core.features(g, H, cy) for g in grp], np.float32)), H, cy


def split_unclear(grp):
    """A glyph that looks like junk may be two touching glyphs (e.g. «٨/»): try cutting it."""
    P, H, cy = classify_group(grp)
    out = []
    for g, p in zip(grp, P):
        w = g['x1'] - g['x0']
        if p[:11].max() < 0.5 and w >= 0.6 * H:
            cols = np.bincount(g['pts'][:, 1] - g['x0'], minlength=w)
            lo, hi = int(0.25 * w), int(0.75 * w)
            cut = lo + int(np.argmin(cols[lo:hi + 1]))
            a = g['pts'][g['pts'][:, 1] - g['x0'] < cut]; b = g['pts'][g['pts'][:, 1] - g['x0'] >= cut]
            if len(a) and len(b):
                ga, gb = core._from_pts(a), core._from_pts(b)
                q = classify(np.array([core.features(ga, H, cy), core.features(gb, H, cy)], np.float32))
                if q[0, :11].max() >= 0.5 and q[1, :11].max() >= 0.5:
                    out += [ga, gb]; continue
        out.append(g)
    return out


def decode(P, today=datetime.date(2026, 10, 30), max_skip=3):
    n = len(P)
    if n > 14: return []
    logP = np.log(P + 1e-6)
    skippable = [i for i in range(n) if P[i, JUNK] >= 0.2]
    top = [np.argsort(-P[i, :10])[:3] for i in range(n)]
    best = {}
    for pat in PATTERNS:
        L = sum(pat) + 2
        k = n - L
        if k < 0 or k > max_skip or k > len(skippable): continue
        for skip in itertools.combinations(skippable, k):
            keep = [i for i in range(n) if i not in skip]
            base = sum(logP[i, JUNK] for i in skip)
            s1, s2 = keep[pat[0]], keep[pat[0] + 1 + pat[1]]
            if P[s1, SLASH] < 0.02 or P[s2, SLASH] < 0.02: continue  # keeps the search small
            base += logP[s1, SLASH] + logP[s2, SLASH]
            segs = [keep[:pat[0]], keep[pat[0] + 1:pat[0] + 1 + pat[1]], keep[pat[0] + 2 + pat[1]:]]
            combos = [[(sum(logP[i, d] for i, d in zip(ix, c)), ''.join(str(d) for d in c)) for c in itertools.product(*[top[i] for i in ix])] for ix in segs]
            for (la, a), (lb, b), (lc, c) in itertools.product(*combos):
                y, m, d = (int(a), int(b), int(c)) if pat[0] == 4 else (int(c), int(b), int(a))
                if not is_valid(y, m, d, today): continue
                iso = f'{y:04d}-{m:02d}-{d:02d}'
                score = base + la + lb + lc
                if score > best.get(iso, -1e9): best[iso] = score
    return sorted(((v, k) for k, v in best.items()), reverse=True)


def read_date(gray, bbox):
    band, (x0, y0, s) = band_for_label(gray, bbox)
    gs = core.glyphs(core.binarize(band))
    if not gs: return None, []
    rough = core.line_metrics(gs)[0]
    label_x = (bbox['x0'] - x0) * s
    gs = [g for g in gs if g['x1'] <= label_x + 2]
    tried = []
    for grp in reversed(groups(gs, gap=1.0 * rough)):  # nearest the label first
        if len(grp) < 5: continue
        grp = split_unclear(grp)
        P, _, _ = classify_group(grp)
        raw = ''.join(core.CLASSES[i] for i in P.argmax(1))
        c = decode(P)
        tried.append((raw, c[:2]))
        if c: return c, tried
    return None, tried


def read_digits(gray, bbox):
    band, (x0, y0, s) = band_for_label(gray, bbox, widths=12.0)
    gs = core.glyphs(core.binarize(band))
    if not gs: return None
    rough = core.line_metrics(gs)[0]
    label_x = (bbox['x0'] - x0) * s
    gs = [g for g in gs if g['x1'] <= label_x + 2]
    for grp in reversed(groups(gs, gap=1.0 * rough)):
        if len(grp) < 6: continue
        P, _, _ = classify_group(split_unclear(grp))
        keep = P[:, JUNK] < 0.5
        digits = ''.join(DIGITS[i] for i in P[keep, :10].argmax(1))
        return digits, float(P[keep, :10].max(1).min()) if keep.any() else 0.0
    return None
