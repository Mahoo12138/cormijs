export const users = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
]

export async function GET() {
  return Response.json(users)
}
