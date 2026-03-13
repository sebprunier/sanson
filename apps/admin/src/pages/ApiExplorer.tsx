import { ApiReferenceReact } from '@scalar/api-reference-react'
import '@scalar/api-reference-react/style.css'

export function ApiExplorer() {
  return (
    <div className="-m-8">
      <ApiReferenceReact
        configuration={{
          url: '/api',
          theme: 'default',
        }}
      />
    </div>
  )
}
