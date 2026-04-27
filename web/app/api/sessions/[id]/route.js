import { NextResponse } from "next/server";

import { getSessionDetail } from "../../../../lib/eventStore";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { id } = await params;
  const detail = await getSessionDetail(id);

  if (!detail) {
    return NextResponse.json(
      { ok: false, error: "Session not found." },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    ...detail
  });
}
