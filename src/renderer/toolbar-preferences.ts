export const TOOLBAR_GROUPS = [
  { id: 'history', label: 'Edit history' },
  { id: 'type', label: 'Text style' },
  { id: 'emphasis', label: 'Emphasis & color' },
  { id: 'paragraph', label: 'Paragraph' },
  { id: 'insert', label: 'Insert' },
  { id: 'paste', label: 'Paste options', optional: true },
  { id: 'layout', label: 'Page layout', optional: true },
] as const;

export type ToolbarGroupId = (typeof TOOLBAR_GROUPS)[number]['id'];
export type HeadingSizeKey = 'title' | 'h1' | 'h2' | 'h3';

export interface ToolbarPreferences {
  order: ToolbarGroupId[];
  visible: ToolbarGroupId[];
  expanded: boolean;
  headingSizes: Record<HeadingSizeKey, number>;
}

export const DEFAULT_TOOLBAR_PREFERENCES: ToolbarPreferences = {
  order: TOOLBAR_GROUPS.map((group) => group.id),
  visible: ['history', 'type', 'emphasis', 'paragraph', 'insert'],
  expanded: true,
  headingSizes: { title: 28, h1: 24, h2: 18, h3: 14 },
};

const validIds = new Set<ToolbarGroupId>(TOOLBAR_GROUPS.map((group) => group.id));

function headingSize(value: unknown, fallback: number): number {
  const size = Number(value);
  return Number.isFinite(size) ? Math.max(8, Math.min(96, Math.round(size))) : fallback;
}

export function normalizeToolbarPreferences(value: unknown): ToolbarPreferences {
  if (!value || typeof value !== 'object') return structuredClone(DEFAULT_TOOLBAR_PREFERENCES);
  const candidate = value as Partial<ToolbarPreferences>;
  const requestedOrder = Array.isArray(candidate.order)
    ? candidate.order.filter((id): id is ToolbarGroupId => validIds.has(id as ToolbarGroupId))
    : [];
  const order = [...new Set(requestedOrder)];
  for (const group of TOOLBAR_GROUPS) {
    if (!order.includes(group.id)) order.push(group.id);
  }
  const visible = Array.isArray(candidate.visible)
    ? [...new Set(candidate.visible.filter((id): id is ToolbarGroupId => validIds.has(id as ToolbarGroupId)))]
    : [...DEFAULT_TOOLBAR_PREFERENCES.visible];
  const sizes = candidate.headingSizes ?? DEFAULT_TOOLBAR_PREFERENCES.headingSizes;
  return {
    order,
    visible,
    expanded: candidate.expanded !== false,
    headingSizes: {
      title: headingSize(sizes.title, DEFAULT_TOOLBAR_PREFERENCES.headingSizes.title),
      h1: headingSize(sizes.h1, DEFAULT_TOOLBAR_PREFERENCES.headingSizes.h1),
      h2: headingSize(sizes.h2, DEFAULT_TOOLBAR_PREFERENCES.headingSizes.h2),
      h3: headingSize(sizes.h3, DEFAULT_TOOLBAR_PREFERENCES.headingSizes.h3),
    },
  };
}

export function moveToolbarGroup(
  order: ToolbarGroupId[],
  group: ToolbarGroupId,
  target: ToolbarGroupId,
): ToolbarGroupId[] {
  if (group === target) return order;
  const next = order.filter((id) => id !== group);
  const targetIndex = next.indexOf(target);
  next.splice(targetIndex < 0 ? next.length : targetIndex, 0, group);
  return next;
}
