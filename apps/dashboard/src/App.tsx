import { useEffect, useState } from 'react'
import { HealthResponse } from '@komugo/types'

const API_URL = import.meta.env.VITE_API_URL

export default function App() {
  const [status, setStatus] = useState('checking…')

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((res) => res.json())
      .then((json) => setStatus(HealthResponse.parse(json).ok ? 'ok' : 'down'))
      .catch(() => setStatus('unreachable'))
  }, [])

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-bold">Komugo Operator</h1>
      <p className="mt-4 text-gray-600">API status: {status}</p>
    </main>
  )
}
