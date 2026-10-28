import type { JSX } from 'react'
import logoUi from '../../assets/logo-ui.png'

/**
 * Logo GTrace dans l'interface (barre de menus, Nouveautés) : la version aux
 * points grossis, lisible en petit, générée par scripts/gen-logo.cjs à partir
 * de build/logo-source.jpg.
 */
export function LogoIcon({ size = 24 }: { size?: number }): JSX.Element {
  return (
    <img
      className="logo-icon"
      src={logoUi}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}
