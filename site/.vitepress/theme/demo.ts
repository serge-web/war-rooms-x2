import { computed, defineComponent, h } from 'vue'
import { withBase } from 'vitepress'
import { usePagesRoot } from './site-theme.ts'

/**
 * An embedded, fully interactive build of the app on the mock backend (DOC-6, DOC-15).
 * By default it is this site's own build at `app/`; `snapshot` embeds a frozen snapshot
 * (DOC-24) and `demo` the live demo of `main` (DOC-16).
 */
export const AppDemo = defineComponent({
  name: 'AppDemo',
  props: {
    snapshot: { type: String, default: undefined },
    demo: { type: Boolean, default: false },
    height: { type: Number, default: 420 },
    title: { type: String, default: 'War Rooms X1, running on the mock backend' },
  },
  setup(props) {
    const pagesRoot = usePagesRoot()
    const src = computed(() => {
      if (props.snapshot !== undefined) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(props.snapshot)) throw new Error('Bad snapshot slug')
        return `${pagesRoot}snapshots/${props.snapshot}/`
      }
      return props.demo ? `${pagesRoot}demo/` : withBase('/app/')
    })
    return () =>
      h('figure', { class: 'wrx-demo' }, [
        h('iframe', {
          src: src.value,
          title: props.title,
          loading: 'lazy',
          style: { height: `${props.height}px` },
        }),
        h('figcaption', [
          `${props.title}. `,
          h('a', { href: src.value, target: '_blank', rel: 'noopener' }, 'Open in a new tab'),
        ]),
      ])
  },
})

/** A link to the live demo of `main` at the gh-pages root (DOC-16). */
export const DemoLink = defineComponent({
  name: 'DemoLink',
  setup(_, { slots }) {
    const pagesRoot = usePagesRoot()
    return () =>
      h('a', { href: `${pagesRoot}demo/`, target: '_self' }, slots.default?.() ?? 'live demo')
  },
})
