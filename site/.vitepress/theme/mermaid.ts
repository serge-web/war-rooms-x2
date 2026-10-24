import { defineComponent, h, onMounted, ref, useId, watch } from 'vue'
import { useData } from 'vitepress'

/**
 * A Mermaid diagram, rendered in the browser by the bundled mermaid package (no CDN, NFR-7).
 * Until it renders, and without JavaScript, the diagram's source shows instead.
 */
export const Mermaid = defineComponent({
  name: 'Mermaid',
  props: { code: { type: String, required: true } },
  setup(props) {
    const source = decodeURIComponent(props.code)
    const id = `mermaid-${useId().replace(/[^\w-]/g, '')}`
    const svg = ref<string>()
    const error = ref<string>()
    const { isDark } = useData()

    async function render() {
      const { default: mermaid } = await import('mermaid')
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: isDark.value ? 'dark' : 'default',
      })
      try {
        svg.value = (await mermaid.render(id, source)).svg
        error.value = undefined
      } catch (e) {
        error.value = e instanceof Error ? e.message : String(e)
      }
    }

    onMounted(() => void render())
    watch(isDark, () => void render())

    return () =>
      svg.value === undefined
        ? h('div', { class: 'wrx-mermaid wrx-mermaid-pending' }, [
            h('pre', source),
            error.value === undefined ? null : h('p', { role: 'alert' }, error.value),
          ])
        : h('div', { class: 'wrx-mermaid', 'data-rendered': '', innerHTML: svg.value })
  },
})
