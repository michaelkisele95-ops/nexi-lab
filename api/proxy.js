/**
 * NEXI LAB — api/proxy.js (fonction serverless Vercel)
 * =====================================================
 * Contient TOUTE la logique métier (auth, donjons, Nexify, cartes,
 * classement, administration). Le navigateur n'appelle que cette route
 * (même origine) ; Supabase n'est jamais contacté depuis le client.
 *
 * Remplace l'ancien backend Google Sheets/Apps Script : la principale
 * raison du changement était la lenteur (Apps Script répond souvent en
 * 1 à 5 secondes). Une requête Postgres bien indexée répond en quelques
 * millisecondes, d'où un gain de fluidité direct pour les joueurs.
 *
 * Sécurité :
 *  - La clé SUPABASE_SERVICE_ROLE_KEY (droits complets sur la base) ne vit
 *    que dans les variables d'environnement Vercel, jamais côté client.
 *  - Mots de passe : SHA-256 + sel par utilisateur.
 *  - Sessions à jeton opaque, 12h, revalidées à chaque appel.
 *  - Toute mutation de solde NX passe par une fonction SQL atomique
 *    (apply_nx_delta / play_bet) : impossible de corrompre un solde même
 *    avec deux requêtes simultanées (voir supabase/schema.sql).
 *  - Aucune erreur technique n'est jamais renvoyée telle quelle au joueur.
 */

const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const NexiLogic = require("../js/logic-core.js");

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const STARTING_NX = 100;

class BizError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || "business_error";
    this.friendly = true;
  }
}
function fail(message, code) { throw new BizError(message, code); }

function hashPassword(password, salt) {
  return crypto.createHash("sha256").update(password + ":" + salt).digest("hex");
}
function genSalt() { return crypto.randomBytes(16).toString("hex"); }
function genToken() { return crypto.randomBytes(32).toString("hex"); }
function todayStr() { return new Date().toISOString().slice(0, 10); }

let _sb = null;
function supabase() {
  if (_sb) return _sb;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    fail("Service momentanément indisponible. Réessaie dans un instant.", "config");
  }
  _sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  return _sb;
}

/* ---------------------------------------------------------------
 * Sessions
 * ------------------------------------------------------------- */
async function createSession(sb, userId, role) {
  const token = genToken();
  const { error } = await sb.from("sessions").insert({ token, user_id: userId, role, expires_at: Date.now() + SESSION_TTL_MS });
  if (error) fail("Connexion impossible pour le moment. Réessaie.", "error");
  return token;
}

async function requireSession(sb, token, requiredRole) {
  if (!token) fail("Session expirée, reconnecte-toi.", "auth");
  const { data, error } = await sb.from("sessions").select("*").eq("token", token).maybeSingle();
  if (error || !data || Number(data.expires_at) < Date.now()) fail("Session expirée, reconnecte-toi.", "auth");
  if (requiredRole && data.role !== requiredRole) fail("Accès refusé.", "auth");
  return data;
}

async function getUserOrFail(sb, token) {
  const s = await requireSession(sb, token, "nexian");
  const { data: u, error } = await sb.from("users").select("*").eq("id", s.user_id).maybeSingle();
  if (error || !u) fail("Compte introuvable.", "auth");
  return u;
}
async function requireAdmin(sb, token) { return requireSession(sb, token, "admin"); }

async function applyDelta(sb, userId, delta) {
  const { data, error } = await sb.rpc("apply_nx_delta", { p_user_id: userId, p_delta: delta });
  if (error) fail("Cette action n'a pas pu aboutir. Réessaie.", "error");
  return data;
}
async function playBet(sb, userId, bet, delta) {
  const { data, error } = await sb.rpc("play_bet", { p_user_id: userId, p_bet: bet, p_delta: delta });
  if (error) fail("Cette action n'a pas pu aboutir. Réessaie.", "error");
  if (data === null || data === undefined) fail("Mise invalide.", "bad_bet");
  return data;
}

/* ---------------------------------------------------------------
 * Actions — espace Nexian
 * ------------------------------------------------------------- */
const ACTIONS = {};

ACTIONS.login = async (sb, payload) => {
  const { data: u, error } = await sb.from("users").select("*").eq("identifiant", payload.identifiant).maybeSingle();
  if (error || !u) fail("Identifiant ou mot de passe incorrect.", "auth");
  if (u.abonnement !== "actif") fail("Ton abonnement est actuellement suspendu.", "subscription");
  if (hashPassword(payload.motDePasse, u.salt) !== u.password_hash) fail("Identifiant ou mot de passe incorrect.", "auth");
  const token = await createSession(sb, u.id, "nexian");
  await sb.from("users").update({ nb_connexions: (u.nb_connexions || 0) + 1, derniere_connexion: todayStr() }).eq("id", u.id);
  return { token, profileSummary: { identifiant: u.identifiant, nx: u.nx } };
};

ACTIONS.getProfile = async (sb, payload, token) => {
  const u = await getUserOrFail(sb, token);
  return { identifiant: u.identifiant, nx: u.nx, avatarId: u.avatar_id || "H", bestScore: u.best_score || 0, history: u.history || [] };
};

ACTIONS.setAvatar = async (sb, payload, token) => {
  const u = await getUserOrFail(sb, token);
  await sb.from("users").update({ avatar_id: payload.avatarId }).eq("id", u.id);
  return { ok: true };
};

ACTIONS.listDungeons = async (sb, payload, token) => {
  const u = await getUserOrFail(sb, token);
  const { data: dungeons } = await sb.from("dungeons").select("*").eq("publie", true);
  const { data: attempts } = await sb.from("dungeon_attempts").select("dungeon_id,date_jour").eq("user_id", u.id);
  const today = todayStr();
  return (dungeons || []).map((d) => {
    const questions = d.questions || [];
    const safeQuestions = questions.map((q) => ({ id: q.id, enonce: q.enonce, options: q.options, tempsLimite: q.tempsLimite }));
    const dejaFait = (attempts || []).some((a) => a.dungeon_id === d.id && a.date_jour === today);
    return { id: d.id, titre: d.titre, categorie: d.categorie, nbQuestions: questions.length, questions: safeQuestions, dejaFait };
  });
};

ACTIONS.submitDungeonAttempt = async (sb, payload, token) => {
  const u = await getUserOrFail(sb, token);
  const { data: d } = await sb.from("dungeons").select("*").eq("id", payload.dungeonId).maybeSingle();
  if (!d) fail("Ce défi n'existe plus.", "not_found");

  const questions = d.questions || [];
  let totalGain = 0;
  (payload.answers || []).forEach((ans) => {
    const q = questions.find((x) => x.id === ans.questionId);
    if (!q) return;
    const isCorrect = Number(ans.optionIndex) === Number(q.bonneReponseIndex);
    const r = NexiLogic.calculateDungeonReward(isCorrect, q.nx, (ans.tempsMs || 0) / 1000, q.tempsLimite, q.bonusVitesse);
    totalGain += r.gained;
  });

  // L'insertion porte la contrainte unique (user_id, dungeon_id, date_jour) :
  // une double tentative (double-clic, deux onglets) est rejetée par la base
  // elle-même, sans dépendre d'une lecture préalable qui pourrait être en retard.
  const { error: insErr } = await sb.from("dungeon_attempts").insert({ user_id: u.id, dungeon_id: d.id, date_jour: todayStr(), nx_gagne: totalGain });
  if (insErr) {
    if (insErr.code === "23505") fail("Tu as déjà relevé ce défi aujourd'hui.", "already_done");
    fail("Cette action n'a pas pu aboutir. Réessaie.", "error");
  }

  const newNx = await applyDelta(sb, u.id, totalGain);
  const bestScore = Math.max(u.best_score || 0, newNx);
  const history = (u.history || []).concat([{ date: todayStr(), nx: newNx }]).slice(-60);
  await sb.from("users").update({
    best_score: bestScore, history, nb_defis_completes: (u.nb_defis_completes || 0) + (totalGain > 0 ? 1 : 0),
  }).eq("id", u.id);

  return { nxGagne: totalGain, nouveauSolde: newNx };
};

ACTIONS.listNexifyCards = async (sb, payload, token) => {
  await getUserOrFail(sb, token);
  const { data } = await sb.from("nexify_cards").select("id,categorie,multiplicateur");
  return (data || []).map((c) => ({ id: c.id, categorie: c.categorie, multiplicateur: Number(c.multiplicateur) }));
};

ACTIONS.playNexifyCard = async (sb, payload, token) => {
  const u = await getUserOrFail(sb, token);
  const { data: c } = await sb.from("nexify_cards").select("*").eq("id", payload.cardId).maybeSingle();
  if (!c) fail("Cette carte n'est plus disponible.", "not_found");
  const bet = Number(payload.betNX) || 0;
  if (bet <= 0) fail("Mise invalide.", "bad_bet");
  const isCorrect = Number(payload.answerId) === Number(c.bonne_reponse_index);
  const result = NexiLogic.calculateNexifyResult(bet, Number(c.multiplicateur), isCorrect);
  const newNx = await playBet(sb, u.id, bet, result.delta);
  return { gagne: isCorrect, delta: result.delta, nouveauSolde: newNx, question: c.question, options: c.options };
};

ACTIONS.listRevisionCards = async (sb, payload, token) => {
  await getUserOrFail(sb, token);
  let q = sb.from("revision_cards").select("*");
  if (payload.category) q = q.eq("categorie", payload.category);
  const { data } = await q;
  return (data || []).map((r) => ({ id: r.id, categorie: r.categorie, recto: r.recto, reponse: r.reponse, explication: r.explication }));
};

ACTIONS.listFacts = async (sb, payload, token) => {
  await getUserOrFail(sb, token);
  const { data } = await sb.from("facts").select("*");
  return (data || []).map((f) => ({ id: f.id, texte: f.texte }));
};

ACTIONS.getLeaderboard = async (sb, payload, token) => {
  await getUserOrFail(sb, token);
  const { data } = await sb.from("users").select("identifiant,nx").order("nx", { ascending: false }).limit(100);
  return (data || []).map((u) => ({ identifiant: u.identifiant, nx: Number(u.nx) || 0 }));
};

/* ---------------------------------------------------------------
 * Actions — espace Administrateur
 * ------------------------------------------------------------- */
ACTIONS.adminLogin = async (sb, payload) => {
  const { data: a } = await sb.from("admin_config").select("*").eq("id", true).maybeSingle();
  if (!a || payload.identifiant !== a.identifiant) fail("Identifiant ou mot de passe incorrect.", "auth");
  if (hashPassword(payload.motDePasse, a.salt) !== a.password_hash) fail("Identifiant ou mot de passe incorrect.", "auth");
  const token = await createSession(sb, "admin", "admin");
  return { token, profileSummary: { identifiant: a.identifiant } };
};

ACTIONS.adminListNexians = async (sb, payload, token) => {
  await requireAdmin(sb, token);
  const { data } = await sb.from("users").select("*").order("created_at", { ascending: true });
  return (data || []).map((u) => ({
    id: u.id, identifiant: u.identifiant, nomComplet: u.nom_complet, nx: Number(u.nx) || 0, abonnement: u.abonnement,
    moyenPaiement: u.moyen_paiement || "", referencePaiement: u.reference_paiement || "", dateFinAbonnement: u.date_fin_abonnement || "",
    nbConnexions: u.nb_connexions || 0, derniereConnexion: u.derniere_connexion || "", nbDefisCompletes: u.nb_defis_completes || 0,
  }));
};

ACTIONS.adminCreateNexian = async (sb, payload, token) => {
  await requireAdmin(sb, token);
  if (!payload.identifiant || !payload.nomComplet || !payload.motDePasse) fail("Champs manquants.", "bad_request");
  const salt = genSalt();
  const { error } = await sb.from("users").insert({
    identifiant: payload.identifiant, nom_complet: payload.nomComplet,
    password_hash: hashPassword(payload.motDePasse, salt), salt,
    nx: Number(payload.nx) || STARTING_NX, avatar_id: "H", abonnement: "actif",
    moyen_paiement: payload.moyenPaiement || null, reference_paiement: payload.referencePaiement || null,
    date_fin_abonnement: payload.dateFinAbonnement || null,
  });
  if (error) {
    if (error.code === "23505") fail("Cet identifiant existe déjà.", "duplicate");
    fail("Cette action n'a pas pu aboutir. Réessaie.", "error");
  }
  return { ok: true };
};

ACTIONS.adminUpdateNexian = async (sb, payload, token) => {
  await requireAdmin(sb, token);
  const patch = {
    nom_complet: payload.nomComplet, identifiant: payload.identifiant, nx: Number(payload.nx),
    moyen_paiement: payload.moyenPaiement || null, reference_paiement: payload.referencePaiement || null,
    date_fin_abonnement: payload.dateFinAbonnement || null,
  };
  if (payload.motDePasse) {
    const salt = genSalt();
    patch.salt = salt;
    patch.password_hash = hashPassword(payload.motDePasse, salt);
  }
  const { error } = await sb.from("users").update(patch).eq("id", payload.id);
  if (error) {
    if (error.code === "23505") fail("Cet identifiant existe déjà.", "duplicate");
    fail("Cette action n'a pas pu aboutir. Réessaie.", "error");
  }
  return { ok: true };
};

ACTIONS.adminSetSubscription = async (sb, payload, token) => {
  await requireAdmin(sb, token);
  await sb.from("users").update({ abonnement: payload.statut }).eq("id", payload.nexianId);
  return { ok: true };
};

ACTIONS.adminGetStats = async (sb, payload, token) => {
  await requireAdmin(sb, token);
  const { data: users } = await sb.from("users").select("abonnement,nx,nb_defis_completes,derniere_connexion");
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  let joueursActifs = 0, totalNx = 0, connexions7j = 0, defisCompletes = 0;
  (users || []).forEach((u) => {
    if (u.abonnement === "actif") joueursActifs++;
    totalNx += Number(u.nx) || 0;
    defisCompletes += Number(u.nb_defis_completes) || 0;
    if (u.derniere_connexion && new Date(u.derniere_connexion) >= weekAgo) connexions7j++;
  });
  return { totalJoueurs: (users || []).length, joueursActifs, totalNx, connexions7j, defisCompletes };
};

/* --- Donjons --- */
ACTIONS.adminListDungeons = async (sb, payload, token) => {
  await requireAdmin(sb, token);
  const { data } = await sb.from("dungeons").select("*");
  return (data || []).map((d) => ({ id: d.id, titre: d.titre, categorie: d.categorie, publie: !!d.publie, questions: d.questions || [] }));
};

ACTIONS.adminSaveDungeon = async (sb, payload, token) => {
  await requireAdmin(sb, token);
  if (!payload.titre || !payload.questions || !payload.questions.length) fail("Titre et questions requis.", "bad_request");
  const questions = payload.questions.map((q, i) => ({
    id: q.id || ("q" + i + "_" + crypto.randomBytes(4).toString("hex")),
    enonce: q.enonce, options: q.options, bonneReponseIndex: Number(q.bonneReponseIndex) || 0,
    nx: Number(q.nx) || 10, tempsLimite: Number(q.tempsLimite) || 30, bonusVitesse: Number(q.bonusVitesse) || 0,
  }));
  if (payload.id) {
    await sb.from("dungeons").update({ titre: payload.titre, categorie: payload.categorie, questions }).eq("id", payload.id);
  } else {
    await sb.from("dungeons").insert({ titre: payload.titre, categorie: payload.categorie, publie: false, questions });
  }
  return { ok: true };
};

ACTIONS.adminPublishDungeon = async (sb, payload, token) => {
  await requireAdmin(sb, token);
  await sb.from("dungeons").update({ publie: !!payload.publie }).eq("id", payload.dungeonId);
  return { ok: true };
};

/* --- Nexify --- */
ACTIONS.adminListNexifyCards = async (sb, payload, token) => {
  await requireAdmin(sb, token);
  const { data } = await sb.from("nexify_cards").select("*");
  return (data || []).map((c) => ({
    id: c.id, categorie: c.categorie, question: c.question, options: c.options || [],
    bonneReponseIndex: c.bonne_reponse_index, multiplicateur: Number(c.multiplicateur),
  }));
};

ACTIONS.adminSaveNexifyCard = async (sb, payload, token) => {
  await requireAdmin(sb, token);
  if (!payload.question || !payload.options || !payload.options.length) fail("Question et options requises.", "bad_request");
  const data = {
    categorie: payload.categorie, question: payload.question, options: payload.options,
    bonne_reponse_index: Number(payload.bonneReponseIndex) || 0, multiplicateur: Number(payload.multiplicateur) || 2,
  };
  if (payload.id) await sb.from("nexify_cards").update(data).eq("id", payload.id);
  else await sb.from("nexify_cards").insert(data);
  return { ok: true };
};

/* --- Cartes de révision --- */
ACTIONS.adminListRevisionCards = async (sb, payload, token) => {
  await requireAdmin(sb, token);
  const { data } = await sb.from("revision_cards").select("*");
  return data || [];
};

ACTIONS.adminSaveRevisionCard = async (sb, payload, token) => {
  await requireAdmin(sb, token);
  if (!payload.recto || !payload.reponse) fail("Recto et réponse requis.", "bad_request");
  const data = { categorie: payload.categorie, recto: payload.recto, reponse: payload.reponse, explication: payload.explication || null };
  if (payload.id) await sb.from("revision_cards").update(data).eq("id", payload.id);
  else await sb.from("revision_cards").insert(data);
  return { ok: true };
};

ACTIONS.adminDeleteRevisionCard = async (sb, payload, token) => {
  await requireAdmin(sb, token);
  await sb.from("revision_cards").delete().eq("id", payload.id);
  return { ok: true };
};

ACTIONS.adminImportRevisionCards = async (sb, payload, token) => {
  await requireAdmin(sb, token);
  if (!payload.csvText || !payload.categorie) fail("Catégorie et contenu à importer requis.", "bad_request");
  const lines = payload.csvText.split("\n").map((l) => l.trim()).filter(Boolean);
  let added = 0, skipped = 0;
  const rows = [];
  lines.forEach((line) => {
    const parts = line.split(";").map((p) => p.trim());
    if (parts.length < 2 || !parts[0] || !parts[1]) { skipped++; return; }
    rows.push({ categorie: payload.categorie, recto: parts[0], reponse: parts[1], explication: parts[2] || null });
    added++;
  });
  if (rows.length) await sb.from("revision_cards").insert(rows);
  return { added, skipped };
};

/* --- Le saviez-vous --- */
ACTIONS.adminListFacts = async (sb, payload, token) => {
  await requireAdmin(sb, token);
  const { data } = await sb.from("facts").select("*");
  return data || [];
};

ACTIONS.adminSaveFact = async (sb, payload, token) => {
  await requireAdmin(sb, token);
  if (!payload.texte) fail("Texte requis.", "bad_request");
  if (payload.id) await sb.from("facts").update({ texte: payload.texte }).eq("id", payload.id);
  else await sb.from("facts").insert({ texte: payload.texte });
  return { ok: true };
};

ACTIONS.adminImportFacts = async (sb, payload, token) => {
  await requireAdmin(sb, token);
  if (!payload.csvText) fail("Contenu à importer requis.", "bad_request");
  const lines = payload.csvText.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length) await sb.from("facts").insert(lines.map((texte) => ({ texte })));
  return { added: lines.length };
};

/* --- Réglages --- */
ACTIONS.adminChangePassword = async (sb, payload, token) => {
  await requireAdmin(sb, token);
  const { data: a } = await sb.from("admin_config").select("*").eq("id", true).maybeSingle();
  if (!a || hashPassword(payload.ancien, a.salt) !== a.password_hash) fail("Ancien mot de passe incorrect.", "auth");
  const newSalt = genSalt();
  await sb.from("admin_config").update({ salt: newSalt, password_hash: hashPassword(payload.nouveau, newSalt) }).eq("id", true);
  return { ok: true };
};

/* ---------------------------------------------------------------
 * Point d'entrée HTTP (Vercel serverless — runtime Node.js)
 * ------------------------------------------------------------- */
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, code: "method", message: "Méthode non autorisée." });
    return;
  }
  const body = req.body || {};
  const action = body.action;
  const payload = body.payload || {};
  const token = body.token || null;

  const handler = ACTIONS[action];
  if (!handler) {
    res.status(200).json({ ok: false, code: "unknown_action", message: "Action inconnue." });
    return;
  }

  try {
    const sb = supabase();
    const data = await handler(sb, payload, token);
    res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error("Erreur action=" + action + " :", err);
    const friendly = (err && err.friendly && err.message) || "Cette action n'a pas pu aboutir. Réessaie.";
    res.status(200).json({ ok: false, code: (err && err.code) || "error", message: friendly });
  }
};

// Exposé uniquement pour test/proxy-actions.test.js (exécuté avec un faux
// client Supabase en mémoire). N'affecte pas l'exécution sur Vercel, qui
// appelle simplement module.exports(req, res) comme ci-dessus.
module.exports.ACTIONS = ACTIONS;
