// Can the layout model be driven without a DOM (for WP 2.5 unit tests, NFR-15)?
// Run: node measure/headless-model.ts
import { Actions, DockLocation, Model, TabSetNode } from 'flexlayout-react'

const model = Model.fromJson({
  global: {},
  layout: {
    type: 'row',
    children: [
      { type: 'tabset', children: [{ type: 'tab', id: 'r1', name: 'Room 1', component: 'room' }] },
      { type: 'tabset', children: [{ type: 'tab', id: 'r3', name: 'Room 3', component: 'room' }] },
    ],
  },
})
const tabsets: TabSetNode[] = []
model.visitNodes((n) => {
  if (n instanceof TabSetNode) tabsets.push(n)
})
model.doAction(
  Actions.addTab(
    { type: 'tab', id: 'r2', name: 'Room 2', component: 'room' },
    tabsets[1]!.getId(),
    DockLocation.CENTER,
    -1,
  ),
)
console.log(
  'flexlayout headless:',
  JSON.stringify(tabsets.map((t) => t.getChildren().map((c) => c.getId()))),
)

try {
  const { DockviewComponent } = await import('dockview')
  console.log('dockview import ok:', typeof DockviewComponent)
  new DockviewComponent({} as never, { createComponent: () => ({}) as never })
} catch (e) {
  console.log('dockview headless:', String(e).slice(0, 120))
}
