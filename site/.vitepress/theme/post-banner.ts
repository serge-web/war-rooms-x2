import { computed, defineComponent, h } from 'vue'
import { useData } from 'vitepress'

/**
 * The work-in-progress notice on intermediate blog posts (DOC-26), from the post's
 * `status: work-in-progress` front matter, so no post can leave it out.
 */
export const PostBanner = defineComponent({
  name: 'PostBanner',
  setup() {
    const { frontmatter } = useData()
    const info = computed(() => {
      const fm = frontmatter.value as Record<string, unknown>
      const phase = typeof fm.phase === 'number' || typeof fm.phase === 'string' ? fm.phase : '?'
      return { wip: fm.status === 'work-in-progress', phase: String(phase) }
    })
    return () =>
      info.value.wip
        ? h('div', { class: 'custom-block warning wrx-wip', role: 'note' }, [
            h('p', { class: 'custom-block-title' }, 'Work in progress'),
            h(
              'p',
              `This post describes work in progress that hasn't yet passed its phase gate (Phase ${info.value.phase}). Details may change before the gate review.`,
            ),
          ])
        : null
  },
})
