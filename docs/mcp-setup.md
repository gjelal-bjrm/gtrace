# GTrace — serveur MCP : configuration

Le serveur MCP GTrace expose vos sessions de debug enregistrées aux agents IA
(Claude Code en premier lieu), **en lecture seule**. Il est autonome : il lit
directement le répertoire de sessions de l'app — GTrace n'a pas besoin d'être ouvert.

## Configuration Claude Code

Dans `.mcp.json` (projet) ou la config utilisateur :

```json
{
  "mcpServers": {
    "gtrace": {
      "command": "npx",
      "args": ["tsx", "C:/Dev/gtrace/bin/gtrace-mcp.ts"]
    }
  }
}
```

Ou en ligne de commande : `claude mcp add gtrace -- npx tsx C:/Dev/gtrace/bin/gtrace-mcp.ts`

Par défaut le serveur lit `%APPDATA%/gtrace/sessions` (le répertoire de l'app).
Options : `--sessions-dir <dir>` ou variable d'environnement `GTRACE_SESSIONS_DIR`.

## Outils exposés (lecture seule)

| Outil | Usage |
|---|---|
| `list_sessions` | Sessions enregistrées (filtres : statut ok/erreur, nom de proc) |
| `get_session_summary` | **Point d'entrée du diagnostic** : erreurs remappées, chemin d'exécution agrégé, top statements lents, variables les plus modifiées |
| `get_proc_source` | Source original numéroté + hash (les lignes des steps s'y réfèrent) |
| `get_steps` | Timeline paginée (max 500/page), filtrable par plage ou par lignes |
| `get_variables_at_step` | État complet des variables à un step |
| `find_variable_changes` | Tous les changements d'une variable (ancienne/nouvelle valeur) |
| `get_execution_path` | Chemin compact : séquences, boucles (avec itérations), CATCH |
| `get_resultsets` | Resultsets métier (tronqués à 50 lignes) |
| `diff_table_snapshots` | Diff ajouts/suppressions entre deux snapshots de table |

Tous les ids de session acceptent `latest`. Toutes les sorties sont paginées/tronquées
(`truncated: true` l'indique) : un diagnostic se fait en 5–10 appels ciblés, jamais en
aspirant la trace brute.

## Ressource et prompt

- Ressource `gtrace://sessions/latest/report` : rapport Markdown complet de la
  dernière session.
- Prompt `diagnose_session` : méthode de diagnostic guidée (résumé → source → chemin
  → variables → snapshots → cause racine + correctif).

## Workflow type

```
Proc en échec → run dans GTrace (session enregistrée automatiquement)
  → dans Claude Code : « la dernière session GTrace a échoué, diagnostique »
  → l'agent enchaîne get_session_summary / get_proc_source / find_variable_changes…
  → cause racine + correctif, zéro copier-coller.
```

## Inspection lecture seule (outils touchant la base)

Trois outils supplémentaires accèdent à un vrai serveur SQL, sous conditions strictes :

| Outil | Usage |
|---|---|
| `list_readonly_connections` | Connexions explicitement autorisées (opt-in) |
| `run_readonly_query` | **SELECT uniquement** — tout autre statement rejeté (validation ScriptDom) |
| `get_schema_info` | Colonnes, types, index d'une table/vue |

**Activer une connexion** : dans GTrace, bouton « 🤖 Activité IA » → « Autoriser » sur la
connexion voulue (avec, optionnellement, des motifs de colonnes à masquer : `email`,
`iban`…). Off par défaut. Les connexions marquées « production » sont **refusées**.

Le même panneau affiche le **journal d'audit** (chaque appel, requête, volume, rejets) et
permet la **révocation immédiate** — prise en compte au prochain appel MCP.

## Sécurité (spec §3.4)

1. **Lecture seule structurelle** : `run_readonly_query` passe par le sidecar ScriptDom
   qui rejette tout ce qui n'est pas un SELECT pur (INSERT/UPDATE/DELETE/MERGE/EXEC/DDL,
   SELECT INTO), plus une liste noire (`xp_*`, `sp_*`, `OPENROWSET`/`OPENQUERY`, `fn_*`).
   Connexion ouverte en READ COMMITTED + `ApplicationIntent=ReadOnly`.
2. **Plafonds** : lignes (défaut 200, max 1000), timeout 15 s, 30 requêtes/minute.
3. **Opt-in par connexion**, jamais « production ». Mot de passe chiffré DPAPI (sidecar) —
   le serveur MCP ne voit jamais de credential en clair sur disque.
4. **Audit** de chaque appel, révocable.
5. **Masquage** de colonnes sensibles par motif, avant sortie MCP.

Les outils de lecture de sessions (§ précédent), eux, ne touchent aucun serveur SQL et
n'ont besoin d'aucune connexion autorisée.

## Mode headless et boucle agentique

**CLI** — lancer une session instrumentée sans ouvrir GTrace :

```powershell
npm run headless -- --connection dev-runs --proc dbo.CalculPaiement `
  --params params.json --output trace-summary.json [--full-trace trace.json]
```

Connexion : soit une connexion MCP dont le flag **« runs autonomes »** est activé
(panneau Activité IA), soit des identifiants inline (`--server/--database/--user/--password`).
Codes retour : 0 = ok, 1 = session en erreur, 2 = échec. La session est persistée et
immédiatement interrogeable via MCP.

**Outil MCP `run_debug_session`** — même capacité pour l'agent, uniquement sur les
connexions « runs autonomes » (jamais « production », qui n'entre pas dans le store).
Renvoie `{ sessionId, status, summary }`. Boucle type :

```
hypothèse → run_debug_session → get_session_summary / find_variable_changes
  → correctif → run_debug_session (validation) → status: ok
```

Chaque run est journalisé dans le panneau Activité IA.
