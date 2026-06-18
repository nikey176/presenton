import fs from "fs/promises";
import path from "path";

import { compileTemplateSchema } from "@/lib/compile-template-schema";
import { getFastAPIUrl } from "@/utils/api";

export type BuiltinLayoutSlide = {
  id: string;
  name: string;
  description: string;
  json_schema: unknown;
};

const DEFAULT_ICON_WEIGHT = "bold";
const ALLOWED_ICON_WEIGHTS = new Set([
  "bold",
  "duotone",
  "fill",
  "light",
  "regular",
  "thin",
]);
function normalizeIconWeight(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_ICON_WEIGHT;
  }
  const normalized = value.trim().toLowerCase().replace("_", "-");
  return ALLOWED_ICON_WEIGHTS.has(normalized) ? normalized : DEFAULT_ICON_WEIGHT;
}

function getIconWeightFromSettings(settings: Record<string, unknown>): string {
  return normalizeIconWeight(settings.icon_weight);
}

/**
 * Build layout + JSON schemas for a built-in template directory without importing
 * `presentation-templates/index.tsx` (that pulls Recharts/client bundles into RSC).
 *
 * Scans `app/presentation-templates/<group>/*.tsx` and runs the same schema compiler
 * the UI uses. Slide IDs match `getSchemaByTemplateId` in `presentation-templates/index.tsx`
 * (`id` is the fully-qualified `<group>:<layoutId>` form used by layout lookup).
 * Slide order is sorted by filename for stability (may differ slightly from registration
 * order in index.tsx).
 */
export async function buildBuiltinTemplateLayoutPayload(group: string): Promise<{
  name: string;
  ordered: boolean;
  icon_weight: string;
  slides: BuiltinLayoutSlide[];
} | null> {
  const dir = path.join(
    process.cwd(),
    "app",
    "presentation-templates",
    group,
  );

  try {
    await fs.access(dir);
  } catch {
    return null;
  }

  let ordered = false;
  let icon_weight = DEFAULT_ICON_WEIGHT;
  try {
    const raw = await fs.readFile(path.join(dir, "settings.json"), "utf8");
    const s = JSON.parse(raw) as Record<string, unknown> & { ordered?: boolean };
    if (typeof s.ordered === "boolean") {
      ordered = s.ordered;
    }
    icon_weight = getIconWeightFromSettings(s);
  } catch {
    // settings.json optional
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const tsxFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".tsx"))
    .map((e) => e.name)
    .filter(
      (n) =>
        !n.includes(".test.") &&
        !n.includes(".spec.") &&
        n !== "ExampleSlideLayoutTemplate.tsx",
    )
    .sort();

  const slides: BuiltinLayoutSlide[] = [];

  for (const file of tsxFiles) {
    const full = path.join(dir, file);
    const code = await fs.readFile(full, "utf8");
    const compiled = compileTemplateSchema(code);
    if (!compiled) {
      continue;
    }
    const qualifiedLayoutId = compiled.layoutId.includes(":")
      ? compiled.layoutId
      : `${group}:${compiled.layoutId}`;
    slides.push({
      id: qualifiedLayoutId,
      name: compiled.layoutName,
      description: compiled.layoutDescription,
      json_schema: compiled.schemaJSON,
    });
  }

  if (slides.length === 0) {
    return null;
  }

  return { name: group, ordered, icon_weight, slides };
}

export type CustomLayoutCompileInput = {
  layout_id: string;
  layout_name: string;
  layout_code: string;
};

export function buildCustomTemplateLayoutPayload(
  group: string,
  layouts: CustomLayoutCompileInput[],
): { name: string; ordered: boolean; icon_weight: string; slides: BuiltinLayoutSlide[] } | null {
  const slides: BuiltinLayoutSlide[] = [];

  for (const layout of layouts) {
    const compiled = compileTemplateSchema(layout.layout_code);
    if (!compiled) continue;

    const rawId = compiled.layoutId || layout.layout_id;
    const qualifiedId = rawId.includes(":") ? rawId : `${group}:${rawId}`;

    slides.push({
      id: qualifiedId,
      name: compiled.layoutName || layout.layout_name,
      description: compiled.layoutDescription,
      json_schema: compiled.schemaJSON,
    });
  }

  if (slides.length === 0) return null;

  return { name: group, ordered: false, icon_weight: DEFAULT_ICON_WEIGHT, slides };
}

export async function buildCustomTemplateLayoutPayloadFromApi(
  group: string,
): Promise<{ name: string; ordered: boolean; icon_weight: string; slides: BuiltinLayoutSlide[] } | null> {
  const fastapiBase = getFastAPIUrl();
  let response: Response;
  try {
    response = await fetch(`${fastapiBase}/api/v1/ppt/template/${group}/layouts`);
  } catch {
    return null;
  }
  if (!response.ok) return null;

  type LayoutEntry = { layout_id?: string; layout_name?: string; layout_code?: string };
  const data = (await response.json()) as { layouts?: LayoutEntry[] };
  const layouts: CustomLayoutCompileInput[] = (data.layouts ?? []).map((l) => ({
    layout_id: l.layout_id ?? "",
    layout_name: l.layout_name ?? "",
    layout_code: l.layout_code ?? "",
  }));

  return buildCustomTemplateLayoutPayload(group, layouts);
}
