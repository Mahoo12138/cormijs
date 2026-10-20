export default function access(state: unknown) {
  const user = state as { role?: string } | undefined;
  return { canAdmin: user?.role === 'admin', canRead: user !== undefined };
}
