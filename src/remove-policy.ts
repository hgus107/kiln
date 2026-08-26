export type RemovableRow = {
  state: string;
  output?: string;
};

export type RemovePolicy = {
  enabled: boolean;
  requiresDiscardConfirmation: boolean;
  requiresScratchCleanup: boolean;
};

export function removePolicy(row: RemovableRow, running: boolean): RemovePolicy {
  const enabled = !running;
  const hasScratchResult = Boolean(row.output);

  return {
    enabled,
    requiresDiscardConfirmation: enabled && hasScratchResult && row.state !== "saved",
    requiresScratchCleanup: enabled && hasScratchResult,
  };
}

export function removeSelectionPolicy(rows: RemovableRow[], running: boolean): RemovePolicy {
  const policies = rows.map((row) => removePolicy(row, running));
  return {
    enabled: policies.length > 0 && policies.every((policy) => policy.enabled),
    requiresDiscardConfirmation: policies.some((policy) => policy.requiresDiscardConfirmation),
    requiresScratchCleanup: policies.some((policy) => policy.requiresScratchCleanup),
  };
}

export function activeAfterRemoval(paths: string[], activePath: string, removedPath: string): string {
  if (activePath !== removedPath) return paths.includes(activePath) ? activePath : "";

  const removedIndex = paths.indexOf(removedPath);
  if (removedIndex < 0) return paths.includes(activePath) ? activePath : "";

  return paths[removedIndex + 1] ?? paths[removedIndex - 1] ?? "";
}
