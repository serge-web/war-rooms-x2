import { Layout, Model } from 'flexlayout-react'
import 'flexlayout-react/style/light.css'
import { createRoot } from 'react-dom/client'

const model = Model.fromJson({
  global: {},
  layout: {
    type: 'row',
    children: [{ type: 'tabset', children: [{ type: 'tab', name: 'One', component: 'c' }] }],
  },
})

createRoot(document.getElementById('root')!).render(
  <Layout model={model} factory={() => <div>one</div>} />,
)
