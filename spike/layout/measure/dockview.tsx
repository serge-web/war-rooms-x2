import { DockviewReact, themeLight } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { createRoot } from 'react-dom/client'

createRoot(document.getElementById('root')!).render(
  <DockviewReact
    theme={themeLight}
    components={{ c: () => <div>one</div> }}
    onReady={(e) => e.api.addPanel({ id: 'one', component: 'c' })}
  />,
)
