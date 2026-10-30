import type { CormiApiRequest, CormiApiResponse } from 'cormi'
import { users } from './index.ts'

export default function handler(req: CormiApiRequest, res: CormiApiResponse) {
  const user = users.find(user => String(user.id) === req.params.id)
  if (!user) return res.status(404).json({ error: 'not found' })
  res.json(user)
}
