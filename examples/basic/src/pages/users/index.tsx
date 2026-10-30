import { useEffect, useState } from 'react'
import { Link } from 'cormi'

export default function Users() {
  const [users, setUsers] = useState<{ id: number; name: string }[]>([])
  useEffect(() => {
    fetch('/api/users').then(res => res.json()).then(setUsers)
  }, [])
  return (
    <ul id="users">
      {users.map(user => <li key={user.id}><Link to={`/users/${user.id}`}>{user.name}</Link></li>)}
    </ul>
  )
}
