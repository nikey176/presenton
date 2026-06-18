import { NextRequest, NextResponse } from "next/server";

function getFastApiBaseUrl(): string {
  const internal = process.env.FAST_API_INTERNAL_URL?.trim();
  if (internal) {
    return internal.replace(/\/+$/, "");
  }

  const configured = process.env.NEXT_PUBLIC_FAST_API?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  return "http://127.0.0.1:8000";
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> }
) {
  const { templateId } = await context.params;
  if (!templateId) {
    return NextResponse.json(
      { detail: "Missing template id" },
      { status: 400 }
    );
  }

  const exportCookie = request.headers.get("x-export-cookie")?.trim();
  if (!exportCookie) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const layoutsUrl = `${getFastApiBaseUrl()}/api/v1/ppt/template/${templateId}/layouts`;

  try {
    const response = await fetch(layoutsUrl, {
      method: "GET",
      headers: {
        Cookie: exportCookie,
      },
      cache: "no-store",
    });

    const bodyText = await response.text();
    const contentType = response.headers.get("content-type") ?? "application/json";

    return new NextResponse(bodyText, {
      status: response.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[export-template-layouts] Failed to fetch template layouts", error);
    return NextResponse.json(
      { detail: "Failed to fetch template layouts" },
      { status: 500 }
    );
  }
}
