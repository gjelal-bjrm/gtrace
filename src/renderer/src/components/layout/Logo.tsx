import { useId, useMemo, type JSX } from 'react'
import logoSmall from '../../assets/logo-small.svg?raw'

/**
 * Logo GTrace dans l'interface (barre de menus, Nouveautés) : la version
 * dessinée pour les petites tailles, générée par scripts/gen-logo.cjs.
 *
 * Le SVG est inséré tel quel (net à toutes les tailles) ; ses identifiants
 * internes (dégradés, découpe) sont préfixés par instance pour ne jamais
 * entrer en collision quand le logo apparaît deux fois à l'écran.
 */
export function LogoIcon({ size = 24 }: { size?: number }): JSX.Element {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const html = useMemo(
    () =>
      logoSmall
        .replace(/id="([\w-]+)"/g, `id="${uid}-$1"`)
        .replace(/url\(#([\w-]+)\)/g, `url(#${uid}-$1)`)
        .replace('width="1024" height="1024"', `width="${size}" height="${size}"`),
    [uid, size]
  )
  return (
    <span
      className="logo-icon"
      style={{ width: size, height: size }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
