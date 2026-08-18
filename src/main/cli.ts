/**
 * Arguments de ligne de commande de l'application de bureau.
 *
 * `GTrace.exe --connection <id|nom>` ouvre GTrace en se connectant directement
 * à une connexion enregistrée — utilisé par GRay pour ouvrir le débogueur sur
 * la base du projet. Le nom est accepté en plus de l'id parce que les UUID sont
 * générés localement : d'une machine à l'autre, seul le nom est stable.
 *
 * À ne pas confondre avec le `--connection` de `bin/gtrace-run.ts`, qui vise le
 * McpConnectionStore (exécutions sans surveillance) : ici c'est le magasin de
 * connexions de l'interface.
 */
export function connectionFromArgv(argv: string[], isPackaged: boolean): string | null {
  // argv[0] = exécutable ; en dev, argv[1] = dossier de l'app.
  const args = argv.slice(isPackaged ? 1 : 2)
  const i = args.indexOf('--connection')
  if (i === -1) return null
  const value = args[i + 1]
  return value && !value.startsWith('-') ? value : null
}
