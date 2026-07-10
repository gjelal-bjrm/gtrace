# GTrace

Débogueur T-SQL time-travel pour SQL Server. Voir la spec complète pour la vision et les phases.

**État : les 5 phases de la spec + la Phase 6 complète (MCP, headless, IA embarquée) sont implémentés.**
99 tests xunit + 150 checks d'intégration contre SQL Server 2022 (`npm run test:integration`).

**UI type SSMS** :
- **Connexions multiples** — dialogue « Se connecter au serveur » ; on ouvre plusieurs
  instances SQL Server en parallèle, chacune racine de l'explorateur d'objets. Chaque
  onglet d'édition est lié à une connexion + une base (sélecteurs dans la barre d'outils).
- **Explorateur d'objets** — arbre serveur → Bases de données → base →
  Tables / Vues / Procédures stockées / Fonctions → colonnes (avec 🔑 clés, types),
  chargement paresseux par niveau. Actions : ▶ `SELECT TOP (1000)` sur une table, 🐞
  charger+analyser une procédure, ⧉ voir la définition d'une vue/fonction — chacune ouvre
  un onglet lié à la bonne connexion/base.
- **Éditeur multi-onglets** — `Ctrl+N` nouveau, `Ctrl+O` ouvrir (multi-fichiers), `Ctrl+S`/
  `Ctrl+Maj+S` enregistrer, `Ctrl+W` fermer. Contexte **par onglet** : connexion, base,
  compat, paramètres, breakpoints, snapshots, mode lecture seule.
- La surcharge de base est résolue côté main (`ConnectionRef.database`), donc respectée par
  l'exécution, le profilage, l'inspection et le chargement d'objets. Design refondu
  (système de boutons cohérent, bouton Exécuter vert, arbre soigné). Refonte passée par une
  revue adversariale multi-agents (15 findings confirmés → corrigés).

- **Phase 6.1 — Serveur MCP, lecture de sessions** (`npm run mcp`,
  [doc de setup](docs/mcp-setup.md)) : expose les sessions enregistrées aux agents IA en
  lecture seule via stdio — 9 outils (résumé compressé, source numéroté, steps paginés,
  changements de variable, chemin d'exécution avec boucles agrégées, diff de snapshots…),
  ressource rapport Markdown, prompt `diagnose_session`. Autonome : lit `userData/sessions`
  directement, l'app n'a pas besoin d'être ouverte.
- **Phase 6.2 — Inspection lecture seule via MCP** : outils `run_readonly_query`
  (SELECT-only, validé par ScriptDom : INSERT/UPDATE/DELETE/EXEC/DDL/OPENROWSET rejetés)
  et `get_schema_info`, avec opt-in par connexion (jamais « production »), plafonds
  (200 lignes/15 s/30 req·min), masquage de colonnes, et journal d'audit révocable dans
  le panneau **🤖 Activité IA**. Mots de passe du canal MCP chiffrés DPAPI via le sidecar
  (`ProtectedData`, même utilisateur Windows) — jamais en clair.
- **Phase 6.3 — Mode headless** : CLI `npm run headless` (`gtrace run` : proc ou script,
  params JSON, résumé/trace en sortie, session persistée) + outil MCP `run_debug_session`
  réservé aux connexions avec flag **« runs autonomes »** — la boucle agentique complète
  *run → diagnostic → fix → re-run* est testée de bout en bout.
- **Phase 6.4 — IA embarquée** (minimal, le MCP reste la voie riche) : bouton
  **🩺 Diagnostiquer** sur une session échouée → contexte compact (erreur remappée,
  chemin, derniers steps avec variables, source) envoyé à **Ollama local** ou à
  l'**API Anthropic** (clé chiffrée DPAPI, jamais commitée) ; les requêtes de
  vérification suggérées s'exécutent en un clic sous les mêmes garde-fous lecture
  seule que le canal MCP.

- **Phase 1 — Replay time-travel** : instrumentation stratégie A, Monaco + timeline
  heatmap + variables en diff (F10/Shift+F10/Ctrl+flèches), explorateur de procédures,
  connexions chiffrées (safeStorage), critère « proc réelle de 300+ lignes » validé.
- **Phase 2 — Breakpoints simulés** : gouttière Monaco, `GTraceDB.dbo.ControlSignal`
  (créée sous consentement explicite), pause à chaque itération, Continuer/Step/Stop
  (annulation driver + ROLLBACK garanti), bandeau transactionnel, timeout de sécurité.
- **Phase 3 — Profilage Extended Events** : exécution non instrumentée, ligne courante
  quasi temps réel, heatmap de lenteur par ligne, dégradation gracieuse sans permission.
- **Phase 4 — Inspection profonde** :
- **Snapshots de tables** : après chaque écriture (INSERT/UPDATE/DELETE/MERGE) dans une
  table suivie, son contenu est streamé en resultset tagué `__GTRACE_SNAP__`
  (en-tête + contenu) — fonctionne pour `#temp` **et variables tables** (invisibles
  depuis une seconde connexion, contrairement à ce que suppose la stratégie B de la
  spec), survit aux ROLLBACK ; onglet Données avec **diff avant/après** entre steps.
- **Watch panel** (onglet Inspect) : expressions SQL réévaluées automatiquement à chaque
  pause via la connexion d'inspection (READ UNCOMMITTED → voit l'état non commité).
- **Historique des sessions** : chaque run est sauvegardé (JSON dans userData/sessions,
  50 max) et se **rejoue sans réexécuter** depuis l'explorateur.
- **Phase 5 — Sécurité et confort** :
  - **Mode lecture seule strict** (onglet Exécution) : la méthode `validate` du sidecar
    (ScriptDom) détecte statiquement les écritures hors `#temp`/variables tables —
    INSERT/UPDATE/DELETE/MERGE/SELECT INTO/DDL/TRUNCATE, plus les `EXEC` signalés
    opaques — et refuse l'exécution avec ligne/type/cible ; liste blanche configurable.
  - **Export de session** en Markdown (méta, paramètres, timeline, resultsets,
    snapshots, source) ou JSON, via les boutons ⬇ de l'onglet Exécution.
  - **Connexions « production »** : flag à l'enregistrement, badge ⚠ PROD et
    confirmation avant toute exécution/profilage.

### Notes d'implémentation XEvents

Sur SQL Server 2022 (tedious), tous les statements remontent en `sp_statement_*` —
y compris les batches ad hoc (`object_type = ADHOC`, `object_name` vide même pour les
procs sur ce build). Le discriminant fiable est **`object_id`** (comparé à
`OBJECT_ID('schema.proc')`) pour le mode procédure, et `object_type = ADHOC` (moins le
bruit driver `SELECT 1`) pour le mode script. Cible `ring_buffer` pollée toutes les
400 ms, `MAX_DISPATCH_LATENCY = 1s`, session `gtrace_xe_<id>` supprimée avant le
`xe-done`. Le mode proc exécute la **procédure réelle en base** (`EXEC`), pas le texte
de l'éditeur.

### Protocole breakpoints (Phase 2)

Un compteur d'exécution `@__gt_seq` est incrémenté avant chaque statement ; le bloc de
pause attend qu'une ligne `ControlSignal (SessionId, GoUntilSeq, RunToBreakpoint)`
l'autorise. *Step* = `GoUntilSeq = seq courant`, *Continuer* = idem + `RunToBreakpoint=1`
(bypass des statements sans breakpoint). Quand l'exécution se met réellement en attente,
un resultset `__GTRACE_PAUSE__` (seq, statement, `@@TRANCOUNT`) est émis, suivi d'un
`RAISERROR(N'', 0, 1) WITH NOWAIT` qui force le flush du buffer TDS — sans lui le client
ne saurait jamais que le serveur est en pause. Stop = signal d'attention driver
(`request.cancel()`) + `ROLLBACK` sur la connexion d'exécution (dédiée, pool max 1).

## Prérequis

- Node.js ≥ 20
- SDK .NET 8 — si `dotnet` n'est pas dans le PATH, il est installé localement dans
  `%LOCALAPPDATA%\Microsoft\dotnet` ; ajoutez ce dossier à votre PATH utilisateur
  (et `DOTNET_ROOT` pointant dessus) pour que `npm run build:sidecar` fonctionne.

## Démarrage

```powershell
npm install
npm run build:sidecar   # publie le sidecar ScriptDom dans resources/sidecar/
npm run dev             # lance l'app Electron (HMR)
```

## Scripts

| Script | Rôle |
|---|---|
| `npm run dev` | Dev avec HMR (electron-vite) |
| `npm run build:sidecar` | Publish self-contained win-x64 du sidecar → `resources/sidecar/` |
| `npm run build` | Typecheck + build Electron |
| `npm run build:all` | Sidecar + build complet |
| `npm run typecheck` | `tsc --noEmit` (main + renderer) |
| `npm run lint` / `format` | ESLint / Prettier |

## Architecture (Phase 0)

- `src/main/` — main process : `SidecarService` (spawn du sidecar, protocole JSON ligne
  par ligne sur stdio), handlers IPC.
- `src/preload/` — `contextBridge` exposant l'API typée `window.gtrace`.
- `src/shared/` — contrat IPC (`ipc.ts`) et types (`types.ts`) partagés.
- `src/renderer/` — React ; vue debug : source T-SQL → parse → statements, variables, erreurs.
- `sidecar/GTrace.Parser/` — console .NET 8 avec `Microsoft.SqlServer.TransactSql.ScriptDom`.
  Méthodes : `ping`, `parse`, `instrument` (`validate` arrive en Phase 5).
- `sidecar/GTrace.Parser.Tests/` — tests xunit : corpus T-SQL de complexité croissante,
  invariants d'instrumentation (lignes préservées, re-parse valide, mapping exact).
  Lancer : `dotnet test sidecar/GTrace.Parser.Tests`.

### Instrumentation (stratégie A, spec §6)

Splicing textuel **sans ajout de ligne** : le script instrumenté a exactement les mêmes
numéros de ligne que le source original (`ERROR_LINE()` mappe directement). Après chaque
statement traçable : `SELECT '__GTRACE__' AS _t, <index> AS _s, @@ROWCOUNT AS _rc, <vars écrites>`.
Cas particuliers gérés : corps `IF`/`WHILE` sans `BEGIN/END` (wrap inline), statement suivant
lisant `@@ROWCOUNT`/`@@ERROR` (trace omise + raison), `RETURN <expr>` (réécrit, valeur capturée
dans `_ret`), entrée de `CATCH` (trace `__GTRACE_ERR__` avec `ERROR_*()`), en-tête
`CREATE PROCEDURE` blanchi et paramètres extraits pour `sp_executesql`.

### Exécution (stratégie A)

`DebugService` (main process) : instrument via sidecar → exécution `mssql` en streaming →
chaque resultset tagué `__GTRACE__` devient un step (variables écrites, `@@ROWCOUNT`,
timestamp serveur), les resultsets métier sont rattachés au step producteur. Aucune écriture
en base : les traces survivent aux ROLLBACK. Les paramètres sont liés via `sp_executesql`
(types mappés depuis la signature), les OUTPUT capturés par trace finale + traces de RETURN.

### Tests d'intégration

Nécessitent le conteneur SQL Server de dev :

```powershell
docker run --name gtrace-sql -e ACCEPT_EULA=Y -e "MSSQL_SA_PASSWORD=GTrace!Dev2026" -p 14333:1433 -d mcr.microsoft.com/mssql/server:2022-latest
npm run test:integration
```

- `scripts/integration-replay.ts` — mécanique de base : ROLLBACK, boucles, CATCH,
  OUTPUT, RETURN, mapping `ERROR_LINE`, backend explorateur.
- `scripts/integration-bigproc.ts` — **critère de sortie Phase 1** : procédure réaliste
  de 317 lignes (`scripts/fixtures/`) avec curseur, SQL dynamique, savepoints, MERGE,
  GOTO, CASE imbriqués et chemin d'erreur — 174 steps capturés en ~350 ms, sans un
  seul SELECT manuel.

### Protocole sidecar

```jsonc
// stdin
{ "id": 1, "method": "parse", "params": { "sql": "...", "compatLevel": 150 } }
// stdout
{ "id": 1, "result": { "statements": [...], "variables": [...], "errors": [...] } }
```
"# gtrace" 
