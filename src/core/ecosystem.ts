import type { AgentRole, EcosystemConfig, ExtensionInfo, SearchConfig } from '../shared/types.ts';

/** 1.3.0 §5.1: Cardwright's own roles under its own ids, named by their 界面名; the 1.2 ids read through canonicalRoleId. */
export const BUILTIN_ROLES: AgentRole[] = [
  { id: 'executor', name: '执行员', description: '通用执行', prompt: 'Handle the assigned task completely, using the provided tools and reporting verification.', readOnly: false, builtIn: true },
  { id: 'explorer', name: '探索员', description: '查看项目、交回发现', prompt: 'Explore the repository and report evidence. Do not change project files.', readOnly: true, builtIn: true },
  { id: 'planner', name: '规划师', description: '规划，进入规划模式', prompt: 'Investigate requirements and propose an implementation plan. Do not change project files.', readOnly: true, builtIn: true },
];
/**
 * The Dreamer's own definition (整理记忆). It is not one of the roles the user switches, replaces or picks, so turning the 探索员
 * off or putting a file in its place neither stops the Dreamer nor changes what it does. It only reads, as the Dreamer always did.
 * The id has a colon, which no role made in settings and no subagent file (`agent:…`) can have.
 */
export const DREAMER_ROLE: AgentRole = { id: 'app:dreamer', name: 'Dreamer', description: '整理项目记忆', prompt: 'Role: Dreamer. You organize the memory of this project. Inspect and report; do not change project files.', readOnly: true };
export function defaultEcosystem(): EcosystemConfig {
  return { memoryEnabled: true, cacheEnabled: true, showStatusline: true, compactTools: true, roles: structuredClone(BUILTIN_ROLES), mcpServers: [], webdav: { url: '', username: '', hasPassword: false } };
}
export function extensionManifest(config: EcosystemConfig, search: SearchConfig): ExtensionInfo[] {
  const rows: Array<[string, string, string, ExtensionInfo['integration'], boolean, string, string, string?]> = [
    ['@gotgenes/pi-subagents', '21.7.1', 'Agents', 'adapter', true, 'Upstream roles and tool protocol with one desktop task/worktree/approval owner.', 'https://github.com/gotgenes/pi-packages/tree/main/packages/pi-subagents'],
    ['pi-mcp-adapter', '2.34.0', 'Tools', 'native', true, 'Actual lazy MCP adapter; configured servers connect only on demand.', 'https://github.com/nicobailon/pi-mcp-adapter', 'No servers connect until configured and requested.'],
    ['pi-web-access', '0.29.0', 'Tools', 'adapter', search.enabled, 'Native model search when explicitly supported, then Exa without an extra key; URL reading and optional saved search services.', 'https://github.com/nicobailon/pi-web-access'],
    ['@juicesharp/rpiv-todo', '2.10.1', 'Workflow', 'adapter', true, 'Actual upstream task reducer, dependency validation and persistent result envelopes, presented in Studio.', 'https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo'],
    ['@juicesharp/rpiv-ask-user-question', '2.10.1', 'Workflow', 'adapter', true, 'Upstream question schema and answer envelope, with native desktop forms.', 'https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question'],
    ['@narumitw/pi-plan-mode', '0.58.0', 'Workflow', 'adapter', true, 'Upstream read-only command policy and plan completion protocol; approval gates implementation.', 'https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-plan-mode'],
    ['@cortexkit/pi-magic-context', '0.42.4', 'Context', 'adapter', config.memoryEnabled, 'Actual project SQLite memory core, automatic journals and compaction summaries; Dreamer runs manually.', 'https://github.com/cortexkit/magic-context', 'Pi is the sole live compactor. No stock daemon or embedding downloads.'],
    ['@mrclrchtr/supi-claude-md', '6.4.0', 'Context', 'skills', true, 'Original instruction-file review and revision skills bundled as text resources.', 'https://github.com/mrclrchtr/supi/tree/main/packages/supi-claude-md'],
    ['pi-cache-optimizer', '2.8.10', 'Context', 'native', config.cacheEnabled, 'Actual cache validation and diagnostics with conservative request handling.', 'https://github.com/jiangge/pi-cache-optimizer', 'No automatic prompt rewriting or claimed cache hit guarantee.'],
    ['pi-tool-display', '0.5.0', 'Presentation', 'adapter', config.compactTools, 'Compact tool records and unified/split diff in the desktop renderer.', 'https://github.com/MasuRii/pi-tool-display', 'Its TUI tool overrides target older Pi versions and are deliberately not loaded.'],
    ['@narumitw/pi-statusline', '0.50.0', 'Presentation', 'adapter', config.showStatusline, 'Model, reasoning, permissions, usage and runtime status mapped to a desktop status line.', 'https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-statusline'],
    ['pi-webdav-sync', '0.2.0', 'Backup', 'adapter', Boolean(config.webdav.url), 'Manual preview, push and restore of a credential-free configuration subset.', 'https://github.com/Yueby/pi-webdav-sync', 'Uses upstream snapshot helpers; stock plaintext credential ZIP is never uploaded.'],
  ];
  return rows.map(([name, version, category, integration, enabled, description, source, note]) => ({ id: name, name, version, category, integration, enabled, description, source, note }));
}
