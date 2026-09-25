/**
 * NEXI LAB — scripts/setup-admin.js
 * À exécuter UNE FOIS en local, après avoir collé supabase/schema.sql,
 * pour créer (ou réinitialiser) le compte administrateur.
 *
 * Utilisation :
 *   1) npm install
 *   2) Crée un fichier .env (copie de .env.example) avec tes vraies valeurs
 *      SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY
 *   3) node scripts/setup-admin.js identifiant motdepasse
 *
 * Exemple : node scripts/setup-admin.js admin "MonMotDePasse123!"
 */
require("dotenv").config();
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const [, , identifiant, motDePasse] = process.argv;

if (!identifiant || !motDePasse) {
  console.error("Usage : node scripts/setup-admin.js <identifiant> <mot_de_passe>");
  process.exit(1);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définis (fichier .env).");
  process.exit(1);
}

function hashPassword(password, salt) {
  return crypto.createHash("sha256").update(password + ":" + salt).digest("hex");
}

async function main() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(motDePasse, salt);

  const { error } = await sb
    .from("admin_config")
    .upsert({ id: true, identifiant, password_hash: passwordHash, salt }, { onConflict: "id" });

  if (error) {
    console.error("Échec de la configuration de l'admin :", error.message);
    process.exit(1);
  }
  console.log(`Compte administrateur prêt : identifiant="${identifiant}".`);
  console.log("Connecte-toi via le geste caché (5 tapotements sur le logo) ou /index.html?admin=1.");
}

main();
