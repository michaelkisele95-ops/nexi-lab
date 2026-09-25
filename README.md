# Nexi Lab — NEXI ACADEMY

PWA gamifiée pour accompagner des étudiants en **chimie et métallurgie** :
donjons de défis, cartes-paris "Nexify", cartes de révision, classement
général, et un panel administrateur complet — le tout synchronisé via
Supabase (Postgres gratuit), sans dépendance à un téléphone en particulier.

**v3** : backend Supabase (Postgres) remplaçant Google Sheets/Apps Script
pour corriger la lenteur — réponses en dizaines/centaines de ms au lieu de
1-5 secondes. Verrouillage anti-corruption des soldes NX (contraintes SQL
atomiques), suivi manuel des abonnements (moyen de paiement/référence),
import en masse de contenu, tableau de bord Stats, et correction du bug
Nexify (mise peu lisible / écran figé pendant le chargement).

## Démarrer ici

👉 **Ouvre `GUIDE_DEPLOIEMENT.md`** : c'est le guide pas-à-pas complet
(Supabase → Vercel → premiers réglages → checklist de test).

## Structure du projet

```
nexi-lab/
├── index.html              Connexion (joueur + admin), invite d'installation PWA
├── eleve.html               Panel joueur (profil, donjons, nexify, cartes, classement)
├── admin.html                Panel administrateur
├── manifest.json / service-worker.js   PWA installable, cache de l'habillage
├── css/style.css             Design system partagé
├── js/
│   ├── config.js              Configuration front (aucun secret)
│   ├── logic-core.js           Calculs NX — testé unitairement (voir test/)
│   ├── api.js                  Couche réseau (appelle /api/proxy uniquement)
│   ├── auth.js                 Session joueur/admin
│   ├── nexibot.js              Bulle d'orientation contextuelle
│   ├── eleve.js / admin.js     Logique des deux panels
├── api/proxy.js               Fonction serverless Vercel : TOUTE la logique
│                               métier (auth, donjons, Nexify, admin) sur Supabase
├── supabase/schema.sql        Schéma Postgres à coller dans Supabase (SQL Editor)
├── scripts/setup-admin.js     Script à exécuter une fois pour créer le compte admin
├── icons/                     Logo moléculaire + avatars (tuiles façon tableau périodique)
└── test/
    ├── logic-core.test.js      Tests unitaires purs (calculs NX)
    └── proxy-actions.test.js   Tests d'intégration du backend (faux client Supabase)
```

## Tester la logique localement

```bash
npm install
npm test
```

Ceci exécute deux suites : `logic-core.test.js` (calculs NX purs) et
`proxy-actions.test.js` (auth, donjons, Nexify, admin — contre un faux
client Supabase en mémoire, sans réseau). 25 scénarios au total.

## Sécurité — ce qui est fait

- Le navigateur ne parle jamais directement à Supabase : il passe par
  `/api/proxy` (fonction serverless), seul dépositaire de la clé
  `service_role` (variables d'environnement Vercel, jamais dans le code).
- Toutes les tables Supabase ont Row Level Security activée sans policy —
  accès refusé à quiconque hors de la clé de service, en ceinture-bretelles.
- Mots de passe hachés (SHA-256 + sel par utilisateur) — jamais en clair.
- Sessions par jeton opaque expirant après 12h, revalidées à chaque appel.
- Mutations de solde NX via des fonctions SQL atomiques (`apply_nx_delta`,
  `play_bet`) : deux requêtes simultanées ne peuvent pas corrompre un solde.
- Une tentative de donjon en double le même jour est rejetée par une
  contrainte d'unicité SQL, pas par une simple vérification applicative.
- Le vrai nom d'un Nexian n'est jamais exposé au classement — seul son
  identifiant l'est.
- Aucun message d'erreur technique n'est montré à un joueur : uniquement
  "connexion instable" ou un message métier clair écrit pour lui.

Voir `GUIDE_DEPLOIEMENT.md` pour la checklist de vérification complète.
