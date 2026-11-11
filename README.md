# Timeline perso

Une app perso pour téléphone, avec une timeline façon X/Twitter. Elle a deux onglets :

- **📰 Actus** : les articles des médias (RSS) et les posts Bluesky de personnalités, triés par sujets (politique, social) et par fraîcheur. Quand plusieurs médias parlent du même sujet, ils sont regroupés en « N médias en parlent ».
- **💻 Tech** : actus tech, dev et IA (Anthropic, Claude, OpenAI, DeepMind, Hugging Face, GitHub, The Verge, Ars Technica, MIT Tech Review, Next, Hacker News).
- **🎥 Vidéos** : un feed vertical plein écran, avec les vidéos Bluesky (#manif, #grève…), YouTube (chaînes de terrain, Zawa Prod et ses membres) et TikTok (Zawa Prod).

Le projet est gratuit : pas de serveur, pas de LLM, pas d'API payante. Le détail est dans la [spécification](docs/SPEC.md).

### Suivre, ne plus suivre, découvrir

- **Menu ⋯ d'un post :** « Ne plus suivre » retire ce compte de tes feeds, et « Suivre » le remet.
- **Onglet 🔍 Découvrir :**
  - une recherche de comptes, dans tes sources et dans tout Bluesky ;
  - des suggestions par catégorie (médias, personnalités, tech, YouTube) ;
  - la liste de tes abonnements.

Tes abonnements sont enregistrés sur ton téléphone.

**Pages de profil :** touche l'avatar ou le nom d'un post, d'une vidéo ou d'un compte dans Découvrir. La page affiche la bannière, la bio, le lien du site, un bouton Suivre / Abonné et les posts dans l'ordre chronologique, sans compteurs. Pour un compte Bluesky, les posts sont récupérés en direct. Le geste retour du téléphone ramène où tu étais.

- **Suggestions :** ce sont les sources marquées `"suggested": true` dans `config/sources.json`. Elles sont collectées, mais n'apparaissent dans tes feeds qu'une fois suivies.
- **Comptes Bluesky trouvés par la recherche :** l'app récupère leurs posts directement à chaque ouverture ou refresh.

## Mise en ligne (une seule fois)

1. **Fusionner la branche dans `main`.** Les tâches planifiées de GitHub ne tournent que sur la branche par défaut.
2. Sur GitHub, aller dans **Settings → Pages → Build and deployment → Source** et choisir **GitHub Actions**.
3. Aller dans **Actions → « Collecte et déploiement » → Run workflow** pour lancer une première collecte.
4. Ouvrir l'URL affichée à la fin du workflow (`https://<utilisateur>.github.io/<repo>/`) sur le téléphone, puis l'ajouter à l'écran d'accueil :
   - **iPhone (Safari)** : bouton Partager → « Sur l'écran d'accueil »
   - **Android (Chrome)** : menu ⋮ → « Ajouter à l'écran d'accueil »

Les données se mettent ensuite à jour toutes les 20 minutes, sans rien faire.

### Optionnel : recherche Bluesky par hashtags

Il arrive que l'API publique de Bluesky refuse la recherche sans connexion. Dans ce cas, les sources `bsky-tag` apparaissent en échec dans `data/status.json`. Pour régler ça gratuitement :

1. Sur Bluesky, aller dans **Paramètres → Confidentialité et sécurité → Mots de passe d'application** et en créer un.
2. Sur GitHub, aller dans **Settings → Secrets and variables → Actions** et ajouter :
   - `BSKY_IDENTIFIER` : ton handle (ex. `moi.bsky.social`)
   - `BSKY_APP_PASSWORD` : le mot de passe d'application

### Optionnel : TikTok

TikTok passe par [RSSHub](https://docs.rsshub.app/). L'instance publique bloque souvent. Si c'est le cas, tu peux déclarer une autre instance dans la variable d'Actions `RSSHUB_BASE` (ex. `https://rsshub.mon-instance.fr`). Si TikTok échoue, le reste de l'app continue de fonctionner.

## Modifier les sources et l'algorithme

- **`config/sources.json`** : médias (RSS), comptes Bluesky, hashtags vidéo, chaînes YouTube, TikTok.
  - Un média sans `feed` est détecté automatiquement depuis son site.
  - Un compte Bluesky sans `handle` est recherché par son nom exact, en privilégiant les comptes vérifiés. Le compte trouvé est indiqué dans `data/status.json`. Si ce n'est pas le bon, fixe le `handle` à la main.
- **`config/topics.json`** : mots-clés et poids des sujets, demi-vie de la fraîcheur, seuil de regroupement des doublons.

**Calcul du score :** `(1 + score_sujet) × poids_source × 0.5^(âge / demi-vie) × engagement × déjà_vu`. La timeline n'est pas chronologique : comme sur X, elle est retirée au sort en fonction du score à chaque refresh. Les posts déjà vus redescendent, et un même compte n'apparaît pas deux fois de suite.

**Bouton « moins de ça »** (menu ⋯ sur une carte) : il divise le poids de la source par deux et multiplie celui des mots-clés du post par 0,7. Ces réglages sont enregistrés sur le téléphone et se réinitialisent depuis le bas du feed.

## Développement local

```bash
npm install
npm test            # tests unitaires
npm run collect     # collecte réelle → public/data/*.json
npm run sample      # ou : données fictives pour tester l'interface hors ligne
npm run dev         # http://localhost:8080
```

`public/data/status.json` liste l'état de chaque source (ok ou erreur, nombre d'éléments).
