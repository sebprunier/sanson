import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Workspaces } from './pages/Workspaces'
import { Layers } from './pages/Layers'
import { LayerDetail } from './pages/LayerDetail'
import { Import } from './pages/Import'
import { ApiExplorer } from './pages/ApiExplorer'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="workspaces" element={<Workspaces />} />
          <Route path="layers" element={<Layers />} />
          <Route path="layers/:id" element={<LayerDetail />} />
          <Route path="import" element={<Import />} />
          <Route path="api-explorer" element={<ApiExplorer />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
