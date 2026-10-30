import random, datetime, sys
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
import gen, reader

def render(rng, font_path, date_iso, hijri=False):
    y, m, d = date_iso.split('-')
    s = gen.to_ar(f'{y}/{m}/{d}')
    size = 64
    font = ImageFont.truetype(font_path, size, layout_engine=ImageFont.Layout.BASIC)
    lab_font = ImageFont.truetype(font_path, int(size * rng.uniform(0.85, 1.05)), layout_engine=ImageFont.Layout.RAQM)
    slash = ImageFont.truetype(rng.choice(gen.SLASH_FONTS), size, layout_engine=ImageFont.Layout.BASIC)
    W, H = 1400, 220
    canvas = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(canvas)
    x = 40; by = 70
    if rng.random() < 0.6:
        word = rng.choice(['مكان الميلاد', 'الجنسية', 'تاريخ الانتهاء'])
        dr.text((x, by), word, font=lab_font, fill=255, direction='rtl'); x += lab_font.getlength(word, direction='rtl') + rng.uniform(1.5, 4) * size
    one = dr.textbbox((0, by), '١', font=font)
    track = rng.uniform(-0.06, 0.1) * size
    for ch in s:
        if ch == '/':
            sb = dr.textbbox((0, 0), '/', font=slash); th = (one[3] - one[1]) * rng.uniform(0.95, 1.2)
            sf = ImageFont.truetype(slash.path, max(8, int(slash.size * th / max(1, sb[3] - sb[1]))), layout_engine=ImageFont.Layout.BASIC)
            sb = dr.textbbox((0, 0), '/', font=sf); sy = (one[1] + one[3]) / 2 - (sb[1] + sb[3]) / 2
            dr.text((x, sy), '/', font=sf, fill=255); x += sf.getlength('/') + track
        else:
            dr.text((x, by), ch, font=font, fill=255); x += font.getlength(ch) + track
    x += rng.uniform(0.8, 2.5) * size
    label = 'تاريخ الميلاد:' if rng.random() < 0.5 else 'تاريخ الميلاد'
    lb = dr.textbbox((x, by - 4), label, font=lab_font, direction='rtl')
    dr.text((x, by - 4), label, font=lab_font, fill=255, direction='rtl')
    ink = np.array(canvas, np.float32) / 255
    if rng.random() < 0.3: ink = cv2.dilate(ink, np.ones((3, 3), np.uint8))
    dh = one[3] - one[1]
    img = gen.background(rng, W, H) * (1 - ink) + rng.uniform(0, 80) * ink
    target = rng.uniform(*BUCKET)
    f = target / dh
    small = cv2.resize(img, (int(W * f), int(H * f)), interpolation=cv2.INTER_AREA)
    sig = rng.uniform(0, 1.0)
    if sig > 0.2: small = cv2.GaussianBlur(small, (0, 0), sig)
    small = np.clip(small + np.random.normal(0, rng.uniform(0, 8), small.shape), 0, 255).astype(np.uint8)
    ok, enc = cv2.imencode('.jpg', small, [cv2.IMWRITE_JPEG_QUALITY, rng.randint(40, 95)]); small = cv2.imdecode(enc, 0)
    bbox = {'x0': lb[0] * f, 'x1': lb[2] * f, 'y0': lb[1] * f, 'y1': lb[3] * f}
    return small, bbox

BUCKET = (20, 40)
if __name__ == '__main__':
  ALL = []
  for BUCKET in [(7, 10), (10, 14), (14, 20), (20, 40)]:
      rng = random.Random(5); np.random.seed(5)
      stats = dict(ok=0, wrong=0, none=0, wrong_confident=0, margins_ok=[], margins_wrong=[])
      for i in range(250):
          hijri = rng.random() < 0.25
          if hijri: iso = f'{rng.randint(1340, 1440)}-{rng.randint(1,12):02d}-{rng.randint(1,29):02d}'
          else:
              dt = datetime.date(1930, 1, 1) + datetime.timedelta(days=rng.randint(0, 34000)); iso = dt.isoformat()
          small, bbox = render(rng, rng.choice(gen.TEST_FONTS), iso, hijri)
          best, _ = reader.read_date(small.astype(np.float32), bbox)
          if not best: stats['none'] += 1; continue
          margin = best[0][0] - (best[1][0] if len(best) > 1 else -30)
          if best[0][1] == iso: stats['ok'] += 1; stats['margins_ok'].append((float(best[0][0]), float(margin)))
          else:
              stats['wrong'] += 1; stats['margins_wrong'].append((float(best[0][0]), float(margin)))
              if margin >= 3: stats['wrong_confident'] += 1
      mo, mw = stats.pop('margins_ok'), stats.pop('margins_wrong')
      ALL.append((BUCKET, mo, mw))
      print(f'digit height {BUCKET}: {stats}', flush=True)
  import pickle; pickle.dump(ALL, open('synth-scores.pkl', 'wb'))
