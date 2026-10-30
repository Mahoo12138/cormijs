import { useLoaderData } from 'cormi'

export async function serverLoader() {
  const { platform } = await import('node:os')
  return { platform: platform(), time: new Date().toISOString().slice(0, 10) }
}

export default function About() {
  const { data } = useLoaderData<{ platform: string; time: string }>()
  return (
    <div>
      <h1>About</h1>
      <p id="loader">{data?.platform ? `served by ${data.platform}` : 'loading...'}</p>
    </div>
  )
}
