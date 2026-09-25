/**
 * NEXI LAB — config.js
 * Aucun secret ici : les identifiants Supabase (clé service_role) ne
 * vivent que côté serveur (variables d'environnement Vercel). Le front
 * appelle uniquement /api/proxy (fonction serverless Vercel), qui EST le
 * backend (auth, logique de jeu, accès Supabase) — il ne relaie vers
 * aucun service tiers exposé.
 * => Un F12 / onglet réseau du navigateur ne révèle que "/api/proxy".
 */
window.NEXI_CONFIG = Object.freeze({
  APP_NAME: "Nexi Lab",
  API_ENDPOINT: "/api/proxy",
  SESSION_KEY: "nexi_session_v1",
  SESSION_TTL_MS: 12 * 60 * 60 * 1000, // 12h glissantes
  ELEMENT_CATEGORIES: [
    // Chimie
    "Chimie générale", "Chimie analytique", "Chimie inorganique", "Chimie organique",
    "Chimie physique", "Chimie quantique", "Électrochimie", "Chimie industrielle",
    "Chimie de l'environnement", "Chimie des matériaux", "Chimie de surface et catalyse",
    "Chimie nucléaire",
    // Métallurgie
    "Métallurgie physique", "Hydrométallurgie", "Pyrométallurgie", "Électrométallurgie",
    "Sidérurgie", "Fonderie et solidification", "Traitements thermiques",
    "Mise en forme des métaux", "Corrosion et protection des métaux", "Recyclage des métaux"
  ]
});
