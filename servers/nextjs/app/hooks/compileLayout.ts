"use client";

import React from "react";
import * as z from "zod";
import * as Recharts from "recharts";
import * as Babel from "@babel/standalone";
import * as d3 from "d3";
import * as LucideReact from "lucide-react";
import { resolveBackendAssetUrl } from "@/utils/api";
// import * as d3Cloud from "d3-cloud";

/** Names already bound from Recharts (and core helpers) — do not shadow with Lucide. */
const RESERVED_FOR_LUCIDE = new Set([
    "Fragment",
    "useState",
    "useEffect",
    "useRef",
    "useMemo",
    "useCallback",
    "z",
    "ResponsiveContainer",
    "LineChart",
    "Line",
    "BarChart",
    "Bar",
    "XAxis",
    "YAxis",
    "CartesianGrid",
    "Tooltip",
    "Legend",
    "PieChart",
    "Pie",
    "Cell",
    "AreaChart",
    "Area",
    "RadarChart",
    "Radar",
    "PolarGrid",
    "PolarAngleAxis",
    "PolarRadiusAxis",
    "ComposedChart",
    "ScatterChart",
    "Scatter",
    "RadialBarChart",
    "RadialBar",
    "ReferenceLine",
    "ReferenceDot",
    "ReferenceArea",
    "Brush",
    "LabelList",
    "Label",
    "Text",
    // Shadcn/ui table aliases — lucide-react exports Table (icon) which would clash
    // with the "const Table = 'table'" shadcn alias injected below.
    "Table",
]);

let lucideBindingLinesCache: string | null = null;

function getLucideBindingLines(): string {
    if (lucideBindingLinesCache !== null) {
        return lucideBindingLinesCache;
    }
    const lines: string[] = [];
    for (const name of Object.keys(LucideReact)) {
        if (!/^[A-Z]/.test(name)) continue;
        if (RESERVED_FOR_LUCIDE.has(name)) continue;
        if (name === "Icon" || name === "LucideIcon") continue;
        lines.push(`const ${name} = _Lucide[${JSON.stringify(name)}];`);
    }
    lucideBindingLinesCache = lines.join("\n");
    return lucideBindingLinesCache;
}

export interface CompiledLayout {
    component: React.ComponentType<{ data: any }>;
    layoutId: string;
    layoutName: string;
    layoutDescription: string;
    schema: any;
    sampleData: Record<string, any>;
    schemaJSON: any;
}

function isLikelyBackendAssetPath(value: string): boolean {
    if (!value) return false;
    if (value.startsWith("file://")) return true;
    if (value.startsWith("/app_data/") || value.startsWith("/static/")) return true;
    if (value.startsWith("app_data/") || value.startsWith("static/")) return true;
    return value.includes("/app_data/") || value.includes("/static/");
}

function normalizeLayoutAssetUrls<T>(value: T): T {
    if (typeof value === "string") {
        const trimmedValue = value.trim();
        if (!isLikelyBackendAssetPath(trimmedValue)) {
            return value;
        }
        return resolveBackendAssetUrl(trimmedValue) as T;
    }

    if (Array.isArray(value)) {
        return value.map((item) => normalizeLayoutAssetUrls(item)) as T;
    }

    if (value && typeof value === "object") {
        const normalizedEntries = Object.entries(value as Record<string, unknown>).map(
            ([key, item]) => [key, normalizeLayoutAssetUrls(item)]
        );
        return Object.fromEntries(normalizedEntries) as T;
    }

    return value;
}

function normalizeHardcodedBackendUrlsInCode(layoutCode: string): string {
    // Keep /app_data and /static paths origin-agnostic so nginx can proxy them.
    return layoutCode.replace(
        /https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0):(?:8000|5000)(?=\/(?:app_data|static)\/)/g,
        ""
    );
}

function buildSampleFromSchemaJSON(schema: Record<string, any>): Record<string, any> {
    function buildValue(node: Record<string, any>): unknown {
        if (!node || typeof node !== "object") return undefined;
        if (node.default !== undefined) return node.default;
        switch (node.type) {
            case "array": return [];
            case "object": {
                const props = node.properties ?? {};
                return Object.fromEntries(
                    Object.entries(props).map(([k, v]) => [k, buildValue(v as Record<string, any>)])
                );
            }
            case "string": return "";
            case "number":
            case "integer": return 0;
            case "boolean": return false;
            default: return undefined;
        }
    }
    const result = buildValue(schema);
    return (result && typeof result === "object" && !Array.isArray(result))
        ? result as Record<string, any>
        : {};
}

/**
 * Compiles a layout code string into a usable React component
 */
export function compileCustomLayout(layoutCode: string): CompiledLayout | null {
    console.log('compileCustomLayout called');
    try {
        const normalizedLayoutCode = normalizeHardcodedBackendUrlsInCode(layoutCode);

        // Clean up imports that we'll provide ourselves
        const cleanCode = normalizedLayoutCode
            // Remove React imports
            .replace(/import\s+React\s*,?\s*\{?[^}]*\}?\s*from\s+['"]react['"];?/g, "")
            .replace(/import\s+\*\s+as\s+React\s+from\s+['"]react['"];?/g, "")
            .replace(/import\s+{\s*[^}]*\s*}\s*from\s+['"]react['"];?/g, "")
            // Remove zod imports
            .replace(/import\s+\*\s+as\s+z\s+from\s+['"]zod['"];?/g, "")
            .replace(/import\s+{\s*z\s*}\s*from\s+['"]zod['"];?/g, "")
            .replace(/import\s+.*\s+from\s+['"]zod['"];?/g, "")
            // Remove recharts imports
            .replace(/import\s+.*\s+from\s+['"]recharts['"];?/g, "")
            // Remove lucide-react imports (icons are injected into the sandbox below)
            .replace(/import\s+\{[\s\S]*?\}\s+from\s+['"]lucide-react['"];?\s*/g, "")
            .replace(/import\s+\*\s+as\s+[\w$]+\s+from\s+['"]lucide-react['"];?\s*/g, "")
            .replace(/import\s+[\w$]+\s+from\s+['"]lucide-react['"];?\s*/g, "")
            // Remove other common imports we'll provide
            .replace(/import\s+.*\s+from\s+['"]@\/[^'"]+['"];?/g, "")
            // Convert "export const/function/class X" → declaration only (keeps the variable)
            .replace(/\bexport\s+((?:const|let|var|function|class)\s)/g, "$1")
            // Remove grouped exports: export { ... }
            .replace(/export\s*\{[^}]*\}\s*;?/g, "")
            // Remove export default
            .replace(/export\s+default\s+\w+;?\s*$/g, "")
            // Fix: LLM writes ".description(...)" but bundled Zod only has ".describe(...)"
            .replace(/\.description\(/g, ".describe(")
            // Fix: LLM uses Icon-prefixed Lucide names (IconCheck → Check, IconStar → Star)
            .replace(/\bIcon([A-Z][a-zA-Z0-9]*)\b/g, "$1")
            // Fix: LLM writes "z.object({...})).default({...})" with extra paren
            // Handles empty and non-empty object defaults; leaves array defaults alone.
            .replace(/\}\)\)\.default\(\{/g, "}).default({")
            // Fix: LLM annotates Schema with TypeScript generic containing runtime calls
            // e.g. "const Schema: z.ZodType<{ title: z.string().max(30) }>" – invalid in Babel
            .replace(/const\s+Schema\s*:[\s\S]*?(?=\s*=\s*z\.)/g, "const Schema")
            // Fix: LLM wraps schema in template literal: "const Schema = `\nconst Schema = z.object..."
            // Remove the entire "const Schema = `\n" line; the real declaration follows on the next line.
            .replace(/const\s+Schema\s*=\s*`\s*\n?/g, "")
            // Remove leftover trailing backtick (closing end of that template literal)
            // Handles both "\n`;" and "};`" end patterns.
            .replace(/`\s*;?\s*$/g, "");



        const compiled = Babel.transform(cleanCode, {
            presets: [
                ["react", { runtime: "classic" }],
                ["typescript", { isTSX: true, allExtensions: true }],
            ],
            sourceType: "script",
        }).code;

        // Create a factory function that executes the compiled code
        const lucideBindings = getLucideBindingLines();

        // Only inject Table alias if the compiled code doesn't already declare it —
        // avoids "Identifier 'Table' has already been declared" for layouts that use
        // Table as a Zod schema variable name.
        const compiledDeclares = (name: string) =>
            new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=`).test(compiled ?? "");

        const tableAlias = compiledDeclares("Table") ? "" : "const Table = 'table';";

        const factory = new Function(
            "React",
            "_z",
            "Recharts",
            "_d3",
            "_Lucide",
            // "_d3Cloud",
            `
             const z = _z;
            // const d3Cloud= _d3Cloud;
            const d3 = _d3;
            // Expose React hooks
            const { useState, useEffect, useRef, useMemo, useCallback, Fragment } = React;

            // Expose Recharts components
            const {
                ResponsiveContainer, LineChart, Line, BarChart, Bar,
                XAxis, YAxis, CartesianGrid, Tooltip, Legend,
                PieChart, Pie, Cell, AreaChart, Area,
                RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
                ComposedChart, ScatterChart, Scatter,
                RadialBarChart, RadialBar,
                ReferenceLine, ReferenceDot, ReferenceArea,
                Brush, LabelList, Label,Text
            } = Recharts || {};

            // Lucide icons used in generated templates (<Star />, etc.) — skip names that clash with Recharts
            ${lucideBindings}

            // Shadcn/ui Table component aliases → native HTML elements.
            // LLM sometimes imports these from "@/components/ui/table" which isn't in the sandbox.
            // Table is skipped if the layout code already declares it (avoids redeclaration error).
            ${tableAlias}
            const TableBody = 'tbody';
            const TableHeader = 'thead';
            const TableHead = 'th';
            const TableFooter = 'tfoot';
            const TableRow = 'tr';
            const TableCell = 'td';
            const TableCaption = 'caption';

            // Execute the compiled code
            ${compiled}

            // Return the exports
            return {
              __esModule: true,   
                component: typeof dynamicSlideLayout !== 'undefined' 
                    ? dynamicSlideLayout 
                    : (typeof DefaultLayout !== 'undefined' ? DefaultLayout : undefined),
                layoutId: typeof layoutId !== 'undefined' ? layoutId : 'custom-layout',
                layoutName: typeof layoutName !== 'undefined' ? layoutName : 'Custom Layout',
                layoutDescription: typeof layoutDescription !== 'undefined' ? layoutDescription : '',
                Schema: typeof Schema !== 'undefined' ? Schema : null,
            };
            `
        );

        // Execute the factory
        const result = factory(React, z, Recharts, d3, LucideReact);

        if (!result.component) {
            console.error("No component found in compiled code");
            return null;
        }

        const wrappedComponent: React.ComponentType<{ data: any }> = ({ data, ...props }) => {
            const normalizedData = React.useMemo(() => normalizeLayoutAssetUrls(data), [data]);
            return React.createElement(result.component, { ...(props as any), data: normalizedData });
        };
        wrappedComponent.displayName = `CompiledTemplateLayout(${result.layoutName || result.layoutId || "Custom"})`;

        // Parse schema to get sample data
        let sampleData: Record<string, any> = {};
        const schemaJSON = z.toJSONSchema(result.Schema);
        if (result.Schema) {
            try {
                sampleData = normalizeLayoutAssetUrls(result.Schema.parse({}));
            } catch {
                // Schema.parse({}) fails when required fields have no defaults.
                // Fall back to generating empty-but-typed defaults from schemaJSON
                // so array fields get [] instead of undefined/{}.
                sampleData = buildSampleFromSchemaJSON(schemaJSON as Record<string, any>);
            }
        }

        return {
            component: wrappedComponent,
            layoutId: result.layoutId,
            layoutName: result.layoutName,
            layoutDescription: result.layoutDescription,
            schema: result.Schema,
            sampleData,
            schemaJSON,
        };
    } catch (error) {
        console.error("Error compiling layout:", error);
        return null;
    }
}



