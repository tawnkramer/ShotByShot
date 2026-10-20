/**
 * Levenberg–Marquardt least squares with a numeric Jacobian: finds the
 * parameters that make `residuals` smallest (sum of squares). Small and
 * dependency-free; meant for a handful of parameters.
 */
export function leastSquares(
  residuals: (p: number[]) => number[],
  start: number[],
  steps: number[],
  { iterations = 100, tolerance = 1e-12 } = {},
): { params: number[]; cost: number } {
  let p = [...start];
  let r = residuals(p);
  let cost = sumSq(r);
  let lambda = 1e-3;
  for (let it = 0; it < iterations && lambda < 1e10; it++) {
    const n = p.length, m = r.length;
    // Forward differences, one column per parameter.
    const J: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const q = [...p];
      q[j] += steps[j];
      const rq = residuals(q);
      for (let i = 0; i < m; i++) J[i][j] = (rq[i] - r[i]) / steps[j];
    }
    const A = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
    const g = Array.from({ length: n }, (_, a) => J.reduce((s, row, i) => s + row[a] * r[i], 0));
    let improved = false;
    while (lambda < 1e10) {
      const damped = A.map((row, a) => row.map((x, b) => (a === b ? x + lambda * (x + 1e-9) : x)));
      const delta = solve(damped, g.map((x) => -x));
      if (!delta) {
        lambda *= 4;
        continue;
      }
      const q = p.map((x, j) => x + delta[j]);
      const rq = residuals(q);
      const c = sumSq(rq);
      if (c < cost) {
        const gain = cost - c;
        p = q;
        r = rq;
        cost = c;
        lambda = Math.max(1e-9, lambda / 3);
        improved = true;
        if (gain <= tolerance * Math.max(cost, 1e-12)) return { params: p, cost };
        break;
      }
      lambda *= 4;
    }
    if (!improved) break;
  }
  return { params: p, cost };
}

const sumSq = (r: number[]) => r.reduce((s, x) => s + x * x, 0);

/** Solves A x = b by Gaussian elimination with partial pivoting; null if A is singular. */
export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-14) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}
