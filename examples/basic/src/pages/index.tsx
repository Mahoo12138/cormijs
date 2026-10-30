import { useState } from 'react'

export default function HomePage() {
  const [count, setCount] = useState(0)
  return (
    <div>
      <h1 id="title">Hello Cormi</h1>
      <button onClick={() => setCount(c => c + 1)}>clicked {count}</button>
    </div>
  )
}
