# Spécification — Timeline perso

Application personnelle, mobile, qui agrège des actus et des vidéos dans une timeline façon X/Twitter, triée par un algorithme simple basé sur des sujets.

Projet perso : un seul utilisateur, aucun coût, tout est livré en une fois (pas de découpage en versions).

---

## 1. Principes

- **Usage** : uniquement sur téléphone, en lecture. Pas de publication, de like, de commentaire ni de compte utilisateur.
- **Coût** : 0 €. Pas de LLM, pas d'API payante, pas de serveur payant.
- **Pas de garde-fous agressifs** : aucun filtrage de contenu, aucun badge d'avertissement, aucun seuil d'engagement. Tout ce qui vient des sources est affiché et simplement classé par l'algorithme.
- **Configuration par fichier** : sources, mots-clés et poids sont modifiables dans `config/` (pas d'écran de réglages).

## 2. Interface

### 2.1 Format
- Web app installable (PWA) : ajout à l'écran d'accueil depuis Safari ou Chrome, icône, plein écran, fonctionne hors ligne avec le dernier contenu chargé.
- Thème sombre par défaut, typographie et cartes inspirées de X.

### 2.2 Navigation
Barre d'onglets en bas, deux onglets :

| Onglet | Contenu |
|---|---|
| 📰 **Actus** | Articles des médias (RSS) + posts Bluesky des personnalités |
| 💻 **Tech** | Actus tech, dev et IA (Anthropic, Claude, OpenAI, labs, presse tech reconnue) |
| 🎥 **Vidéos** | Vidéos d'internautes (recherche Bluesky par hashtags) + chaînes YouTube + vidéos postées par les comptes suivis + Zawa Prod et ses membres |

### 2.3 Feed Actus
- Défilement infini, tirer vers le bas pour rafraîchir.
- **Carte article** : avatar et nom du média, temps relatif (« il y a 12 min »), titre, 1 à 2 lignes de chapô, image si disponible. Un tap ouvre l'article sur le site d'origine.
- **Carte post Bluesky** : avatar, nom, @handle, temps relatif, texte, images, lien vers le post. Un tap ouvre le post sur bsky.app.
- **Carte groupée (doublons)** : « 📰 N médias en parlent ». Titre principal + logos des médias. Un tap déplie la liste des articles.
- **Bouton « moins de ça »** (menu ⋯ sur chaque carte) : voir §4.4.

### 2.4 Feed Vidéos
- Plein écran, défilement vertical une vidéo à la fois (façon Reels/TikTok).
- Lecture automatique, muette par défaut, tap pour activer le son.
- Superposition : avatar, nom du compte, icône 🎥 de la plateforme d'origine, texte du post ou titre, temps relatif.
- Vidéos Bluesky : lues directement (flux HLS). Vidéos YouTube : lecteur YouTube intégré (embed).
- Bouton « moins de ça » également disponible.

### 2.5 Suivre et découvrir
- **Menu ⋯ d'un post :** « Suivre » ou « Ne plus suivre » le compte. Les cartes de ce compte disparaissent aussitôt du feed.
- **Onglet 🔍 Découvrir :**
  - recherche de comptes, dans les sources et dans tout Bluesky via l'API publique ;
  - suggestions par catégorie, venant des sources `suggested` de la config, que la collecte récupère sans les afficher tant qu'elles ne sont pas suivies ;
  - liste des abonnements, avec un bouton pour ne plus suivre.
- **Stockage :** les abonnements sont enregistrés sur le téléphone. Un compte Bluesky trouvé par la recherche est récupéré directement par l'app, sans passer par GitHub.
- **Exception :** les vidéos d'internautes trouvées par hashtag restent toujours visibles.

### 2.6 Pages de profil
- **Ouverture :** on touche l'avatar ou le nom d'un post, l'auteur d'une vidéo, ou un compte dans Découvrir.
- **Contenu :**
  - bannière (Bluesky), avatar, nom, handle, bio et lien du site ;
  - bouton **Suivre / Abonné** ;
  - posts dans l'ordre **chronologique**, sans compteurs ni éléments sociaux.
- **Source des posts :** les données collectées, et pour Bluesky la timeline complète récupérée en direct par l'API publique.
- **Retour :** bouton ← ou geste retour du téléphone, qui ramène au feed à la même position.

### 2.7 Fraîcheur et repères
- **Sous-titre de la barre du haut :** « à jour il y a 12 min » (en orange au-delà de 2 h), « hors ligne » le cas échéant, et « N sources indisponibles » : un tap liste les sources en panne (nom, type, erreur) d'après `status.json`.
- **Retour au premier plan :** après plus de 10 min d'absence, l'app revérifie les données en arrière-plan. S'il y a du nouveau, une pastille « Nouveaux posts ↑ » apparaît en haut du fil ; au tap, le fil est rechargé et remonte. Le fil affiché n'est jamais remplacé sans ce geste.
- **Fin de liste :** « Tu es à jour » en bas d'Actus et de Tech ; « Tu as tout vu » (avec « Rafraîchir ») après la dernière vidéo.
- **Articles ouverts :** le titre d'un article déjà ouvert est atténué (mémorisé sur le téléphone 30 jours, 500 articles au plus).
- **États vides :** chacun propose une action : « Rafraîchir », ou « Découvrir des comptes » quand plus aucun compte n'est suivi.
- **Rafraîchir Vidéos :** retoucher l'onglet actif quand on est déjà en haut rafraîchit (comme le tirer-pour-rafraîchir d'Actus et Tech, qui ne s'applique pas au défilement plein écran).

## 3. Sources

Toutes les sources sont déclarées dans `config/sources.json`. Les identifiants exacts (URL de flux RSS, handles Bluesky, ID de chaînes YouTube) sont vérifiés au moment du développement. Une source introuvable est retirée et signalée.

### 3.1 Médias (RSS) → Actus
Mediapart, La France insoumise (site officiel), Le Média, Blast, Politis, Regards, Reporterre, Basta!, Rapports de Force, StreetPress, Le Monde diplomatique, Frustration Magazine, Arrêt sur images.

Mediapart est payant : le flux ne fournit que le titre et le chapô. Le clic ouvre le site, où l'abonnement éventuel s'applique.

### 3.2 Bluesky — personnalités → Actus
- **LFI** : Jean-Luc Mélenchon, Mathilde Panot, Manuel Bompard, Clémence Guetté, Éric Coquerel, Manon Aubry, Louis Boyard, Rima Hassan, Antoine Léaument, Thomas Portes.
- **Journalistes** : David Dufresne, Rémy Buisine, Clément Lanot.
- Les posts de ces comptes qui contiennent une vidéo vont **aussi** dans le feed Vidéos.

### 3.3 Vidéos d'internautes (recherche Bluesky) → Vidéos
Recherche des posts contenant une vidéo pour les hashtags : `#manif` `#manifestation` `#greve` `#grève` `#violencespolicieres` `#blocage` `#retraites` `#mobilisation`. La liste est extensible dans la config.

### 3.4 YouTube (RSS des chaînes) → Vidéos
- **Terrain et médias** : Taranis News, Line Press, Le Média, Blast, Mediapart.
- **Zawa Prod et ses membres** : Zawa Prod, Zawa Prod - Replay & Live, DANYetRAZ, Wissam Xelka, Ilies (iliesomg), Mouffette (MouffetteVOD).

### 3.5 TikTok (secours) → Vidéos
Comptes TikTok @zawaprod et @valadista via un flux RSSHub. Ce flux est fragile : en cas d'échec, il est ignoré sans bloquer le reste.

### 3.6 Tech (RSS) → onglet Tech
- **Anthropic et Claude** : news, Claude blog, Research, Engineering. Anthropic ne publie pas de RSS officiel, on passe par les flux générés par le projet open source Olshansk/rss-feeds.
- **Labs IA** : OpenAI, Google DeepMind, Hugging Face.
- **Dev** : GitHub Blog, Simon Willison.
- **Presse tech reconnue** : The Verge (IA), Ars Technica, MIT Technology Review (IA), Next (FR).
- **Hacker News** : seulement le flux « best ».

Sujets propres à l'onglet Tech : **IA** et **Dev**.

### 3.7 Exclus
- X et Instagram : pas d'accès gratuit, ignorés.
- Syndicats et associations : retirés à la demande.
- Twitch : pas d'intégration (pas de bandeau « en live »).

## 4. Algorithme

Il n'utilise aucun LLM. Le calcul est déterministe, et une partie est faite côté client pour appliquer les préférences locales.

### 4.1 Sujets
Deux sujets, chacun défini par un dictionnaire de mots-clés pondérés dans `config/topics.json` :
- **Politique** : Assemblée, gouvernement, ministre, 49.3, loi, élection, Macron, Sénat, député, motion de censure, budget, etc.
- **Social** : grève, manif, syndicat, retraites, salaire, licenciement, logement, hôpital, services publics, chômage, précarité, etc.

La correspondance est insensible à la casse et aux accents, sur le titre, le chapô et le texte du post.

### 4.2 Score et ordre « pour toi »
```
score = √(1 + score_sujet) × poids_source × fraîcheur × engagement × déjà_vu × nouveau
fraîcheur  = 0.5 ^ (âge_en_heures / demi_vie)
engagement = 1 + 0.25 × log10(1 + likes + 2 × reposts)   (posts Bluesky)
déjà_vu    = 0.2 ^ (nombre de sessions où le post a été affiché, max 3)
nouveau    = 1.5 si publié depuis la dernière visite, sinon 1
```
- `score_sujet` est la somme des poids des mots-clés trouvés, plafonnée.
- La demi-vie est configurable : par défaut 10 h pour Actus et 24 h pour Vidéos.
- `poids_source` vaut 1 par défaut et se règle dans la config.
- **L'ordre n'est pas chronologique.** Comme sur X, la timeline est tirée au sort en fonction du score à chaque ouverture et à chaque refresh : un post bien noté sort souvent en haut, mais l'ordre change à chaque fois. Les posts déjà vus redescendent, et le même compte n'apparaît pas deux fois de suite si on peut l'éviter.

### 4.3 Regroupement des doublons (Actus)
Deux articles de médias différents sont regroupés quand :
- leurs titres sont suffisamment similaires (similarité de Jaccard sur les mots significatifs, au-dessus d'un seuil configurable),
- et ils ont été publiés à moins de 12 h d'écart.

Le groupe prend le meilleur score de ses membres.

### 4.4 « Moins de ça »
- Il divise le poids local de la source de la carte et des mots-clés qu'elle contient. Les poids ont un plancher, pour ne jamais faire disparaître complètement un contenu.
- Les réglages sont enregistrés dans le stockage local du téléphone.
- Un lien en bas du feed permet de tout réinitialiser.

## 5. Architecture technique

```
GitHub Actions (cron toutes les 20 min)
  └─ script de collecte (Node.js)
       ├─ RSS médias + YouTube + RSSHub
       ├─ API publique Bluesky (posts des comptes + recherche hashtags)
       ├─ normalisation, score de base, regroupement
       └─ écrit public/data/actus.json et public/data/videos.json
GitHub Pages
  └─ PWA statique (HTML/CSS/JS) qui lit les JSON
       └─ applique les ajustements locaux, trie et affiche
```

- **Collecte** : Node.js. Les données de la fenêtre glissante (48 à 72 h) sont conservées et les anciens éléments purgés.
- **Front** : PWA statique, avec un service worker pour le hors ligne et un manifeste pour l'installation.
- **Hébergement** : GitHub Pages, et collecte par GitHub Actions. Les deux sont gratuits.
- **Aucune clé d'API payante.** Seule option : un compte Bluesky gratuit avec un mot de passe d'application, si la recherche par hashtags est refusée sans connexion.

## 6. Hors scope

Likes, commentaires, publication, multi-utilisateur, notifications, écran de réglages, LLM, garde-fous de contenu, X, Instagram, Twitch, syndicats et associations.

## 7. Critères d'acceptation

1. L'app s'installe sur l'écran d'accueil d'un téléphone et s'ouvre en plein écran.
2. L'onglet Actus affiche des articles et des posts Bluesky récents, triés par score, avec les doublons regroupés.
3. L'onglet Vidéos affiche des vidéos lisibles en plein écran, en défilement vertical.
4. « Moins de ça » modifie visiblement l'ordre du feed, et ce réglage persiste après un rechargement.
5. Les données se mettent à jour automatiquement sans intervention.
6. La panne d'une source n'empêche pas les autres d'être affichées.
7. Coût total : 0 €.
