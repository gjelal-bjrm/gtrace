# Référence de l'interface de SSMS 18

Documentation de l'interface et des comportements de **SQL Server Management Studio 18** (interface en français), observés le 28.10.2026 sur un poste Windows 11, pour servir de référence à la refonte de l'interface de GTrace.

- **Méthode** : observation et manipulation de l'interface uniquement (aucun fichier interne de SSMS ouvert).
- **Serveurs** : deux instances SQL Server locales de test, `MAJORQUE\SQL2K19` (SQL Server 2019) et `MAJORQUE\SQLEXPRESS` (SQL Server 2008), en authentification Windows.
- **Aucune écriture en base** : seules des requêtes `SELECT` (et un `USE`) ont été exécutées. Les actions d'écriture (Supprimer, Modifier toutes les lignes, Exécuter une procédure…) sont décrites mais n'ont pas été lancées.
- **Réglages** : *Outils > Options* a été ouvert puis fermé avec **Annuler**.
- Le document décrit ce que fait SSMS, sans recommandation pour GTrace.
- Chaque page signale par « non testé » ce qui n'a pas pu être vérifié à l'écran.

## Sommaire

1. [Connexions et choix de la base](01-connexions.md) : dialogue de connexion et ses onglets, historique, échec, plusieurs serveurs, déconnexion, liste des bases, `USE`, changer la connexion d'une requête.
2. [Nouvelles requêtes et fichiers](02-requetes-et-fichiers.md) : à quelle connexion se rattache une nouvelle requête, nom des onglets, astérisque, enregistrer, ouvrir, fermer, onglets.
3. [Explorateur d'objets](03-explorateur.md) : arborescence, clic droit sur serveur / base / table / colonne / procédure / vue, *1000 premières lignes*, *Modifier*, filtre, glisser-déposer.
4. [Exécution et résultats](04-execution-resultats.md) : barre d'outils SQL bouton par bouton, exécuter tout ou une sélection, volet de résultats, grille, erreurs, longue requête, barres d'état.
5. [Menus et réglages](05-menus-options.md) : contenu de chaque menu, *Outils > Options* (Démarrage, Transact-SQL, Onglet et barre d'état, Résultats), disposition des fenêtres.
6. [Divers](06-divers.md) : serveurs inscrits, explorateur de modèles, moniteur d'activité, propriétés d'une table, raccourcis clavier.

Les captures sont dans [`captures/`](captures/), préfixées par le numéro du thème.

## Les 10 comportements qui comptent le plus au quotidien

1. **Chaque onglet de requête a sa propre connexion** (serveur + base + SPID). L'explorateur d'objets et chaque onglet sont indépendants : déconnecter un serveur dans l'explorateur ne touche pas les onglets ouverts dessus ; on peut mélanger librement plusieurs serveurs dans plusieurs onglets. → [01](01-connexions.md#17-lien-entre-une-fenêtre-de-requête-un-serveur-et-une-base)

2. **Une nouvelle requête hérite du contexte, sans aucun dialogue.** `Ctrl+N` reprend l'élément sélectionné dans l'explorateur (une base → cette base ; un serveur → sa base de départ), ou, si le focus est dans un éditeur, **le serveur et la base courante de l'onglet actif**. → [02](02-requetes-et-fichiers.md#21-nouvelle-requête--à-quelle-connexion-est-elle-rattachée-)

3. **La connexion est visible partout et toujours à jour** : nom de l'onglet (`SQLQuery3.sql - serveur.base (utilisateur (SPID))`, tronqué au milieu), info-bulle complète, titre de la fenêtre, liste des bases et barre d'état jaune. Changer d'onglet met tout à jour. → [01](01-connexions.md#17-lien-entre-une-fenêtre-de-requête-un-serveur-et-une-base)

4. **La liste déroulante des bases change la base immédiatement**, sans rien exécuter, et `USE MaBase` exécuté la fait suivre : la liste reflète toujours la base réelle de la connexion. `Ctrl+U` y donne accès au clavier. → [01](01-connexions.md#effet-de-use-mabase)

5. **Le dialogue de connexion se souvient de tout** : dernier serveur pré-rempli et sélectionné, historique déroulant de tous les serveurs, et choisir un serveur de l'historique restaure son mode d'authentification, son identifiant et son mot de passe mémorisé. En cas d'échec, le dialogue reste ouvert avec les valeurs saisies. → [01](01-connexions.md#12-le-dialogue-en-mode-compact)

6. **`F5` exécute la sélection si elle existe, sinon tout l'onglet.** Les résultats remplacent les précédents ; plusieurs `SELECT` donnent plusieurs grilles empilées ; `Ctrl+R` masque ou réaffiche le volet. Une requête non connectée ouvre le dialogue de connexion puis s'exécute. → [04](04-execution-resultats.md#42-exécuter-tout-ou-une-sélection)

7. **Les erreurs mènent au code** : en cas d'erreur, l'onglet *Messages* passe devant, le message est en rouge avec le numéro de ligne, et **double-cliquer dessus sélectionne la ligne fautive** dans l'éditeur. Les résultats déjà obtenus restent visibles. → [04](04-execution-resultats.md#erreur)

8. **La barre d'état de la requête dit tout de l'exécution** : état avec icône (réussie, en cours avec chronomètre, erreurs, annulée), serveur et version, utilisateur et SPID, base, durée, nombre de lignes. Elle est kaki par défaut, et sa couleur peut être personnalisée par connexion (pour repérer la production). → [04](04-execution-resultats.md#46-les-barres-détat)

9. **L'explorateur génère du SQL au lieu de le faire écrire** : *Sélectionner les 1000 premières lignes* ouvre et exécute un `SELECT TOP (1000)` sur la bonne base ; *Modifier* ouvre le code d'une procédure en `ALTER PROCEDURE` sans l'exécuter ; *Générer un script en tant que* propose CREATE / ALTER / DROP / SELECT / INSERT / UPDATE / DELETE / EXECUTE vers un nouvel onglet, un fichier ou le presse-papiers ; glisser un objet ou un dossier *Colonnes* insère son nom ou la liste des colonnes. → [03](03-explorateur.md)

10. **Rien n'est perdu sans prévenir** : un `*` marque l'onglet et le titre dès la première modification ; fermer un onglet modifié, ou quitter SSMS, affiche une liste des fichiers non enregistrés avec Oui / Non / Annuler. Un fichier `.sql` ne mémorise pas sa connexion : il s'ouvre sur la connexion de l'onglet actif. → [02](02-requetes-et-fichiers.md#25-fermer-un-onglet-non-enregistré)

## Ce qui n'a pas pu être vu ou vérifié

| Élément | Raison |
|---|---|
| Couleur personnalisée d'une connexion appliquée à la barre d'état | Cocher l'option aurait modifié l'historique de connexion enregistré. |
| Réouverture des onglets au redémarrage de SSMS | SSMS n'a pas été quitté (Quitter testé puis Annulé), pour ne pas perdre la session. |
| *Modifier toutes les lignes*, *Exécuter la procédure* (OK), concepteurs de table, *Supprimer*, *Renommer*, pilotage du service | Actions qui écrivent ou peuvent écrire en base. |
| *Résultats dans un fichier* | L'exécution écrit un fichier ; seul l'info-bulle a été relevée. |
| Requête sur un groupe de serveurs (barre rose) | Aucun groupe dans les Serveurs inscrits. |
| Flèche ▾ de liste des onglets (à droite des onglets) | N'a pas réagi aux clics. |
| Ancrage par glisser, masquage automatique, *Rétablir la disposition* | Non manipulés pour ne pas modifier la disposition enregistrée. |
| Redimensionnement du volet de résultats, largeur des colonnes, `Ctrl+Tab`, `F6` | Non testés (décrits d'après l'apparence ou les menus). |
| Arrivée progressive des résultats pendant une longue requête | La requête de test ne renvoyait qu'une ligne finale. |
| Plan d'exécution réel (`Ctrl+M`), statistiques client | Non activés. |
| Clic droit sur une fonction, déclencheur, index, utilisateur… | Hors du périmètre prioritaire ; même structure que procédures et tables. |
