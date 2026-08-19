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

  // Forme collée : rien ne peut la couper.
  const glued = args.find((a) => a.startsWith('--connection='))
  if (glued) {
    const value = glued.slice('--connection='.length).trim()
    return value === '' ? null : value
  }

  // Forme séparée. Piège vérifié dans les journaux de GVue : quand
  // l'application tourne déjà, Electron livre à « second-instance » un argv où
  // IL A INSÉRÉ ses propres options entre l'option et sa valeur. Prendre
  // l'élément suivant renvoyait un tiret, et la demande était abandonnée en
  // silence. On enjambe les options pour trouver la valeur.
  const i = args.indexOf('--connection')
  if (i === -1) return null
  for (let k = i + 1; k < args.length; k++) {
    if (!args[k].startsWith('-')) return args[k]
  }
  return null
}
