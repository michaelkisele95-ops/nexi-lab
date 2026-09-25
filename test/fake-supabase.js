/**
 * Faux client Supabase en mémoire, pour tester la logique métier de
 * api/proxy.js sans réseau ni vraie base Postgres. Couvre uniquement les
 * opérations utilisées par ce projet (select/eq/maybeSingle/order/limit,
 * insert, update, delete, rpc) — pas un mock générique de PostgREST.
 */
function createFakeSupabase(seed) {
  const db = JSON.parse(JSON.stringify(seed || {}));
  Object.keys(db).forEach((k) => { if (!Array.isArray(db[k])) db[k] = []; });

  function matches(row, filters) {
    return filters.every(([col, val]) => row[col] === val);
  }

  function from(table) {
    db[table] = db[table] || [];
    const filters = [];
    let orderCol = null, orderAsc = true, limitN = null;

    const builder = {
      select() { return builder; },
      eq(col, val) { filters.push([col, val]); return builder; },
      order(col, opts) { orderCol = col; orderAsc = !(opts && opts.ascending === false); return builder; },
      limit(n) { limitN = n; return builder; },
      async maybeSingle() {
        const row = db[table].find((r) => matches(r, filters));
        return { data: row || null, error: null };
      },
      async insert(rowOrRows) {
        const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
        for (const r of rows) {
          if (table === "users" && db.users.some((u) => u.identifiant === r.identifiant)) {
            return { data: null, error: { code: "23505", message: "duplicate" } };
          }
          if (table === "dungeon_attempts" && db.dungeon_attempts.some(
            (a) => a.user_id === r.user_id && a.dungeon_id === r.dungeon_id && a.date_jour === r.date_jour
          )) {
            return { data: null, error: { code: "23505", message: "duplicate" } };
          }
          r.id = r.id || table + "_" + Math.random().toString(36).slice(2, 8);
          db[table].push(r);
        }
        return { data: rows, error: null };
      },
      update(patch) {
        return {
          async eq(col, val) {
            db[table].forEach((r) => { if (r[col] === val) Object.assign(r, patch); });
            return { data: null, error: null };
          },
        };
      },
      delete() {
        return {
          async eq(col, val) {
            db[table] = db[table].filter((r) => r[col] !== val);
            return { data: null, error: null };
          },
        };
      },
      then(resolve, reject) {
        let rows = db[table].filter((r) => matches(r, filters));
        if (orderCol) rows = rows.slice().sort((a, b) => (orderAsc ? a[orderCol] - b[orderCol] : b[orderCol] - a[orderCol]));
        if (limitN) rows = rows.slice(0, limitN);
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  async function rpc(name, params) {
    if (name === "apply_nx_delta") {
      const u = db.users.find((x) => x.id === params.p_user_id);
      if (!u) return { data: null, error: { message: "not found" } };
      u.nx = Math.max(0, Math.round(u.nx + params.p_delta));
      return { data: u.nx, error: null };
    }
    if (name === "play_bet") {
      const u = db.users.find((x) => x.id === params.p_user_id);
      if (!u) return { data: null, error: { message: "not found" } };
      if (u.nx < params.p_bet) return { data: null, error: null }; // fonction SQL réelle : renvoie NULL, pas une erreur
      u.nx = Math.max(0, Math.round(u.nx + params.p_delta));
      return { data: u.nx, error: null };
    }
    return { data: null, error: { message: "rpc inconnue: " + name } };
  }

  return { from, rpc, _db: db };
}

module.exports = { createFakeSupabase };
