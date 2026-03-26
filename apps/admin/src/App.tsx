import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Workspaces } from './pages/Workspaces'
import { Collections } from './pages/Collections'
import { CollectionDetail } from './pages/CollectionDetail'
import { Import } from './pages/Import'
import { ApiExplorer } from './pages/ApiExplorer'
import { Health } from './pages/Health'
import { Configuration } from './pages/Configuration'

export default function App() {
  return (
    <BrowserRouter basename="/admin">
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="workspaces" element={<Workspaces />} />
          <Route path="collections" element={<Collections />} />
          <Route path="collections/:id" element={<CollectionDetail />} />
          <Route path="collections/:id/:tab" element={<CollectionDetail />} />
          <Route path="import" element={<Import />} />
          <Route path="api-explorer" element={<ApiExplorer />} />
          <Route path="health" element={<Health />} />
          <Route path="configuration" element={<Configuration />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
