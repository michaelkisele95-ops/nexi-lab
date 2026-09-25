# Guide de déploiement — Nexi Lab

Ce guide t'emmène de zéro jusqu'à une application en ligne, sécurisée et
**rapide**, avec un backend Postgres (Supabase) synchronisé sur tous les
appareils.

Trois étapes : **① Supabase → ② Vercel → ③ premiers réglages**

> **Changement important (v3) :** le backend n'utilise plus Google
> Sheets/Apps Script — remplacé par Supabase (Postgres gratuit) pour
> corriger la lenteur qui rendait l'app peu agréable à utiliser. La
> structure, l'interface et les fonctionnalités restent identiques ; seule
> la "tuyauterie" en dessous a changé. Bénéfice concret : un appel qui
> prenait 1 à 5 secondes via Apps Script en prend maintenant quelques
> dizaines à centaines de millisecondes. Bonus : plus besoin de répartir
> les joueurs sur plusieurs feuilles ("shards") — une seule base encaisse
> sans problème des dizaines de milliers de comptes.

---

## ⚠️ Ce qui a été testé, et ce qui ne pouvait pas l'être ici

- ✅ **Testé et validé automatiquement** : toute la logique de jeu (calcul
  des NX de donjon, résultat des cartes Nexify, garde-fou de solde,
  niveaux) — `test/logic-core.test.js`.
- ✅ **Testé et validé automatiquement** : la logique complète du serveur
  (`api/proxy.js`) contre un faux client Supabase en mémoire — connexion
  réussie/refusée, abonnement suspendu, calcul des gains de donjon,
  **double tentative le même jour rejetée par la contrainte d'unicité**,
  mise Nexify gagnante/perdante, **mise supérieure au solde refusée sans
  toucher au solde**, création de Nexian, identifiant en double refusé,
  qu'un joueur ne puisse pas appeler une action réservée à l'admin — voir
  `test/proxy-actions.test.js`. 11 scénarios, tous verts.
- ✅ **Vérifié** : syntaxe JavaScript de tous les fichiers.
- ❌ **Non testable depuis cet environnement** : l'exécution réelle contre
  ton propre projet Supabase et ton déploiement Vercel, car cela nécessite
  tes propres identifiants et un accès réseau que cet environnement de
  développement n'a pas. La section **Checklist de test** en bas de ce
  guide te permet de le vérifier toi-même, en 10-15 minutes.

Lancer les tests toi-même (après `npm install`, voir ② ci-dessous) :
```bash
npm test
```

---

## ① Supabase (le backend Postgres, gratuit)

1. Va sur [supabase.com](https://supabase.com) → **Start your project** →
   connecte-toi (GitHub ou email) → **New project**.
   - Choisis un nom (ex. "nexi-lab"), un mot de passe de base de données
     (garde-le de côté, tu n'en auras pas besoin au quotidien), et la
     région disponible la plus proche de tes joueurs.
   - Patiente ~2 minutes pendant la création du projet.
2. Dans le menu de gauche, ouvre **SQL Editor → New query**. Colle
   **tout** le contenu du fichier `supabase/schema.sql` fourni dans ce
   projet, puis clique **Run**. Ça crée toutes les tables, les contraintes
   anti-doublon, et les fonctions de calcul atomique des soldes NX.
3. Toujours dans le menu de gauche : **Project Settings → API**. Note deux
   valeurs :
   - **Project URL** → ce sera `SUPABASE_URL`.
   - **service_role** (clé secrète, PAS la clé "anon" !) → ce sera
     `SUPABASE_SERVICE_ROLE_KEY`. Ne la partage jamais publiquement, ne la
     mets jamais dans le code du front — elle vit uniquement dans les
     variables d'environnement Vercel (étape ②).

### Créer le compte administrateur

Ce script s'exécute une seule fois, en local, depuis VS Code :

```bash
cd nexi-lab
npm install
cp .env.example .env
# édite .env : colle tes SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY
npm run setup:admin -- admin "TonMotDePasseSolide123!"
```

Remplace `admin` et le mot de passe par ce que tu veux. Tu pourras
toujours changer le mot de passe plus tard depuis le panel admin
(**Réglages**).

---

## ② Déploiement sur Vercel

1. Sur [vercel.com](https://vercel.com), crée un compte (gratuit) si tu
   n'en as pas, puis **Add New → Project**.
2. Importe ce dossier `nexi-lab` (pousse-le d'abord sur un dépôt GitHub,
   ou utilise `vercel` en ligne de commande depuis VS Code).
3. Avant le premier déploiement, va dans **Settings → Environment
   Variables** et ajoute :
   | Nom | Valeur |
   |---|---|
   | `SUPABASE_URL` | copiée à l'étape ①.3 |
   | `SUPABASE_SERVICE_ROLE_KEY` | copiée à l'étape ①.3 |
4. Lance le déploiement. Vercel te donne une URL du type
   `https://nexi-lab.vercel.app`.
5. Ouvre cette URL sur ton téléphone : après quelques secondes, une
   bannière **"Installer Nexi Lab"** doit apparaître (Android/desktop
   Chrome). Sur iPhone (Safari), l'installation se fait via
   **Partager → Sur l'écran d'accueil** (Apple ne propose pas de bannière
   automatique, c'est une limite d'iOS et non de l'application).

---

## ③ Premiers réglages

### Accès administrateur (caché, aucun lien visible)

L'écran de connexion ne comporte aucun bouton "Accès administrateur" :

- **Tapote 5 fois rapidement sur le logo** (le cercle moléculaire) en
  moins de 1,5 seconde. Le sous-titre passe en doré : le formulaire
  attend maintenant tes identifiants admin. Retape 5 fois pour repasser
  en mode joueur normal.
- **Ou** ouvre directement `https://ton-app.vercel.app/index.html?admin=1`.

1. Connecte-toi avec l'identifiant/mot de passe créés à l'étape ①.
2. Onglet **Nexians** : crée tes premiers comptes joueurs (identifiant +
   mot de passe que tu communiques toi-même à chacun). Renseigne le moyen
   de paiement et la référence de transaction si le joueur a déjà payé —
   ce suivi est manuel (pas d'intégration Mobile Money automatique pour
   l'instant, voir "Limites connues" plus bas).
3. Onglet **Donjons** : crée un premier défi (au moins une question),
   puis clique **Publier** pour le rendre visible aux joueurs.
4. Onglet **Nexify** et **Cartes** : ajoute quelques cartes pour tester —
   ou utilise **"Importer en masse"** pour coller plusieurs cartes ou faits
   d'un coup (une ligne par carte, `recto;réponse;explication`).
5. Onglet **Faits** : ajoute 2-3 entrées "Le saviez-vous" (import en masse
   disponible aussi, une ligne = un fait).
6. Onglet **Stats** : à revisiter régulièrement — c'est ton tableau de
   bord de traction (joueurs actifs, connexions 7 jours, défis complétés,
   NX en circulation) pour un dossier de concours ou d'investissement.

---

## ✅ Checklist de test de bout en bout (à faire une fois, ~10-15 min)

- [ ] Connexion admin fonctionne, changement de mot de passe pris en compte
- [ ] Création d'un Nexian → connexion avec son identifiant/mot de passe,
      quasi instantanée (c'est le changement principal par rapport à
      l'ancienne version)
- [ ] Le Nexian démarre bien à 100 NX (ou la valeur définie)
- [ ] Choix d'un avatar → persiste après rafraîchissement de la page
- [ ] Un donjon publié apparaît côté joueur ; non publié, il reste invisible
- [ ] Répondre correctement à un donjon crédite les NX attendus ; le
      refaire le même jour est bloqué ("déjà relevé aujourd'hui")
- [ ] **Nexify** : cliquer "Miser & Jouer" affiche immédiatement l'écran de
      mise (plus d'attente silencieuse) ; le champ de mise est net et
      lisible, les boutons 25%/50%/Tout miser fonctionnent ; bonne réponse
      multiplie le solde, mauvaise réponse fait perdre exactement la mise
- [ ] Le classement général affiche l'identifiant, jamais le nom réel
- [ ] Suspendre l'abonnement d'un Nexian → sa connexion est refusée avec un
      message clair, sans jargon technique
- [ ] Couper le Wi-Fi puis rouvrir l'app → message "connexion instable",
      jamais d'erreur technique brute
- [ ] F12 → onglet Réseau : seule une requête vers `/api/proxy` apparaît,
      jamais l'URL ni la clé Supabase
- [ ] Sur mobile, la bannière/le menu d'installation PWA fonctionne
- [ ] Deux clics rapides sur "Jouer" un même donjon (double-tap accidentel)
      ne créditent les NX qu'une seule fois
- [ ] L'import en masse d'une liste de cartes de révision (3-4 lignes)
      crée bien les cartes correspondantes, catégorie correcte
- [ ] L'onglet **Stats** affiche des nombres cohérents avec les tests
      effectués

Si une étape échoue, regarde d'abord Supabase → **Logs → API logs** (menu
de gauche) et Vercel → ton projet → **Deployments → Functions logs** : les
erreurs y sont journalisées en détail, même si le joueur ne les voit jamais.

---

## Limites connues à améliorer ensuite

- **Paiement encore manuel** : les champs moyen de paiement / référence /
  date de fin d'abonnement sont saisis à la main par l'admin après
  réception d'un paiement Mobile Money (Orange Money, Airtel Money...).
  Aucune intégration automatique n'est branchée — cela nécessite un compte
  marchand et des identifiants API que je n'ai pas et que toi seul peux
  souscrire.
- **Un seul compte administrateur** est géré (conforme au besoin exprimé :
  "moi, l'administrateur"). Pour que ton équipe ait des accès distincts,
  il faudrait ajouter une table `admins` dédiée — dis-moi si tu veux que
  je l'ajoute.
- **Palier gratuit Supabase** : un projet gratuit est automatiquement mis
  en pause après **1 semaine sans aucune requête** (restauration manuelle
  possible depuis le tableau de bord Supabase, données conservées). Pas un
  problème le temps du pilote avec des joueurs actifs régulièrement ; si
  l'app doit rester injoignable plus d'une semaine (ex. vacances scolaires
  longues), prévoir soit une visite manuelle, soit un passage au palier
  payant (~25$/mois) qui supprime cette pause.
- Les icônes sont fournies en SVG (fonctionnent sur Android/desktop). Pour
  une icône parfaite sur iOS, convertis `icons/logo-nexilab.svg` en PNG
  192×192 et 512×512 (par ex. via [cloudconvert.com](https://cloudconvert.com)
  ou `npx pwa-asset-generator`) et mets à jour `manifest.json` +
  `apple-touch-icon` dans `index.html`.
- Le mode hors-ligne ne met en cache que l'habillage de l'app (HTML/CSS/JS) :
  toute donnée de jeu nécessite une connexion, par choix, pour éviter des
  scores désynchronisés entre appareils.
