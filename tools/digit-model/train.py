import json, os, sys, time
import numpy as np
from multiprocessing import Pool
import gen, core

HERE = os.path.dirname(os.path.abspath(__file__))


def chunk(args):
    n, fonts, seed = args
    return gen.dataset(n, fonts, seed)


def build(n_lines, fonts, seed0, parts=8):
    with Pool(parts) as pool:
        res = pool.map(chunk, [(n_lines // parts, fonts, seed0 + i) for i in range(parts)])
    return np.concatenate([r[0] for r in res]), np.concatenate([r[1] for r in res])


class MLP:
    def __init__(self, n_in, n_hidden, n_out, rng):
        self.W1 = rng.normal(0, np.sqrt(2 / n_in), (n_in, n_hidden)).astype(np.float32); self.b1 = np.zeros(n_hidden, np.float32)
        self.W2 = rng.normal(0, np.sqrt(2 / n_hidden), (n_hidden, n_out)).astype(np.float32); self.b2 = np.zeros(n_out, np.float32)

    def forward(self, X):
        h = np.maximum(0, X @ self.W1 + self.b1)
        z = h @ self.W2 + self.b2
        z = z - z.max(1, keepdims=True); p = np.exp(z); p /= p.sum(1, keepdims=True)
        return h, p

    def train(self, X, Y, epochs, lr=2e-3, batch=256, wd=1e-4, rng=None):
        params = [self.W1, self.b1, self.W2, self.b2]
        m = [np.zeros_like(p) for p in params]; v = [np.zeros_like(p) for p in params]; t = 0
        for ep in range(epochs):
            idx = rng.permutation(len(X)); loss = 0
            lr_ep = lr * (0.5 * (1 + np.cos(np.pi * ep / epochs)))
            for s in range(0, len(X), batch):
                b = idx[s:s + batch]; xb, yb = X[b], Y[b]
                # input noise for robustness
                xb = xb + rng.normal(0, 0.05, xb.shape).astype(np.float32)
                h, p = self.forward(xb)
                loss -= np.log(p[np.arange(len(b)), yb] + 1e-9).sum()
                g = p.copy(); g[np.arange(len(b)), yb] -= 1; g /= len(b)
                gW2 = h.T @ g + wd * self.W2; gb2 = g.sum(0)
                gh = g @ self.W2.T; gh[h <= 0] = 0
                gW1 = xb.T @ gh + wd * self.W1; gb1 = gh.sum(0)
                t += 1
                for i, (pp, gg) in enumerate(zip(params, [gW1, gb1, gW2, gb2])):
                    m[i] = 0.9 * m[i] + 0.1 * gg; v[i] = 0.999 * v[i] + 0.001 * gg * gg
                    pp -= lr_ep * (m[i] / (1 - 0.9 ** t)) / (np.sqrt(v[i] / (1 - 0.999 ** t)) + 1e-8)
            print(f'  epoch {ep + 1}: loss {loss / len(X):.4f}', flush=True)

    def predict(self, X):
        return self.forward(X)[1]


if __name__ == '__main__':
    t = time.time()
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 16000
    data = os.path.join(HERE, f'data-{n}.npz')
    if os.path.exists(data):
        d = np.load(data); X, Y, Xt, Yt = d['X'], d['Y'], d['Xt'], d['Yt']
    else:
        X, Y = build(n, gen.TRAIN_FONTS, 100)
        Xt, Yt = build(1600, gen.TEST_FONTS, 900)
        np.savez_compressed(data, X=X, Y=Y, Xt=Xt, Yt=Yt)
    print('train', X.shape, 'test', Xt.shape, f'{time.time() - t:.0f}s', flush=True)
    rng = np.random.default_rng(0)
    net = MLP(X.shape[1], int(os.environ.get('HIDDEN', 192)), len(core.CLASSES), rng)
    net.train(X, Y, epochs=int(os.environ.get('EPOCHS', 30)), rng=rng)
    for name, A, B in [('train', X, Y), ('held-out fonts', Xt, Yt)]:
        pred = net.predict(A).argmax(1)
        acc = (pred == B).mean()
        digit = B < 11
        print(f'{name}: all {acc:.4f}  digits+slash {(pred[digit] == B[digit]).mean():.4f}')
    conf = np.zeros((12, 12), int)
    for a, b in zip(Yt, net.predict(Xt).argmax(1)): conf[a, b] += 1
    print('confusion (held-out):'); print('     ' + ' '.join(f'{c:>4}' for c in core.CLASSES))
    for i, row in enumerate(conf): print(f'{core.CLASSES[i]:>4} ' + ' '.join(f'{v:>4}' for v in row))
    json.dump({'classes': core.CLASSES, 'grid': core.GRID, 'normH': core.NORM_H,
               'W1': np.round(net.W1, 4).tolist(), 'b1': np.round(net.b1, 4).tolist(),
               'W2': np.round(net.W2, 4).tolist(), 'b2': np.round(net.b2, 4).tolist()}, open(os.path.join(HERE, os.environ.get('OUT', 'model.json')), 'w'))
    print(f'done {time.time() - t:.0f}s')
