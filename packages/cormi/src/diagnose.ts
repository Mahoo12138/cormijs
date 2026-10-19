import { CormiError, type ProjectRuntime, type ConfigurationContext, type RuntimeGraph, type DiagnosticSection } from '@cormijs/core';

export interface Diagnosis {
  readonly format: 'cormi:diagnosis:1';
  readonly basis: 'fresh-worker-before-command';
  readonly command: string;
  readonly mode: string;
  readonly healthy: boolean;
  readonly coherent: boolean;
  readonly readiness: { readonly status: 'ready' | 'failed'; readonly code?: string };
  readonly configured: readonly { readonly id: string; readonly source: string; readonly enabled: boolean; readonly node: string | null }[];
  readonly graph: RuntimeGraph;
  readonly contributions: readonly DiagnosticSection[];
}
const clean = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 160);

/** Explicit bootstrap observation: it must remain usable when an application command cannot become ready. */
export function diagnose(host: ProjectRuntime, configured: ConfigurationContext['plugins'], command: string, mode: string, failure?: unknown): Diagnosis {
  const graph = host.graph();
  const contributions = host.ctx.get('diagnostics')?.snapshot() ?? [];
  const coherent = JSON.stringify(graph) === JSON.stringify(host.graph());
  const readiness = failure === undefined ? { status: 'ready' as const }
    : { status: 'failed' as const, code: failure instanceof CormiError ? failure.code : 'PLUGIN_FAILED' };
  const report: Diagnosis = Object.freeze({ format: 'cormi:diagnosis:1', basis: 'fresh-worker-before-command',
    command: clean(command), mode: clean(mode), readiness: Object.freeze(readiness), coherent,
    healthy: failure === undefined && coherent && graph.nodes.every(n => n.state === 'ACTIVE') && contributions.every(c => c.status === 'ready'),
    configured: Object.freeze(configured.map(entry => Object.freeze({ id: clean(entry.id), source: clean(entry.source), enabled: entry.enabled,
      node: graph.nodes.find(n => n.pluginId === entry.id)?.id ?? null }))), graph, contributions });
  if (Buffer.byteLength(JSON.stringify(report)) > 2 * 1024 * 1024) throw new CormiError('DIAGNOSTIC_LIMIT', 'Diagnosis exceeds the output budget');
  return report;
}

export function renderDiagnosis(report: Diagnosis): string {
  const nodes = new Map(report.graph.nodes.map(node => [node.id, node]));
  const services = new Map(report.graph.services.map(service => [service.id, service]));
  const lines = [`cormi diagnosis: ${report.healthy ? 'healthy' : 'unhealthy'} (${report.command}, ${report.mode})`,
    'Basis: fresh worker, before command execution; not the running dev server.',
    `Readiness: ${report.readiness.status}${report.readiness.code ? ' / ' + report.readiness.code : ''}; coherent: ${report.coherent}`, '', 'Plugins:'];
  for (const entry of report.configured) lines.push(`  ${entry.enabled ? (entry.node ? nodes.get(entry.node)?.state ?? 'UNKNOWN' : 'NOT_MOUNTED') : 'DISABLED'} ${entry.id} <- ${entry.source}`);
  for (const node of report.graph.nodes) {
    lines.push(`  ${node.id} ${node.state} ${node.pluginId ?? node.name}${node.parent ? ' parent=' + node.parent : ''}`);
    for (const dep of node.dependencies) {
      const provider = services.get(dep.committedProvider ?? dep.visibleProvider ?? '');
      lines.push(`    requires ${dep.name}: ${dep.resolution}${provider ? ' <- ' + (nodes.get(provider.provider)?.pluginId ?? nodes.get(provider.provider)?.name ?? provider.provider) : ''}`);
    }
  }
  lines.push('', 'Services:');
  for (const service of report.graph.services) lines.push(`  ${service.name} ${service.id} <- ${nodes.get(service.provider)?.pluginId ?? nodes.get(service.provider)?.name ?? service.provider} (${service.registered ? 'registered' : 'retiring'}, ${service.providerState})`);
  lines.push('', 'Contributions (opt-in metadata, not executed application routes):');
  for (const section of report.contributions) {
    lines.push(`  ${section.id}: ${section.status} collector=fiber:${section.collectorUid}`);
    for (const record of section.records) lines.push(`    ${record.kind} ${record.id}${record.ownerUid !== undefined ? ' owner=fiber:' + record.ownerUid : ''}${record.declaredOwner ? ' declared-owner=' + record.declaredOwner : ''}`);
  }
  return lines.join('\n');
}
