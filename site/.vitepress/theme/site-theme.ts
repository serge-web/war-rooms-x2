import { useData } from 'vitepress'
import type { DefaultTheme } from 'vitepress'

export interface SiteTheme extends DefaultTheme.Config {
  /** URL path of the gh-pages root, where `demo/`, `pr/<n>/` and `snapshots/<slug>/` live. */
  readonly pagesRoot: string
}

export function usePagesRoot(): string {
  return useData<SiteTheme>().theme.value.pagesRoot
}
