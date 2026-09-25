/**
 * Tests d'intégration légers pour api/proxy.js : appelle directement les
 * fonctions ACTIONS avec un faux client Supabase en mémoire (voir
 * test/fake-supabase.js). Ne remplace pas un test contre une vraie base
 * Supabase (voir la checklist manuelle de GUIDE_DEPLOIEMENT.md), mais
 * valide que la logique métier (auth, calcul NX, contraintes d'unicité,
 * mise Nexify) se comporte correctement.
 *
 * Exécuter : npm test (voir package.json)
 */
const assert = require("assert");

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://fake.local";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "fake-key";

const { createFakeSupabase } = require("./fake-supabase.js");
const { ACTIONS } = require("../api/proxy.js");

let passed = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log("  OK  " + name);
    passed++;
  } catch (e) {
    console.error("FAIL  " + name + " -> " + e.message);
    process.exitCode = 1;
  }
}

function seedBasic() {
  return createFakeSupabase({
    users: [
      { id: "u1", identifiant: "eleve1", nom_complet: "Test Eleve", password_hash: require("crypto").createHash("sha256").update("secret:sel1").digest("hex"), salt: "sel1", nx: 100, avatar_id: "H", abonnement: "actif", best_score: 0, history: [], nb_connexions: 0, nb_defis_completes: 0 },
    ],
    admin_config: [{ id: true, identifiant: "admin", password_hash: require("crypto").createHash("sha256").update("adminpass:seladmin").digest("hex"), salt: "seladmin" }],
    dungeons: [{ id: "d1", titre: "Acides et bases", categorie: "Chimie analytique", publie: true, questions: [{ id: "q1", enonce: "pH < 7 ?", options: ["Acide", "Base"], bonneReponseIndex: 0, nx: 20, tempsLimite: 30, bonusVitesse: 10 }] }],
    nexify_cards: [{ id: "c1", categorie: "Chimie organique", question: "Alcane le plus simple ?", options: ["Méthane", "Éthène"], bonne_reponse_index: 0, multiplicateur: 2 }],
    sessions: [],
  });
}

(async () => {
  console.log("== Authentification joueur ==");
  await t("login réussi avec bon mot de passe", async () => {
    const sb = seedBasic();
    const res = await ACTIONS.login(sb, { identifiant: "eleve1", motDePasse: "secret" });
    assert.ok(res.token);
    assert.strictEqual(res.profileSummary.nx, 100);
  });
  await t("login refusé avec mauvais mot de passe", async () => {
    const sb = seedBasic();
    await assert.rejects(() => ACTIONS.login(sb, { identifiant: "eleve1", motDePasse: "faux" }), /incorrect/);
  });
  await t("login refusé si abonnement suspendu", async () => {
    const sb = seedBasic();
    sb._db.users[0].abonnement = "suspendu";
    await assert.rejects(() => ACTIONS.login(sb, { identifiant: "eleve1", motDePasse: "secret" }), /suspendu/);
  });

  console.log("== Donjons ==");
  await t("réponse correcte crédite les NX attendus", async () => {
    const sb = seedBasic();
    const login = await ACTIONS.login(sb, { identifiant: "eleve1", motDePasse: "secret" });
    const res = await ACTIONS.submitDungeonAttempt(sb, { dungeonId: "d1", answers: [{ questionId: "q1", optionIndex: 0, tempsMs: 2000 }] }, login.token);
    assert.ok(res.nxGagne >= 20, "gain attendu >= 20, obtenu " + res.nxGagne);
    assert.strictEqual(sb._db.users[0].nx, 100 + res.nxGagne);
  });
  await t("un deuxième essai le même jour est refusé (contrainte d'unicité)", async () => {
    const sb = seedBasic();
    const login = await ACTIONS.login(sb, { identifiant: "eleve1", motDePasse: "secret" });
    await ACTIONS.submitDungeonAttempt(sb, { dungeonId: "d1", answers: [{ questionId: "q1", optionIndex: 0, tempsMs: 2000 }] }, login.token);
    await assert.rejects(() => ACTIONS.submitDungeonAttempt(sb, { dungeonId: "d1", answers: [{ questionId: "q1", optionIndex: 0, tempsMs: 2000 }] }, login.token), /déjà relevé/);
  });

  console.log("== Nexify ==");
  await t("bonne réponse : le solde augmente exactement de mise×(multiplicateur-1)", async () => {
    const sb = seedBasic();
    const login = await ACTIONS.login(sb, { identifiant: "eleve1", motDePasse: "secret" });
    const res = await ACTIONS.playNexifyCard(sb, { cardId: "c1", betNX: 40, answerId: 0 }, login.token);
    assert.strictEqual(res.gagne, true);
    assert.strictEqual(res.delta, 40);
    assert.strictEqual(sb._db.users[0].nx, 140);
  });
  await t("mauvaise réponse : le solde perd exactement la mise", async () => {
    const sb = seedBasic();
    const login = await ACTIONS.login(sb, { identifiant: "eleve1", motDePasse: "secret" });
    const res = await ACTIONS.playNexifyCard(sb, { cardId: "c1", betNX: 30, answerId: 1 }, login.token);
    assert.strictEqual(res.gagne, false);
    assert.strictEqual(res.delta, -30);
    assert.strictEqual(sb._db.users[0].nx, 70);
  });
  await t("mise supérieure au solde -> refusée sans toucher au solde", async () => {
    const sb = seedBasic();
    const login = await ACTIONS.login(sb, { identifiant: "eleve1", motDePasse: "secret" });
    await assert.rejects(() => ACTIONS.playNexifyCard(sb, { cardId: "c1", betNX: 9999, answerId: 0 }, login.token), /Mise invalide/);
    assert.strictEqual(sb._db.users[0].nx, 100);
  });

  console.log("== Administration ==");
  await t("adminLogin réussi puis création d'un Nexian", async () => {
    const sb = seedBasic();
    const login = await ACTIONS.adminLogin(sb, { identifiant: "admin", motDePasse: "adminpass" });
    await ACTIONS.adminCreateNexian(sb, { identifiant: "nouveau1", nomComplet: "Nouveau Joueur", motDePasse: "x" }, login.token);
    assert.ok(sb._db.users.some((u) => u.identifiant === "nouveau1"));
  });
  await t("identifiant déjà pris -> refusé", async () => {
    const sb = seedBasic();
    const login = await ACTIONS.adminLogin(sb, { identifiant: "admin", motDePasse: "adminpass" });
    await assert.rejects(() => ACTIONS.adminCreateNexian(sb, { identifiant: "eleve1", nomComplet: "Doublon", motDePasse: "x" }, login.token), /existe déjà/);
  });
  await t("un joueur ne peut pas appeler une action admin", async () => {
    const sb = seedBasic();
    const login = await ACTIONS.login(sb, { identifiant: "eleve1", motDePasse: "secret" });
    await assert.rejects(() => ACTIONS.adminListNexians(sb, {}, login.token), /Accès refusé/);
  });

  console.log(`\n${passed} test(s) réussi(s).`);
})();
