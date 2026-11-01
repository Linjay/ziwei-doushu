const handlers = new Set<() => Promise<void>>();
export function registerAccountSave(handler: () => Promise<void>) {
  handlers.add(handler);
  return () => { handlers.delete(handler); };
}
export async function flushAccountSaves() {
  await Promise.all([...handlers].map(handler => handler()));
}
