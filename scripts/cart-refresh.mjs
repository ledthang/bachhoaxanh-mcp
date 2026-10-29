// Observed website getAfter body; credentials stay opaque and are never projected.
export function validateRefresh(raw, baseline) {
  try {
    if (!baseline || typeof raw !== 'string' || raw.length > 16384) return false;
    const body = JSON.parse(raw);
    const fields = ['token', 'us', 'provinceId', 'districtId', 'wardId', 'storeId', 'isNewModel', 'data'];
    const names = [...raw.matchAll(/("(?:[^"\\]|\\.)*")\s*:/g)].map(m => JSON.parse(m[1]));
    if (names.length !== 11 || new Set(names).size !== 10 || names.filter(k => k === 'wardId').length !== 2) return false;
    const exact = (x, keys) => x && typeof x === 'object' && !Array.isArray(x) &&
      Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
    return Boolean(exact(body, fields) && exact(body.data, ['cartId', 'infoApp', 'wardId']) &&
      typeof body.token === 'string' && typeof body.us === 'string' && body.isNewModel === true &&
      ['provinceId', 'districtId', 'wardId', 'storeId'].every(k => Number.isSafeInteger(body[k]) &&
        (k === 'districtId' ? body[k] >= 0 : body[k] > 0) && body[k] === baseline[k]) &&
      typeof baseline.cartId === 'string' && baseline.cartId.length > 0 &&
      body.data.cartId === baseline.cartId && body.data.infoApp === 'webnew' && body.data.wardId === baseline.wardId);
  } catch { return false; }
}
