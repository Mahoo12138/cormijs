export async function GET(request: Request, { params }: { params: Record<string, string | undefined> }) {
  return Response.json({ {{{ name }}}: 'is working', params });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  return Response.json({ received: body }, { status: 201 });
}
