import { useParams } from 'cormi'

export default function User() {
  const { id } = useParams()
  return <h2 id="user">User {id}</h2>
}
