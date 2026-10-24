import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import { h } from 'vue'
import { AppDemo, DemoLink } from './demo.ts'
import { Mermaid } from './mermaid.ts'
import { PostBanner } from './post-banner.ts'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, { 'doc-before': () => h(PostBanner) }),
  enhanceApp({ app }) {
    app.component('Mermaid', Mermaid)
    app.component('AppDemo', AppDemo)
    app.component('DemoLink', DemoLink)
  },
} satisfies Theme
